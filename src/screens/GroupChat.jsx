import { useEffect, useRef, useState } from 'react';
import * as gstore from '../lib/group_storage.js';
import * as groups from '../lib/groups.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { hexToBytes } from '../lib/crypto.js';

const TTL_OPTIONS = [
  { label: '1 година', seconds: 3600 },
  { label: '1 день', seconds: 86400 },
  { label: '7 днів', seconds: 7 * 86400 },
  { label: '30 днів', seconds: 30 * 86400 },
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
  const longPressTimer = useRef(null);
  const scrollerRef = useRef(null);
  const messagesEnd = useRef(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const isAdmin = group?.creator_pubkey_hex === myPubkeyHex;

  // Refresh group info on mount (e.g. join via token)
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

  // Mark read
  useEffect(() => {
    gstore.markGroupRead(groupId);
  }, [groupId]);

  // Refresh every 2s
  useEffect(() => {
    const id = setInterval(() => {
      setGroup(gstore.getGroup(groupId));
      gstore.markGroupRead(groupId);
    }, 2000);
    return () => clearInterval(id);
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
    setShowScrollDown(dist > SCROLL_BOTTOM_THRESHOLD);
  }

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

  function deleteOwnMessage() {
    if (!actionMessage) return;
    gstore.deleteMessage(groupId, actionMessage.id);
    setActionMessage(null);
    setGroup(gstore.getGroup(groupId));
  }

  function deleteIncomingLocally() {
    if (!actionMessage) return;
    gstore.deleteMessage(groupId, actionMessage.id);
    setActionMessage(null);
    setGroup(gstore.getGroup(groupId));
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

  if (!group) {
    return (
      <div className="screen">
        <div className="topbar">
          <div className="back" onClick={() => onNavigate('chats')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </div>
          <div className="title">Група</div>
        </div>
        <div className="empty-state">
          <div className="desc">Групу не знайдено</div>
        </div>
      </div>
    );
  }

  const messages = group.messages || [];
  const noKey = !group.group_key_b64;

  return (
    <div className="screen">
      <div className="topbar">
        <div className="back" onClick={() => onNavigate('chats')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        <div
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
          onClick={() => onNavigate(`groupinfo/${groupId}`)}
        >
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>👥</span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {group.name || 'Група без назви'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {group.member_count || (group.members?.length ?? 0)} учасників
          </div>
        </div>
      </div>

      {noKey && (
        <div style={{
          margin: '8px 14px 0',
          background: 'rgba(255, 200, 0, 0.08)',
          border: '1px solid rgba(255, 200, 0, 0.25)',
          color: 'var(--text)',
          padding: '10px 12px', borderRadius: 10,
          fontSize: 12.5, lineHeight: 1.5,
        }}>
          ⏳ Чекаємо на ключ групи від адміна. Як тільки прийде — побачите назву і повідомлення.
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        style={{
          flex: 1, overflowY: 'auto',
          padding: '14px 12px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, marginTop: 32 }}>
            Поки немає повідомлень.
          </div>
        )}
        {messages.map((m) => {
          const isOut = m.direction === 'out' || m.sender_pubkey === myPubkeyHex;
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
                maxWidth: '78%',
                alignSelf: isOut ? 'flex-end' : 'flex-start',
                display: 'flex', flexDirection: 'column', gap: 3,
                userSelect: 'none', WebkitUserSelect: 'none',
                cursor: 'pointer',
              }}
            >
              {!isOut && (
                <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, padding: '0 4px' }}>
                  @{m.sender_username || m.sender_pubkey?.slice(0, 8)}
                </div>
              )}
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 16,
                  fontSize: 13.5,
                  lineHeight: 1.4,
                  wordWrap: 'break-word',
                  background: isOut ? 'var(--bubble-out)' : 'var(--bubble-in)',
                  color: isOut ? '#FFF' : 'var(--text)',
                  borderBottomRightRadius: isOut ? 5 : 16,
                  borderBottomLeftRadius: !isOut ? 5 : 16,
                }}
              >
                {m.status === 'undecryptable' ? <span style={{ opacity: 0.7 }}>⚠ {m.error}</span> : m.text}
              </div>
              <div style={{
                fontSize: 10, color: 'var(--text-faint)',
                fontFamily: 'var(--mono)', padding: '0 4px',
                display: 'flex', gap: 4,
                alignSelf: isOut ? 'flex-end' : 'flex-start',
              }}>
                <span>{fmtClock(m.ts)}</span>
                {m.expires_at && <span>· ⏱ {fmtTTLLeft(m.expires_at)}</span>}
                {isOut && (
                  <span style={{ color: 'var(--accent)' }}>
                    · {m.status === 'sending' ? '...' : m.status === 'sent' ? '✓' : m.status === 'failed' ? '✗' : ''}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEnd} />
      </div>

      {showScrollDown && (
        <button
          onClick={scrollToBottom}
          style={{
            position: 'absolute', right: 14, bottom: 80,
            width: 40, height: 40, borderRadius: '50%',
            background: 'var(--surface)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text)', cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}

      {showTtlMenu && (
        <div onClick={() => setShowTtlMenu(false)} style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 50, display: 'flex', alignItems: 'flex-end',
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', background: 'var(--surface)',
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            padding: '12px 0 28px',
          }}>
            <div style={{ width: 32, height: 4, background: 'var(--text-faint)', borderRadius: 2, margin: '6px auto 14px', opacity: 0.4 }} />
            <div style={{ fontSize: 15, fontWeight: 700, padding: '0 18px 14px' }}>
              Як довго зберігати повідомлення?
            </div>
            {TTL_OPTIONS.map((opt) => (
              <div key={opt.seconds}
                onClick={() => { setTtlSeconds(opt.seconds); setShowTtlMenu(false); }}
                style={{
                  padding: '14px 18px',
                  display: 'flex', justifyContent: 'space-between',
                  cursor: 'pointer',
                  color: ttlSeconds === opt.seconds ? 'var(--accent)' : 'var(--text)',
                }}
              >
                <span>{opt.label}</span>
                {ttlSeconds === opt.seconds && <span>✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {actionMessage && (
        <div onClick={() => setActionMessage(null)} style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 60, display: 'flex', alignItems: 'flex-end',
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', background: 'var(--surface)',
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            padding: '12px 0 28px',
          }}>
            <div style={{ width: 32, height: 4, background: 'var(--text-faint)', borderRadius: 2, margin: '6px auto 14px', opacity: 0.4 }} />
            <div style={{
              fontSize: 13, color: 'var(--text-dim)',
              padding: '0 18px 14px',
              borderBottom: '1px solid var(--border)',
            }}>
              {actionMessage.text?.slice(0, 80)}{actionMessage.text?.length > 80 ? '…' : ''}
            </div>
            <div onClick={() => {
              navigator.clipboard?.writeText(actionMessage.text || '').catch(() => {});
              setActionMessage(null);
            }} style={{ padding: '14px 18px', cursor: 'pointer' }}>
              Скопіювати
            </div>
            {(actionMessage.direction === 'out' || actionMessage.sender_pubkey === myPubkeyHex) ? (
              <div onClick={deleteOwnMessage} style={{
                padding: '14px 18px', cursor: 'pointer', color: 'var(--danger)',
              }}>
                Видалити повідомлення
              </div>
            ) : (
              <div onClick={deleteIncomingLocally} style={{
                padding: '14px 18px', cursor: 'pointer', color: 'var(--danger)',
              }}>
                Видалити у себе
              </div>
            )}
          </div>
        </div>
      )}

      {!noKey && (
        <div style={{
          padding: '10px 10px',
          display: 'flex', gap: 7, alignItems: 'flex-end',
          borderTop: '1px solid var(--border)',
        }}>
          <button onClick={() => setShowTtlMenu(true)} style={{
            background: 'transparent', border: 'none',
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-dim)', cursor: 'pointer',
            fontSize: 10, fontFamily: 'var(--mono)',
          }}>
            ⏱{ttlSeconds < 86400 ? `${ttlSeconds / 3600}г` : `${ttlSeconds / 86400}д`}
          </button>
          <textarea value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendClicked(); }
            }}
            placeholder="Повідомлення..."
            rows={1}
            style={{
              flex: 1, minHeight: 36, maxHeight: 100,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 18,
              padding: '8px 14px',
              color: 'var(--text)',
              fontSize: 14, fontFamily: 'var(--font)',
              outline: 'none', resize: 'none',
            }}
          />
          <button onClick={sendClicked} disabled={!draft.trim() || sending} style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--accent)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: draft.trim() && !sending ? 1 : 0.5,
            cursor: draft.trim() && !sending ? 'pointer' : 'not-allowed',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
