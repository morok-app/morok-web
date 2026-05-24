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

      <CompactHeader
        title={group.name || 'Група без назви'}
        subtitle={`${memberCount} учасників`}
        onBack={() => onNavigate('chats')}
        onTitleClick={() => onNavigate(`groupinfo/${groupId}`)}
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
                  padding: '9px 13px',
                  borderRadius,
                  fontSize: 14, lineHeight: 1.4,
                  wordWrap: 'break-word',
                  background: isOut ? '#6B8AFE' : '#16161B',
                  color: isOut ? '#FFF' : '#F5F5F7',
                  border: isOut ? 'none' : '1px solid #1E1E27',
                  letterSpacing: '-0.005em',
                }}
              >
                {m.status === 'undecryptable' ? (
                  <span style={{ opacity: 0.7, fontStyle: 'italic' }}>
                    ⚠ {m.error || 'не вдалось розшифрувати'}
                  </span>
                ) : m.text}
              </div>

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
                  {isOut && (
                    <span style={{
                      color: m.status === 'failed' ? '#FF6B7A' :
                             m.status === 'sent' ? '#7B96FF' : '#5A5A65',
                    }}>
                      · {m.status === 'sending' ? '...' :
                         m.status === 'sent' ? '✓' :
                         m.status === 'failed' ? '✗' : ''}
                    </span>
                  )}
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
      {actionMessage && (
        <Sheet onClose={() => setActionMessage(null)}>
          <div style={{
            fontSize: 12.5, color: '#8E8E99',
            padding: '0 20px 14px',
            borderBottom: '1px solid #232329',
            lineHeight: 1.5,
            fontStyle: 'italic',
          }}>
            "{actionMessage.text?.slice(0, 80)}{actionMessage.text?.length > 80 ? '…' : ''}"
          </div>
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
            Скопіювати
          </div>
          {(actionMessage.direction === 'out' || actionMessage.sender_pubkey === myPubkeyHex) ? (
            <div
              onClick={deleteOwnMessage}
              style={{
                padding: '14px 20px', cursor: 'pointer',
                color: '#FF6B7A', fontSize: 14, fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              Видалити повідомлення
            </div>
          ) : (
            <div
              onClick={deleteIncomingLocally}
              style={{
                padding: '14px 20px', cursor: 'pointer',
                color: '#FF6B7A', fontSize: 14, fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              Видалити у себе
            </div>
          )}
        </Sheet>
      )}

      {/* Composer */}
      {!noKey && (
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
              fontSize: 14, fontFamily: 'inherit',
              outline: 'none', resize: 'none',
              lineHeight: 1.4,
            }}
            onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
            onBlur={(e) => e.target.style.borderColor = '#232329'}
          />
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
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────── */

function CompactHeader({ title, subtitle, onBack, onTitleClick }) {
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
        }}>
          {title}
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
