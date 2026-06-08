import { useEffect, useRef, useState } from 'react';
import * as gstore from '../lib/group_storage.js';
import * as groups from '../lib/groups.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import * as api from '../lib/api.js';
import { hexToBytes } from '../lib/crypto.js';
import { formatBytes } from '../lib/images.js';
import { Recorder, isSupported as voiceIsSupported, formatDuration, MAX_DURATION_MS } from '../lib/voice.js';
import * as muted from '../lib/muted.js';

// TTL must not exceed backend message_ttl_hard_seconds (86400 = 24h).
const TTL_OPTIONS = [
  { label: '1 година',  seconds: 3600 },
  { label: '6 годин',   seconds: 6 * 3600 },
  { label: '24 години', seconds: 24 * 3600 },
];

const LONG_PRESS_MS = 500;
const SCROLL_BOTTOM_THRESHOLD = 80;

function fmtClock(unix) {
  const d = new Date(unix * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtTTLLeft(expires_at) {
  if (!expires_at) return '';
  const left = expires_at - Math.floor(Date.now() / 1000);
  if (left <= 0) return 'зник';
  if (left < 60) return `${left}с`;
  if (left < 3600) return `${Math.floor(left / 60)}хв`;
  if (left < 86400) return `${Math.floor(left / 3600)}г`;
  return `${Math.floor(left / 86400)}д`;
}

function getSeedBytes() {
  const v = vault.getUnlockedSeed();
  if (v) return v;
  const id = store.loadIdentity();
  if (id && !id.encrypted && id.seed_hex) return hexToBytes(id.seed_hex);
  return null;
}

export default function GroupChat({ groupId, onNavigate }) {
  const me = store.loadProfile();
  const myPubkeyHex = me?.pubkey_hex || store.loadIdentity()?.pubkey_hex;

  const [group, setGroup] = useState(() => gstore.getGroup(groupId));
  const [draft, setDraft] = useState('');
  const [ttlSeconds, setTtlSeconds] = useState(86400);
  const [sending, setSending] = useState(false);
  const [showTtlMenu, setShowTtlMenu] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [muteEntry, setMuteEntry] = useState(null);
  const [muteSheetOpen, setMuteSheetOpen] = useState(false);
  const longPressTimer = useRef(null);
  const scrollerRef = useRef(null);
  const messagesEnd = useRef(null);
  const fileInputRef = useRef(null);
  const recorderRef = useRef(null);
  const recordTimerRef = useRef(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const isAdmin = group?.creator_pubkey_hex === myPubkeyHex;

  useEffect(() => {
    (async () => {
      try {
        await groups.refreshGroup(groupId);
        setGroup(gstore.getGroup(groupId));
      } catch (e) {
        console.warn('group refresh failed:', e);
      }
    })();
  }, [groupId]);

  useEffect(() => {
    gstore.markGroupRead(groupId);
  }, [groupId]);

  // Load mute state for this group
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const e = await muted.getMute(muted.groupKey(groupId));
      if (!cancelled) setMuteEntry(e);
    }
    load();
    return () => { cancelled = true; };
  }, [groupId]);

  async function muteFor(durationMs) {
    await muted.setMute(muted.groupKey(groupId), durationMs);
    const e = await muted.getMute(muted.groupKey(groupId));
    setMuteEntry(e);
    setMuteSheetOpen(false);
  }

  async function unmuteGroup() {
    await muted.unmute(muted.groupKey(groupId));
    setMuteEntry(null);
    setMuteSheetOpen(false);
  }

  useEffect(() => {
    const id = setInterval(() => {
      setGroup(gstore.getGroup(groupId));
      gstore.markGroupRead(groupId);
    }, 2000);
    return () => clearInterval(id);
  }, [groupId]);

  // React immediately when InboxClient's onDeleted updates this group.
  useEffect(() => {
    function onUpdate(e) {
      if (e.detail?.groupId === groupId) {
        setGroup(gstore.getGroup(groupId));
      }
    }
    window.addEventListener('morok-group-update', onUpdate);
    return () => window.removeEventListener('morok-group-update', onUpdate);
  }, [groupId]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    const el = scrollerRef.current;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist < SCROLL_BOTTOM_THRESHOLD * 2) {
      messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [group?.messages?.length]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = dist < SCROLL_BOTTOM_THRESHOLD;
    setShowScrollDown(!atBottom);
    if (atBottom) flushReadReceipts();
  }

  async function flushReadReceipts() {
    if (!store.getPreference('read_receipts', true)) return;
    const g = gstore.getGroup(groupId);
    if (!g) return;
    const toReport = (g.messages || []).filter(
      (m) =>
        m.direction === 'in' &&
        m.envelope_id &&
        m.sender_pubkey &&
        m.sender_pubkey !== myPubkeyHex &&
        !m.read_sent &&
        m.status !== 'undecryptable',
    );
    if (toReport.length === 0) return;
    for (const m of toReport) {
      gstore.updateMessage(groupId, m.id, { read_sent: true });
    }
    try {
      await api.sendReadReceipts(
        toReport.map((m) => ({
          envelope_id: m.envelope_id,
          sender_pubkey_hex: m.sender_pubkey,
          group_id: groupId,
        })),
      );
    } catch (e) {
      console.warn('group read receipts failed:', e);
      for (const m of toReport) {
        gstore.updateMessage(groupId, m.id, { read_sent: false });
      }
    }
  }

  // Initial flush when opening or new messages arrive while at bottom
  useEffect(() => {
    flushReadReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, group?.messages?.length]);

  function scrollToBottom() {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function startLongPress(message) {
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
      setActionMessage(message);
    }, LONG_PRESS_MS);
  }
  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }

  function deleteForMe() {
    if (!actionMessage) return;
    gstore.deleteMessage(groupId, actionMessage.id);
    setActionMessage(null);
    setGroup(gstore.getGroup(groupId));
  }

  async function reactClicked(emoji, alreadyMine) {
    if (!actionMessage || !actionMessage.envelope_id) return;
    const targetEnvelopeId = actionMessage.envelope_id;
    setActionMessage(null);
    const seed = getSeedBytes();
    if (!seed || !myPubkeyHex) {
      alert('Сеанс закінчився.');
      return;
    }
    try {
      await groups.sendGroupReaction({
        groupId, targetEnvelopeId, emoji,
        op: alreadyMine ? 'remove' : 'add',
        seed, myPubkeyHex,
      });
      setGroup(gstore.getGroup(groupId));
    } catch (e) {
      setGroup(gstore.getGroup(groupId));
      console.warn('group reaction failed:', e);
    }
  }

  async function deleteForEveryone() {
    if (!actionMessage) return;
    const msg = actionMessage;
    setActionMessage(null);

    if (!msg.envelope_id) {
      // No server envelope_id to target — local-only fallback.
      gstore.deleteMessage(groupId, msg.id);
      setGroup(gstore.getGroup(groupId));
      return;
    }

    const seed = getSeedBytes();
    if (!seed) {
      alert('Сеанс закінчився.');
      return;
    }

    try {
      await api.deleteGroupMessage(groupId, msg.envelope_id, seed);
      gstore.deleteMessage(groupId, msg.id);
      setGroup(gstore.getGroup(groupId));
    } catch (e) {
      alert(`Не вдалось видалити для всіх: ${e.message}`);
    }
  }

  async function sendClicked() {
    if (!draft.trim() || sending) return;
    const seed = getSeedBytes();
    if (!seed) { alert('Сеанс закінчився.'); return; }
    if (!myPubkeyHex) { alert('Не знайдено мій pubkey.'); return; }
    setSending(true);
    try {
      await groups.sendGroupMessage({
        groupId, text: draft.trim(),
        ttlSeconds,
        seed, myPubkeyHex,
      });
      vault.refreshSession();
      setDraft('');
      setGroup(gstore.getGroup(groupId));
    } catch (e) {
      alert(`Помилка: ${e.message}`);
    } finally {
      setSending(false);
    }
  }

  function attachClicked() {
    if (imageBusy || sending) return;
    fileInputRef.current?.click();
  }

  async function onImagePicked(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Це не картинка.');
      return;
    }
    const seed = getSeedBytes();
    if (!seed || !myPubkeyHex) {
      alert('Сеанс закінчився.');
      return;
    }
    setImageBusy(true);
    try {
      await groups.sendGroupImage({
        groupId, file, caption: draft.trim(),
        ttlSeconds, seed, myPubkeyHex,
      });
      vault.refreshSession();
      setDraft('');
      setGroup(gstore.getGroup(groupId));
    } catch (err) {
      alert(`Не вдалось надіслати картинку: ${err.message}`);
    } finally {
      setImageBusy(false);
    }
  }

  async function startRecording() {
    if (recording || voiceBusy || sending || imageBusy) return;
    if (!voiceIsSupported()) {
      alert('Браузер не підтримує запис голосу.');
      return;
    }
    const seed = getSeedBytes();
    if (!seed || !myPubkeyHex) {
      alert('Сеанс закінчився. Перезавантажте сторінку.');
      return;
    }
    const rec = new Recorder();
    try {
      await rec.start({
        onAutoStop: () => { stopAndSend(); },
      });
    } catch (e) {
      const msg = e?.name === 'NotAllowedError'
        ? 'Доступ до мікрофону заблоковано.'
        : (e?.message || 'Не вдалось почати запис');
      alert(msg);
      return;
    }
    recorderRef.current = rec;
    setRecording(true);
    setRecordMs(0);
    recordTimerRef.current = setInterval(() => {
      const r = recorderRef.current;
      if (!r) return;
      const d = r.getDuration();
      setRecordMs(d);
      if (d >= MAX_DURATION_MS) {
        stopAndSend();
      }
    }, 200);
  }

  function _stopRecordTimer() {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }

  async function stopAndSend() {
    const rec = recorderRef.current;
    _stopRecordTimer();
    setRecording(false);
    if (!rec) return;
    setVoiceBusy(true);
    try {
      const result = await rec.stop();
      recorderRef.current = null;
      if (!result || !result.blob || result.duration_ms < 300) {
        setVoiceBusy(false);
        return;
      }
      const seed = getSeedBytes();
      if (!seed || !myPubkeyHex) {
        alert('Сеанс закінчився.');
        setVoiceBusy(false);
        return;
      }
      await groups.sendGroupVoice({
        groupId,
        audioBlob: result.blob,
        mimeType: result.mime,
        durationMs: result.duration_ms,
        ttlSeconds,
        seed, myPubkeyHex,
      });
      vault.refreshSession();
      setGroup(gstore.getGroup(groupId));
    } catch (e) {
      alert(`Не вдалось надіслати голосове: ${e.message}`);
    } finally {
      setVoiceBusy(false);
    }
  }

  function cancelRecording() {
    _stopRecordTimer();
    setRecording(false);
    setRecordMs(0);
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec) rec.cancel();
  }

  useEffect(() => {
    return () => {
      _stopRecordTimer();
      const rec = recorderRef.current;
      if (rec) rec.cancel();
      recorderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!group) {
    return (
      <div className="screen" style={{ background: '#0A0A0B' }}>
        <CompactHeader
          title="Група"
          subtitle=""
          onBack={() => onNavigate('chats')}
        />
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '40px 24px', textAlign: 'center', gap: 12,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: '#13131A',
            border: '1px solid #232329',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#3F3F45',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F5F7' }}>Групу не знайдено</div>
        </div>
      </div>
    );
  }

  const messages = group.messages || [];
  const noKey = !group.group_key_b64;
  const memberCount = group.member_count || (group.members?.length ?? 0);

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>
      <style>{`
        @keyframes morokPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.45; transform: scale(0.85); }
        }
      `}</style>

      <CompactHeader
        title={group.name || 'Група без назви'}
        subtitle={`${memberCount} учасників`}
        onBack={() => onNavigate('chats')}
        onTitleClick={() => onNavigate(`groupinfo/${groupId}`)}
        onMenuClick={() => setMuteSheetOpen(true)}
        isMuted={!!muteEntry}
      />

      {noKey && (
        <div style={{
          margin: '10px 14px 0',
          background: 'rgba(255, 169, 77, 0.08)',
          border: '1px solid rgba(255, 169, 77, 0.25)',
          padding: '10px 14px', borderRadius: 10,
          fontSize: 12.5, color: '#FFA94D', lineHeight: 1.5,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <div style={{ fontSize: 14, lineHeight: 1, marginTop: 1 }}>⏳</div>
          <div>
            Чекаємо на ключ групи від адміна. Як тільки прийде — побачите назву і повідомлення.
          </div>
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        style={{
          flex: 1, overflowY: 'auto',
          padding: '16px 14px 8px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}
      >
        {messages.length === 0 && !noKey && (
          <div style={{
            textAlign: 'center', color: '#5A5A65', fontSize: 12.5,
            marginTop: 40, lineHeight: 1.6,
          }}>
            Поки немає повідомлень.<br/>
            <span style={{ color: '#3F3F45', fontSize: 11.5 }}>
              Напишіть перше нижче.
            </span>
          </div>
        )}
        {messages.map((m, idx) => {
          const isOut = m.direction === 'out' || m.sender_pubkey === myPubkeyHex;
          const prevMsg = messages[idx - 1];
          const nextMsg = messages[idx + 1];
          const sameSender = (a, b) =>
            (a.direction === 'out' || a.sender_pubkey === myPubkeyHex)
              === (b.direction === 'out' || b.sender_pubkey === myPubkeyHex)
            && (a.sender_pubkey || '') === (b.sender_pubkey || '');
          const samePrev = prevMsg && sameSender(prevMsg, m) && (m.ts - prevMsg.ts) < 300;
          const sameNext = nextMsg && sameSender(m, nextMsg) && (nextMsg.ts - m.ts) < 300;

          // Bubble radius — tail when first/last in a group
          const radius = 16;
          const tail = 4;
          const borderRadius = isOut
            ? `${radius}px ${samePrev ? tail : radius}px ${sameNext ? tail : radius}px ${radius}px`
            : `${samePrev ? tail : radius}px ${radius}px ${radius}px ${sameNext ? tail : radius}px`;

          // Color from sender pubkey (for sender name highlight)
          const senderHue = m.sender_pubkey
            ? parseInt(m.sender_pubkey.slice(0, 6), 16) % 360
            : 220;

          return (
            <div
              key={m.id}
              onMouseDown={() => startLongPress(m)}
              onMouseUp={cancelLongPress}
              onMouseLeave={cancelLongPress}
              onTouchStart={() => startLongPress(m)}
              onTouchEnd={cancelLongPress}
              onTouchCancel={cancelLongPress}
              style={{
                maxWidth: '80%',
                alignSelf: isOut ? 'flex-end' : 'flex-start',
                display: 'flex', flexDirection: 'column', gap: 3,
                marginTop: samePrev ? 0 : 6,
                userSelect: 'none', WebkitUserSelect: 'none',
                cursor: 'pointer',
              }}
            >
              {/* Sender name — only for incoming messages, and only first in group */}
              {!isOut && !samePrev && (
                <div style={{
                  fontSize: 11, fontWeight: 700,
                  color: `hsl(${senderHue}, 60%, 70%)`,
                  padding: '0 6px 2px',
                  letterSpacing: '0.01em',
                  fontFamily: 'var(--mono, monospace)',
                }}>
                  @{m.sender_username || m.sender_pubkey?.slice(0, 8) || 'anon'}
                </div>
              )}

              <div
                style={{
                  padding: m.image ? 4 : (m.voice ? '6px 8px' : '9px 13px'),
                  borderRadius,
                  fontSize: 14, lineHeight: 1.4,
                  wordWrap: 'break-word',
                  background: isOut ? '#6B8AFE' : '#16161B',
                  color: isOut ? '#FFF' : '#F5F5F7',
                  border: isOut ? 'none' : '1px solid #1E1E27',
                  letterSpacing: '-0.005em',
                  overflow: 'hidden',
                }}
              >
                {m.status === 'undecryptable' ? (
                  <span style={{ opacity: 0.7, fontStyle: 'italic', padding: m.image ? '8px 9px' : 0, display: 'block' }}>
                    ⚠ {m.error || 'не вдалось розшифрувати'}
                  </span>
                ) : m.voice ? (
                  <VoicePlayer voice={m.voice} isOut={isOut} />
                ) : m.image ? (
                  <>
                    <img
                      src={`data:${m.image.mime};base64,${m.image.data_b64}`}
                      alt={m.text || 'image'}
                      onClick={(e) => { e.stopPropagation(); setLightboxImage(m.image); }}
                      style={{
                        display: 'block', maxWidth: 280, maxHeight: 360,
                        width: 'auto', height: 'auto',
                        borderRadius: 12,
                        cursor: 'zoom-in',
                        background: '#000',
                      }}
                      draggable={false}
                    />
                    {m.text && (
                      <div style={{ padding: '6px 9px 2px', fontSize: 14, color: isOut ? '#FFF' : '#F5F5F7' }}>
                        {m.text}
                      </div>
                    )}
                  </>
                ) : m.text}
              </div>

              {m.reactions && Object.keys(m.reactions).length > 0 && (
                <div style={{
                  display: 'flex', gap: 4, marginTop: 4,
                  alignSelf: isOut ? 'flex-end' : 'flex-start',
                  flexWrap: 'wrap',
                }}>
                  {Object.entries(m.reactions).map(([emoji, pubkeys]) => {
                    const count = Array.isArray(pubkeys) ? pubkeys.length : 0;
                    if (count === 0) return null;
                    const mine = Array.isArray(pubkeys) && pubkeys.includes(myPubkeyHex);
                    return (
                      <button
                        key={emoji}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!m.envelope_id) return;
                          if (mine) {
                            const seed = getSeedBytes();
                            if (!seed || !myPubkeyHex) return;
                            groups.sendGroupReaction({
                              groupId,
                              targetEnvelopeId: m.envelope_id,
                              emoji, op: 'remove',
                              seed, myPubkeyHex,
                            }).then(() => setGroup(gstore.getGroup(groupId)))
                              .catch(() => setGroup(gstore.getGroup(groupId)));
                          } else {
                            setActionMessage(m);
                          }
                        }}
                        style={{
                          background: mine ? 'rgba(123,150,255,0.18)' : '#13131A',
                          border: mine ? '1px solid #6B8AFE' : '1px solid #232329',
                          borderRadius: 12,
                          padding: '2px 7px',
                          fontSize: 12,
                          color: '#F5F5F7',
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 3,
                          fontFamily: 'inherit',
                          lineHeight: 1.4,
                        }}
                      >
                        <span>{emoji}</span>
                        <span style={{ fontSize: 10.5, color: '#A8A8B0', fontFamily: 'var(--mono, monospace)' }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {!sameNext && (
                <div style={{
                  fontSize: 10, color: '#5A5A65',
                  fontFamily: 'var(--mono, monospace)',
                  padding: '0 6px',
                  display: 'flex', gap: 6,
                  alignSelf: isOut ? 'flex-end' : 'flex-start',
                  letterSpacing: '0.02em',
                }}>
                  <span>{fmtClock(m.ts)}</span>
                  {m.expires_at && (
                    <span>· ⏱ {fmtTTLLeft(m.expires_at)}</span>
                  )}
                  {isOut && (() => {
                    const readCount = Array.isArray(m.read_by) ? m.read_by.length : 0;
                    const isRead = readCount > 0;
                    return (
                      <span style={{
                        color: m.status === 'failed' ? '#FF6B7A' :
                               isRead ? '#60A5FA' :
                               m.status === 'sent' ? '#7B96FF' : '#5A5A65',
                      }}>
                        · {m.status === 'sending' ? '...' :
                           m.status === 'failed' ? '✗' :
                           isRead ? `✓✓ ${readCount}` :
                           m.status === 'sent' ? '✓' : ''}
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEnd} />
      </div>

      {showScrollDown && (
        <button
          onClick={scrollToBottom}
          style={{
            position: 'absolute', right: 14, bottom: 88,
            width: 38, height: 38, borderRadius: '50%',
            background: '#16161B', border: '1px solid #232329',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#F5F5F7', cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}

      {/* TTL bottom sheet */}
      {showTtlMenu && (
        <Sheet onClose={() => setShowTtlMenu(false)}>
          <h3 style={{
            fontSize: 17, fontWeight: 700,
            color: '#F5F5F7',
            letterSpacing: '-0.02em',
            margin: '0 20px 6px',
          }}>
            Час життя повідомлення
          </h3>
          <p style={{
            fontSize: 12, color: '#6B6B72',
            margin: '0 20px 14px', lineHeight: 1.5,
          }}>
            Після цього часу повідомлення зникне у всіх учасників.
          </p>
          {TTL_OPTIONS.map((opt) => {
            const active = ttlSeconds === opt.seconds;
            return (
              <div
                key={opt.seconds}
                onClick={() => { setTtlSeconds(opt.seconds); setShowTtlMenu(false); }}
                style={{
                  padding: '14px 20px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer',
                  color: '#F5F5F7',
                  fontSize: 14,
                  background: active ? '#1A1F2E' : 'transparent',
                  borderLeft: '3px solid ' + (active ? '#7B96FF' : 'transparent'),
                  transition: 'background 0.12s',
                }}
              >
                <span style={{ fontWeight: active ? 600 : 500 }}>{opt.label}</span>
                {active && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7B96FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            );
          })}
        </Sheet>
      )}

      {/* Message action sheet */}
      {/* Mute / unmute sheet */}
      {muteSheetOpen && (
        <Sheet onClose={() => setMuteSheetOpen(false)}>
          {muteEntry ? (
            <>
              <div style={{
                padding: '6px 22px 14px',
                color: '#A8A8B0', fontSize: 13, textAlign: 'center',
              }}>
                Заглушено · {muted.formatMuteUntil(muteEntry.until)}
              </div>
              <button
                onClick={unmuteGroup}
                style={{
                  width: '100%', padding: '14px 22px',
                  background: 'transparent', border: 'none', borderTop: '1px solid #232329',
                  color: '#7B96FF', fontSize: 15, fontWeight: 600,
                  textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                🔔 Розгасити групу
              </button>
            </>
          ) : (
            <>
              <div style={{
                padding: '6px 22px 14px',
                color: '#A8A8B0', fontSize: 13, textAlign: 'center',
              }}>
                Заглушити сповіщення
              </div>
              {muted.MUTE_DURATIONS.map((d) => (
                <button
                  key={d.label}
                  onClick={() => muteFor(d.ms)}
                  style={{
                    width: '100%', padding: '14px 22px',
                    background: 'transparent', border: 'none', borderTop: '1px solid #232329',
                    color: '#F5F5F7', fontSize: 15,
                    textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {d.label}
                </button>
              ))}
            </>
          )}
        </Sheet>
      )}

      {actionMessage && (
        <Sheet onClose={() => setActionMessage(null)}>
          {actionMessage.envelope_id && actionMessage.status !== 'undecryptable' && (
            <div style={{
              display: 'flex', justifyContent: 'space-around', alignItems: 'center',
              padding: '6px 12px 14px', borderBottom: '1px solid #232329',
              gap: 4,
            }}>
              {['👍', '❤️', '😂', '🔥', '😢'].map((emoji) => {
                const mine = (actionMessage.reactions || {});
                const isMine = (mine[emoji] || []).includes(myPubkeyHex);
                return (
                  <button
                    key={emoji}
                    onClick={() => reactClicked(emoji, isMine)}
                    style={{
                      width: 44, height: 44, borderRadius: 22,
                      background: isMine ? 'rgba(123,150,255,0.18)' : 'transparent',
                      border: isMine ? '1px solid #6B8AFE' : '1px solid transparent',
                      fontSize: 22,
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.12s',
                    }}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          )}
          <div style={{
            fontSize: 12.5, color: '#8E8E99',
            padding: '14px 20px 14px',
            borderBottom: '1px solid #232329',
            lineHeight: 1.5,
            fontStyle: 'italic',
          }}>
            {actionMessage.voice
              ? `🎤 Голосове (${formatDuration(actionMessage.voice.duration_ms || 0)})`
              : actionMessage.image
              ? (actionMessage.text
                  ? `📷 Картинка · "${actionMessage.text.slice(0, 60)}${actionMessage.text.length > 60 ? '…' : ''}"`
                  : '📷 Картинка')
              : `"${actionMessage.text?.slice(0, 80) || ''}${actionMessage.text?.length > 80 ? '…' : ''}"`}
          </div>
          {actionMessage.text && (
            <div
              onClick={() => {
                navigator.clipboard?.writeText(actionMessage.text || '').catch(() => {});
                setActionMessage(null);
              }}
              style={{
                padding: '14px 20px', cursor: 'pointer',
                fontSize: 14, color: '#F5F5F7',
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              {actionMessage.image ? 'Скопіювати підпис' : 'Скопіювати'}
            </div>
          )}
          {(() => {
            const isMine = actionMessage.direction === 'out'
              || actionMessage.sender_pubkey === myPubkeyHex;
            // Sender deletes for all; admin can delete anyone's; otherwise
            // only local removal.
            const canDeleteForAll = isMine || isAdmin;
            return (
              <>
                <div
                  onClick={deleteForMe}
                  style={{
                    padding: '14px 20px', cursor: 'pointer',
                    color: canDeleteForAll ? '#F5F5F7' : '#FF6B7A',
                    fontSize: 14, fontWeight: 500,
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                  {canDeleteForAll ? 'Видалити у мене' : 'Видалити у себе'}
                </div>
                {canDeleteForAll && (
                  <div
                    onClick={deleteForEveryone}
                    style={{
                      padding: '14px 20px', cursor: 'pointer',
                      color: '#FF6B7A', fontSize: 14, fontWeight: 500,
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                    {isMine ? 'Видалити у всіх' : 'Видалити для всіх (адмін)'}
                  </div>
                )}
              </>
            );
          })()}
        </Sheet>
      )}

      {/* Composer */}
      {!noKey && (
        recording ? (
          <div style={{
            padding: '10px 12px 14px',
            display: 'flex', gap: 10, alignItems: 'center',
            borderTop: '1px solid #1E1E27',
            background: '#0A0A0B',
          }}>
            <button
              onClick={cancelRecording}
              style={{
                width: 38, height: 38, borderRadius: '50%',
                background: '#13131A',
                border: '1px solid #232329',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#FF6B7A', cursor: 'pointer',
                flexShrink: 0,
              }}
              title="Скасувати"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div style={{
              flex: 1, height: 38,
              background: '#13131A', border: '1px solid #232329',
              borderRadius: 19,
              padding: '0 16px',
              display: 'flex', alignItems: 'center', gap: 10,
              color: '#F5F5F7', fontSize: 13,
            }}>
              <div style={{
                width: 9, height: 9, borderRadius: '50%',
                background: '#FF4A5C',
                animation: 'morokPulse 1.2s ease-in-out infinite',
                flexShrink: 0,
              }} />
              <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 13, color: '#F5F5F7', letterSpacing: '0.02em' }}>
                {formatDuration(recordMs)}
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 11, color: '#5A5A65' }}>
                {Math.floor((MAX_DURATION_MS - recordMs) / 1000)}с
              </div>
            </div>
            <button
              onClick={stopAndSend}
              disabled={voiceBusy}
              style={{
                width: 38, height: 38, borderRadius: '50%',
                background: '#F5F5F7', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: voiceBusy ? 'wait' : 'pointer',
                flexShrink: 0,
              }}
              title="Надіслати"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        ) : (
        <div style={{
          padding: '10px 12px 14px',
          display: 'flex', gap: 8, alignItems: 'flex-end',
          borderTop: '1px solid #1E1E27',
          background: '#0A0A0B',
        }}>
          <button
            onClick={() => setShowTtlMenu(true)}
            style={{
              background: '#13131A',
              border: '1px solid #232329',
              height: 38, padding: '0 11px',
              borderRadius: 19,
              display: 'flex', alignItems: 'center', gap: 5,
              color: '#A8A8B0', cursor: 'pointer',
              fontSize: 11, fontFamily: 'var(--mono, monospace)',
              fontWeight: 600, letterSpacing: '0.02em',
              flexShrink: 0,
            }}
            title="Час життя повідомлення"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            {ttlSeconds < 86400 ? `${ttlSeconds / 3600}г` : `${ttlSeconds / 86400}д`}
          </button>
          <button
            onClick={attachClicked}
            disabled={imageBusy || sending || voiceBusy}
            style={{
              background: '#13131A',
              border: '1px solid #232329',
              width: 38, height: 38,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: imageBusy ? '#5A5A65' : '#A8A8B0',
              cursor: (imageBusy || sending) ? 'wait' : 'pointer',
              flexShrink: 0,
            }}
            title="Додати картинку"
          >
            {imageBusy ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="6"/>
                <line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                <line x1="2" y1="12" x2="6" y2="12"/>
                <line x1="18" y1="12" x2="22" y2="12"/>
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onImagePicked}
            style={{ display: 'none' }}
          />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendClicked();
              }
            }}
            placeholder="Повідомлення..."
            rows={1}
            style={{
              flex: 1, minHeight: 38, maxHeight: 110,
              background: '#13131A',
              border: '1px solid #232329',
              borderRadius: 19,
              padding: '9px 16px',
              color: '#F5F5F7',
              fontSize: 16, fontFamily: 'inherit',
              outline: 'none', resize: 'none',
              lineHeight: 1.4,
            }}
            onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
            onBlur={(e) => e.target.style.borderColor = '#232329'}
          />
          {draft.trim() ? (
            <button
              onClick={sendClicked}
              disabled={!draft.trim() || sending}
              style={{
                width: 38, height: 38, borderRadius: '50%',
                background: (draft.trim() && !sending) ? '#F5F5F7' : '#2A2A33',
                border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: (draft.trim() && !sending) ? 'pointer' : 'not-allowed',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke={(draft.trim() && !sending) ? '#0A0A0B' : '#5A5A65'}
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={startRecording}
              disabled={voiceBusy || sending || imageBusy}
              style={{
                width: 38, height: 38, borderRadius: '50%',
                background: '#F5F5F7',
                border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: (voiceBusy || sending || imageBusy) ? 'wait' : 'pointer',
                flexShrink: 0,
              }}
              title="Записати голосове"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
          )}
        </div>
        )
      )}

      {/* Image lightbox */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.92)',
            zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={`data:${lightboxImage.mime};base64,${lightboxImage.data_b64}`}
            alt="image"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '100%', maxHeight: '100%',
              borderRadius: 8,
              cursor: 'default',
            }}
            draggable={false}
          />
          <button
            onClick={() => setLightboxImage(null)}
            style={{
              position: 'absolute', top: 16, right: 16,
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#F5F5F7', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Закрити"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────── */

function CompactHeader({ title, subtitle, onBack, onTitleClick, onMenuClick, isMuted }) {
  return (
    <div style={{
      padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
      borderBottom: '1px solid #1E1E27',
      background: '#0A0A0B',
    }}>
      <button
        onClick={onBack}
        style={{
          width: 34, height: 34, borderRadius: '50%',
          background: '#16161B', border: '1px solid #232329',
          color: '#A8A8B0', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      {/* Group icon */}
      <div style={{
        width: 34, height: 34, borderRadius: 10,
        background: 'linear-gradient(135deg, #7B96FF 0%, #5A6FE0 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#FFF',
        flexShrink: 0,
        cursor: onTitleClick ? 'pointer' : 'default',
      }}
      onClick={onTitleClick}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>

      <div
        style={{ flex: 1, minWidth: 0, cursor: onTitleClick ? 'pointer' : 'default' }}
        onClick={onTitleClick}
      >
        <div style={{
          fontSize: 14.5, fontWeight: 700,
          color: '#F5F5F7',
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{title}</span>
          {isMuted && (
            <span style={{ fontSize: 12, color: '#6B6B72', flexShrink: 0 }} title="Заглушено">🔕</span>
          )}
        </div>
        {subtitle && (
          <div style={{
            fontSize: 11, color: '#6B6B72',
            fontFamily: 'var(--mono, monospace)',
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {subtitle}
          </div>
        )}
      </div>

      {typeof onMenuClick === 'function' && (
        <button
          onClick={(e) => { e.stopPropagation(); onMenuClick(); }}
          style={{
            width: 34, height: 34, borderRadius: '50%',
            background: '#16161B', border: '1px solid #232329',
            color: '#A8A8B0', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
          title="Дії"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
          </svg>
        </button>
      )}
    </div>
  );
}

function Sheet({ children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.7)', zIndex: 60,
        display: 'flex', alignItems: 'flex-end',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          background: '#16161B',
          borderTop: '1px solid #232329',
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          padding: '12px 0 28px',
        }}
      >
        <div style={{
          width: 36, height: 4, background: '#3F3F45',
          borderRadius: 2, margin: '6px auto 18px',
        }} />
        {children}
      </div>
    </div>
  );
}

/**
 * VoicePlayer — inline audio bubble (same as DM ChatRoom).
 */
function VoicePlayer({ voice, isOut }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return undefined;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setCurrentMs(0); try { a.currentTime = 0; } catch {} };
    const onTime = () => setCurrentMs(Math.floor((a.currentTime || 0) * 1000));
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    a.addEventListener('timeupdate', onTime);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('timeupdate', onTime);
    };
  }, []);

  function toggle(e) {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().catch(() => {});
    } else {
      a.pause();
    }
  }

  const total = Math.max(1, voice.duration_ms || 0);
  const shown = playing ? currentMs : (currentMs > 0 ? currentMs : total);
  const progress = Math.min(1, currentMs / total);
  const accent = isOut ? '#FFFFFF' : '#7B96FF';
  const trackBg = isOut ? 'rgba(255,255,255,0.25)' : 'rgba(123,150,255,0.22)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      minWidth: 180, maxWidth: 240,
    }}>
      <button
        onClick={toggle}
        style={{
          width: 32, height: 32, borderRadius: '50%',
          background: isOut ? 'rgba(255,255,255,0.18)' : 'rgba(123,150,255,0.16)',
          border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0,
          padding: 0,
        }}
      >
        {playing ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill={accent}>
            <rect x="6" y="5" width="4" height="14" rx="1"/>
            <rect x="14" y="5" width="4" height="14" rx="1"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill={accent} style={{ marginLeft: 2 }}>
            <polygon points="6 4 20 12 6 20 6 4"/>
          </svg>
        )}
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{
          height: 3, background: trackBg, borderRadius: 2, overflow: 'hidden',
        }}>
          <div style={{
            width: `${progress * 100}%`, height: '100%',
            background: accent, borderRadius: 2,
            transition: 'width 0.1s linear',
          }} />
        </div>
        <div style={{
          fontFamily: 'var(--mono, monospace)',
          fontSize: 10.5,
          color: isOut ? 'rgba(255,255,255,0.85)' : '#A8A8B0',
          letterSpacing: '0.02em',
        }}>
          {formatDuration(shown)}
        </div>
      </div>
      <audio
        ref={audioRef}
        src={`data:${voice.mime || 'audio/webm'};base64,${voice.data_b64}`}
        preload="metadata"
        style={{ display: 'none' }}
      />
    </div>
  );
}
