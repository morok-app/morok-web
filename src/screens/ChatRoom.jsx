import { useEffect, useRef, useState } from 'react';
import * as convs from '../lib/conversations.js';
import * as msgs from '../lib/messages.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import * as api from '../lib/api.js';
import { hexToBytes } from '../lib/crypto.js';
import { parseBurnerMeta } from '../lib/burner.js';

const TTL_OPTIONS = [
  { seconds: 3600,        label: '1 година' },
  { seconds: 6 * 3600,    label: '6 годин' },
  { seconds: 24 * 3600,   label: '24 години' },
  { seconds: 3 * 86400,   label: '3 дні' },
  { seconds: 7 * 86400,   label: '7 днів' },
];

const LONG_PRESS_MS = 500;
const SCROLL_BOTTOM_THRESHOLD = 80;

function fmtClock(unix) {
  const d = new Date(unix * 1000);
  return d.toTimeString().slice(0, 5);
}

function fmtTTLLeft(expires_at) {
  const now = Math.floor(Date.now() / 1000);
  const remaining = expires_at - now;
  if (remaining <= 0) return 'застаріле';
  const days = Math.floor(remaining / 86400);
  if (days > 0) return `${days}д`;
  const hours = Math.floor(remaining / 3600);
  if (hours > 0) return `${hours}г`;
  return `${Math.floor(remaining / 60)}хв`;
}

function getSeedBytes() {
  const v = vault.getUnlockedSeed();
  if (v) return v;
  const id = store.loadIdentity();
  if (id && !id.encrypted && id.seed_hex) return hexToBytes(id.seed_hex);
  return null;
}

export default function ChatRoom({ peerPubkey, onNavigate }) {
  const [conv, setConv] = useState(() => convs.getConversation(peerPubkey));
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showTtlMenu, setShowTtlMenu] = useState(false);
  const [ttlSeconds, setTtlSeconds] = useState(24 * 3600);
  const [actionMessage, setActionMessage] = useState(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const scrollerRef = useRef(null);
  const messagesEnd = useRef(null);
  const longPressTimer = useRef(null);
  const myProfile = store.loadProfile();
  const myPubkeyHex = myProfile?.pubkey_hex || store.loadIdentity()?.pubkey_hex;

  // Initial mark-read + refresh
  useEffect(() => {
    convs.markConversationRead(peerPubkey);
    const refreshed = convs.getConversation(peerPubkey);
    setConv(refreshed);
  }, [peerPubkey]);

  // Listen to inbox updates
  useEffect(() => {
    function onUpdate(e) {
      if (e.detail?.peerPubkey === peerPubkey) {
        const refreshed = convs.getConversation(peerPubkey);
        setConv(refreshed);
        convs.markConversationRead(peerPubkey);
      }
    }
    window.addEventListener('morok-conv-update', onUpdate);
    return () => window.removeEventListener('morok-conv-update', onUpdate);
  }, [peerPubkey]);

  // Auto-scroll when new messages arrive (only if user was already at bottom)
  useEffect(() => {
    if (!conv) return;
    const el = scrollerRef.current;
    if (!el) return;
    const wasAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < SCROLL_BOTTOM_THRESHOLD;
    if (wasAtBottom) {
      requestAnimationFrame(() => {
        messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, [conv?.messages?.length]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < SCROLL_BOTTOM_THRESHOLD;
    setShowScrollDown(!atBottom);
  }

  function scrollToBottom() {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function startLongPress(message) {
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      setActionMessage(message);
    }, LONG_PRESS_MS);
  }

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  async function deleteForMe() {
    if (!actionMessage) return;
    const msg = actionMessage;
    setActionMessage(null);
    convs.deleteMessage(peerPubkey, msg.id);
    setConv(convs.getConversation(peerPubkey));
  }

  async function deleteForEveryone() {
    if (!actionMessage) return;
    const msg = actionMessage;
    setActionMessage(null);

    if (!msg.envelope_id) {
      // No server-side envelope to target — fall back to local only.
      convs.deleteMessage(peerPubkey, msg.id);
      setConv(convs.getConversation(peerPubkey));
      return;
    }

    try {
      await api.deleteDMMessage(msg.envelope_id, peerPubkey);
      convs.deleteMessage(peerPubkey, msg.id);
      setConv(convs.getConversation(peerPubkey));
    } catch (e) {
      alert(`Не вдалось видалити у співрозмовника: ${e.message}`);
    }
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
      <div className="screen" style={{ background: '#0A0A0B' }}>
        <CompactHeader
          title="Чат"
          subtitle=""
          isBurner={false}
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F5F7' }}>Чат не знайдено</div>
        </div>
      </div>
    );
  }

  const messages = conv.messages || [];

  // Burner detection
  const burnerMeta = parseBurnerMeta(conv.peer_username);
  const isBurner = burnerMeta.isBurner;
  const displayTitle = isBurner
    ? (burnerMeta.label ? `Анонім · ${burnerMeta.label}` : 'Анонім')
    : `@${conv.peer_username || conv.peer_pubkey.slice(0, 12) + '…'}`;
  const displaySubtitle = isBurner
    ? 'анонімна скринька'
    : (conv.peer_home_relay || 'невідомий relay');

  // Compute peer color
  const peerHue = parseInt(conv.peer_pubkey.slice(0, 6), 16) % 360;

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      <CompactHeader
        title={displayTitle}
        subtitle={displaySubtitle}
        isBurner={isBurner}
        peerHue={peerHue}
        firstLetter={(conv.peer_username || conv.peer_pubkey)[0]?.toUpperCase() || '?'}
        onBack={() => onNavigate('chats')}
        onTitleClick={isBurner ? null : () => onNavigate(`peer/${peerPubkey}`)}
      />

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        style={{
          flex: 1, overflowY: 'auto',
          padding: '16px 14px 8px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}
      >
        {messages.length === 0 && (
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
          const isOut = m.direction === 'out';
          const prevMsg = messages[idx - 1];
          const nextMsg = messages[idx + 1];
          const samePrev = prevMsg && prevMsg.direction === m.direction
                       && (m.ts - prevMsg.ts) < 300;
          const sameNext = nextMsg && nextMsg.direction === m.direction
                       && (nextMsg.ts - m.ts) < 300;

          // Bubble radius — tail when first/last in a group
          const radius = 16;
          const tail = 4;
          const borderRadius = isOut
            ? `${radius}px ${samePrev ? tail : radius}px ${sameNext ? tail : radius}px ${radius}px`
            : `${samePrev ? tail : radius}px ${radius}px ${radius}px ${sameNext ? tail : radius}px`;

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
                display: 'flex', flexDirection: 'column', gap: 4,
                marginTop: samePrev ? 0 : 6,
                userSelect: 'none', WebkitUserSelect: 'none',
                cursor: 'pointer',
              }}
            >
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

      {/* Scroll-to-bottom button */}
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
          title="Вниз"
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
            Після цього часу повідомлення зникне у вас і в адресата.
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

      {/* Message long-press action sheet */}
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
          {actionMessage.direction === 'out' && (
            <>
              <div
                onClick={deleteForMe}
                style={{
                  padding: '14px 20px', cursor: 'pointer',
                  color: '#F5F5F7', fontSize: 14, fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                Видалити у мене
              </div>
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
                Видалити у всіх
              </div>
            </>
          )}
          {actionMessage.direction === 'in' && (
            <div
              onClick={deleteForMe}
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
      {isBurner ? (
        <div style={{
          padding: '16px 18px',
          borderTop: '1px solid #1E1E27',
          background: '#13131A',
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: 'rgba(255, 169, 77, 0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, fontSize: 13,
          }}>🔒</div>
          <div style={{
            flex: 1, fontSize: 12.5,
            color: '#8E8E99', lineHeight: 1.55,
          }}>
            Це повідомлення з анонімної скриньки.
            Відправник невідомий — відповісти неможливо.
          </div>
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

function CompactHeader({ title, subtitle, isBurner, peerHue, firstLetter, onBack, onTitleClick }) {
  const clickable = typeof onTitleClick === 'function';
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

      <div
        onClick={clickable ? onTitleClick : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          flex: 1, minWidth: 0,
          cursor: clickable ? 'pointer' : 'default',
          padding: clickable ? '2px 8px 2px 2px' : 0,
          margin: clickable ? '-2px -8px -2px -2px' : 0,
          borderRadius: 10,
          transition: 'background 0.15s',
        }}
        onMouseEnter={clickable ? (e) => { e.currentTarget.style.background = '#13131A'; } : undefined}
        onMouseLeave={clickable ? (e) => { e.currentTarget.style.background = 'transparent'; } : undefined}
        title={clickable ? 'Відкрити профіль' : undefined}
      >
        {firstLetter && (
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: isBurner
              ? 'rgba(255, 169, 77, 0.15)'
              : (peerHue !== undefined ? `hsl(${peerHue}, 45%, 45%)` : '#16161B'),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 13, color: isBurner ? '#FFA94D' : '#fff',
            flexShrink: 0,
          }}>
            {isBurner ? '🔥' : firstLetter}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
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
