import { useEffect, useRef, useState } from 'react';
import * as convs from '../lib/conversations.js';
import * as msgs from '../lib/messages.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import * as api from '../lib/api.js';
import { hexToBytes } from '../lib/crypto.js';
import { parseBurnerMeta } from '../lib/burner.js';

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
  const fromVault = vault.getUnlockedSeed();
  if (fromVault) return fromVault;
  const id = store.loadIdentity();
  if (id && !id.encrypted && id.seed_hex) return hexToBytes(id.seed_hex);
  return null;
}

export default function ChatRoom({ peerPubkey, onNavigate }) {
  const myProfile = store.loadProfile();
  const myPubkeyHex = myProfile?.pubkey_hex || store.loadIdentity()?.pubkey_hex;

  const [conv, setConv] = useState(() => convs.getConversation(peerPubkey));
  const [draft, setDraft] = useState('');
  const [ttlSeconds, setTtlSeconds] = useState(86400);
  const [sending, setSending] = useState(false);
  const [showTtlMenu, setShowTtlMenu] = useState(false);

  // Long-press selection
  const [actionMessage, setActionMessage] = useState(null); // {id, direction, envelope_id}
  const longPressTimer = useRef(null);

  // Scroll
  const scrollerRef = useRef(null);
  const messagesEnd = useRef(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Mark conversation read on open
  useEffect(() => {
    convs.markConversationRead(peerPubkey);
  }, [peerPubkey]);

  // Refresh every 2s
  useEffect(() => {
    const id = setInterval(() => {
      const fresh = convs.getConversation(peerPubkey);
      setConv(fresh);
      // Also mark read on each refresh — covers new incoming while we're here
      convs.markConversationRead(peerPubkey);
    }, 2000);
    return () => clearInterval(id);
  }, [peerPubkey]);

  // Auto-scroll to bottom on new messages, unless user scrolled up
  useEffect(() => {
    if (!scrollerRef.current) return;
    const el = scrollerRef.current;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist < SCROLL_BOTTOM_THRESHOLD * 2) {
      messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conv?.messages?.length]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(dist > SCROLL_BOTTOM_THRESHOLD);
  }

  function scrollToBottom() {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }

  // Long-press handlers
  function startLongPress(message) {
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      // Light haptic if available
      if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
      setActionMessage(message);
    }, LONG_PRESS_MS);
  }
  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  async function deleteMessageClicked() {
    if (!actionMessage) return;
    const msg = actionMessage;
    setActionMessage(null);

    // For 'out' messages with envelope_id — try to ack on server so it's
    // removed from recipient's inbox if not yet delivered.
    // For 'in' messages — they were already acked when received; just
    // delete locally.
    if (msg.direction === 'out' && msg.envelope_id) {
      try {
        await api.ackEnvelope(msg.envelope_id);
      } catch (e) {
        // Common: not in our inbox (we're not the recipient).
        // Silent — local delete still proceeds.
        console.warn('Server ack failed (ok):', e?.message);
      }
    }

    convs.deleteMessage(peerPubkey, msg.id);
    setConv(convs.getConversation(peerPubkey));
  }

  async function sendClicked() {
    if (!draft.trim() || sending) return;
    const seed = getSeedBytes();
    if (!seed) {
      alert('Сеанс закінчився. Перезавантажте сторінку.');
      return;
    }
    if (!myPubkeyHex) {
      alert('Не знайдено мій pubkey.');
      return;
    }
    setSending(true);
    try {
      await msgs.sendDM({
        seed, myPubkeyHex,
        peerPubkeyHex: peerPubkey,
        plaintext: draft.trim(),
        ttlSeconds,
      });
      vault.refreshSession();
      setDraft('');
      setConv(convs.getConversation(peerPubkey));
    } catch (e) {
      alert(`Помилка надсилання: ${e.message}`);
    } finally {
      setSending(false);
    }
  }

  if (!conv) {
    return (
      <div className="screen">
        <div className="topbar">
          <div className="back" onClick={() => onNavigate('chats')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </div>
          <div className="title">Чат</div>
        </div>
        <div className="empty-state">
          <div className="desc">Чат не знайдено</div>
        </div>
      </div>
    );
  }

  const messages = conv.messages || [];

  // Detect if this is a burner-inbox DM (anonymous one-way message).
  // In that case we can't reply (the sender's ephemeral keypair is gone)
  // and we should display a friendlier header.
  const burnerMeta = parseBurnerMeta(conv.peer_username);
  const isBurner = burnerMeta.isBurner;
  const displayTitle = isBurner
    ? (burnerMeta.label ? `Анонім · ${burnerMeta.label}` : 'Анонім')
    : `@${conv.peer_username || conv.peer_pubkey.slice(0, 12) + '…'}`;
  const displaySubtitle = isBurner
    ? 'анонімна скринька'
    : (conv.peer_home_relay || 'невідомий relay');

  return (
    <div className="screen">
      <div className="topbar">
        <div className="back" onClick={() => onNavigate('chats')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {isBurner && <span style={{ fontSize: 14 }}>🔥</span>}
            <span style={{
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{displayTitle}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {displaySubtitle}
          </div>
        </div>
      </div>

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
            Поки немає повідомлень.<br/>Напишіть перше повідомлення нижче.
          </div>
        )}
        {messages.map((m) => (
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
              alignSelf: m.direction === 'out' ? 'flex-end' : 'flex-start',
              display: 'flex', flexDirection: 'column', gap: 3,
              userSelect: 'none', WebkitUserSelect: 'none',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 16,
                fontSize: 13.5,
                lineHeight: 1.4,
                wordWrap: 'break-word',
                background: m.direction === 'out' ? 'var(--bubble-out)' : 'var(--bubble-in)',
                color: m.direction === 'out' ? '#FFF' : 'var(--text)',
                borderBottomRightRadius: m.direction === 'out' ? 5 : 16,
                borderBottomLeftRadius: m.direction === 'in' ? 5 : 16,
              }}
            >
              {m.status === 'undecryptable' ? <span style={{ opacity: 0.7 }}>⚠ {m.error}</span> : m.text}
            </div>
            <div style={{
              fontSize: 10, color: 'var(--text-faint)',
              fontFamily: 'var(--mono)', padding: '0 4px',
              display: 'flex', gap: 4,
              alignSelf: m.direction === 'out' ? 'flex-end' : 'flex-start',
            }}>
              <span>{fmtClock(m.ts)}</span>
              {m.expires_at && <span>· ⏱ {fmtTTLLeft(m.expires_at)}</span>}
              {m.direction === 'out' && (
                <span style={{ color: 'var(--accent)' }}>
                  · {m.status === 'sending' ? '...' : m.status === 'sent' ? '✓' : m.status === 'failed' ? '✗' : ''}
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEnd} />
      </div>

      {/* Scroll-to-bottom button */}
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
          title="Вниз"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}

      {/* TTL bottom sheet */}
      {showTtlMenu && (
        <div
          onClick={() => setShowTtlMenu(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 50,
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', background: 'var(--surface)',
              borderTopLeftRadius: 22, borderTopRightRadius: 22,
              padding: '12px 0 28px',
            }}
          >
            <div style={{ width: 32, height: 4, background: 'var(--text-faint)', borderRadius: 2, margin: '6px auto 14px', opacity: 0.4 }} />
            <div style={{ fontSize: 15, fontWeight: 700, padding: '0 18px 14px' }}>
              Як довго зберігати повідомлення?
            </div>
            {TTL_OPTIONS.map((opt) => (
              <div
                key={opt.seconds}
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

      {/* Message action sheet (long-press) */}
      {actionMessage && (
        <div
          onClick={() => setActionMessage(null)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 60,
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', background: 'var(--surface)',
              borderTopLeftRadius: 22, borderTopRightRadius: 22,
              padding: '12px 0 28px',
            }}
          >
            <div style={{ width: 32, height: 4, background: 'var(--text-faint)', borderRadius: 2, margin: '6px auto 14px', opacity: 0.4 }} />
            <div style={{
              fontSize: 13, color: 'var(--text-dim)',
              padding: '0 18px 14px',
              borderBottom: '1px solid var(--border)',
            }}>
              {actionMessage.text?.slice(0, 80)}{actionMessage.text?.length > 80 ? '…' : ''}
            </div>
            <div
              onClick={() => {
                navigator.clipboard?.writeText(actionMessage.text || '').catch(() => {});
                setActionMessage(null);
              }}
              style={{ padding: '14px 18px', cursor: 'pointer' }}
            >Скопіювати</div>
            {actionMessage.direction === 'out' && (
              <div
                onClick={deleteMessageClicked}
                style={{
                  padding: '14px 18px', cursor: 'pointer',
                  color: 'var(--danger)',
                }}
              >Видалити повідомлення</div>
            )}
            {actionMessage.direction === 'in' && (
              <div
                onClick={() => {
                  convs.deleteMessage(peerPubkey, actionMessage.id);
                  setConv(convs.getConversation(peerPubkey));
                  setActionMessage(null);
                }}
                style={{
                  padding: '14px 18px', cursor: 'pointer',
                  color: 'var(--danger)',
                }}
              >Видалити у себе</div>
            )}
          </div>
        </div>
      )}

      {/* Composer — replaced by a "read-only" banner for burner-inbox DMs */}
      {isBurner ? (
        <div style={{
          padding: '14px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <div style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>🔒</div>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Це повідомлення з анонімної скриньки. Відправник невідомий — відповісти неможливо.
          </div>
        </div>
      ) : (
        <div style={{
          padding: '10px 10px',
          display: 'flex', gap: 7, alignItems: 'flex-end',
          borderTop: '1px solid var(--border)',
        }}>
          <button
            onClick={() => setShowTtlMenu(true)}
            style={{
              background: 'transparent', border: 'none',
              width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-dim)', cursor: 'pointer',
              fontSize: 10, fontFamily: 'var(--mono)',
            }}
            title="Час життя повідомлення"
          >
            ⏱{ttlSeconds < 86400 ? `${ttlSeconds / 3600}г` : `${ttlSeconds / 86400}д`}
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
          <button
            onClick={sendClicked}
            disabled={!draft.trim() || sending}
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--accent)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: draft.trim() && !sending ? 1 : 0.5,
              cursor: draft.trim() && !sending ? 'pointer' : 'not-allowed',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
