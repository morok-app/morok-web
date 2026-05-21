import { useEffect, useRef, useState } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import * as convs from '../lib/conversations.js';

const LONG_PRESS_MS = 500;

function formatTime(unix) {
  if (!unix) return '';
  const now = Date.now() / 1000;
  const diff = now - unix;
  if (diff < 60) return 'щойно';
  if (diff < 3600) return `${Math.floor(diff / 60)}хв`;
  if (diff < 86400) {
    const d = new Date(unix * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}д`;
  const d = new Date(unix * 1000);
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatTTL(seconds) {
  if (!seconds) return '';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}хв`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}г`;
  return `${Math.floor(seconds / 86400)}д`;
}

function Avatar({ username, pubkey, size = 40 }) {
  const hue = pubkey ? parseInt(pubkey.slice(0, 6), 16) % 360 : 0;
  const initial = (username?.[0] || '?').toUpperCase();
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `hsl(${hue}, 45%, 45%)`,
        color: '#fff', fontWeight: 700, fontSize: size * 0.4,
        flexShrink: 0,
      }}
    >{initial}</div>
  );
}

/**
 * Subscribe to a global inbox state.
 * App.jsx exposes it via window.__morok_inbox_state if available.
 * Falls back to "open" if absent (boot).
 */
function useInboxState() {
  const [state, setState] = useState(window.__morok_inbox_state || 'open');
  useEffect(() => {
    const handler = (e) => setState(e.detail);
    window.addEventListener('morok-inbox-state', handler);
    return () => window.removeEventListener('morok-inbox-state', handler);
  }, []);
  return state;
}

export default function ChatsList({ onNavigate }) {
  const [profile, setProfile] = useState(store.loadProfile());
  const [conversations, setConversations] = useState(() => convs.listConversations());
  const [actionConv, setActionConv] = useState(null);
  const longPressTimer = useRef(null);
  const inboxState = useInboxState();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.getMe();
        if (cancelled) return;
        store.saveProfile({
          username: me.username, tier: me.tier, homeRelay: me.home_relay,
          pubkeyHex: store.loadIdentity()?.pubkey_hex,
        });
        setProfile({ username: me.username, tier: me.tier, home_relay: me.home_relay });
      } catch (e) { console.warn('Profile refresh failed:', e); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setConversations(convs.listConversations());
    }, 3000);
    return () => clearInterval(id);
  }, []);

  function startLongPress(conv) {
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
      setActionConv(conv);
    }, LONG_PRESS_MS);
  }
  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function deleteConvClicked() {
    if (!actionConv) return;
    const peer = actionConv.peer_pubkey;
    setActionConv(null);
    convs.deleteConversation(peer);
    setConversations(convs.listConversations());
  }

  const isEmpty = conversations.length === 0;

  const stateBadge = (() => {
    if (inboxState === 'connecting') return { text: 'підключення', color: 'var(--text-dim)' };
    if (inboxState === 'closed' || inboxState === 'error') return { text: 'офлайн', color: 'var(--danger)' };
    return null;
  })();

  return (
    <div className="screen">
      <div className="topbar">
        <div className="title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Чати
          {stateBadge && (
            <span style={{
              fontSize: 10, fontWeight: 500, padding: '2px 7px',
              borderRadius: 8, background: 'var(--surface)',
              color: stateBadge.color, letterSpacing: '0.02em',
            }}>{stateBadge.text}</span>
          )}
        </div>
        <div className="actions" style={{ display: 'flex', gap: 4 }}>
          <button
            className="btn btn-ghost"
            style={{ width: 'auto', height: 36, padding: '0 8px', fontSize: 18 }}
            onClick={() => onNavigate('settings')}
            title="Налаштування"
          >⚙</button>
          <button
            className="btn btn-ghost"
            style={{ width: 'auto', height: 36, padding: '0 12px', fontSize: 12 }}
            onClick={() => onNavigate('profile')}
          >
            @{profile?.username || '...'}
          </button>
        </div>
      </div>

      {profile?.username && !store.isIdentityEncrypted() && (
        <div
          onClick={() => onNavigate('pin-setup-existing')}
          style={{
            margin: '8px 14px 0',
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            borderRadius: 10,
            padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: 10,
            cursor: 'pointer',
            fontSize: 12.5,
          }}
        >
          <span style={{ color: 'var(--danger)', fontSize: 16 }}>⚠</span>
          <div style={{ flex: 1 }}>
            <strong>Захистіть акаунт PIN-кодом</strong>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              Хто має доступ до браузера — може прочитати ваші повідомлення
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      )}

      {isEmpty ? (
        <div className="empty-state">
          <div className="icon-wrap">
            <svg viewBox="0 0 24 24">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <div className="title">Поки немає чатів</div>
          <div className="desc">Натисніть кнопку нижче щоб почати новий чат</div>
        </div>
      ) : (
        <div className="chats-list">
          {conversations.map((conv) => {
            const last = conv.messages[conv.messages.length - 1];
            const unread = (conv.messages || []).filter((m) => m.direction === 'in' && !m.read_at).length;
            return (
              <div
                key={conv.peer_pubkey}
                onClick={() => onNavigate(`chat/${conv.peer_pubkey}`)}
                onMouseDown={() => startLongPress(conv)}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onTouchStart={() => startLongPress(conv)}
                onTouchEnd={cancelLongPress}
                onTouchCancel={cancelLongPress}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px',
                  borderBottom: '1px solid rgba(46,46,56,0.4)',
                  cursor: 'pointer',
                  userSelect: 'none', WebkitUserSelect: 'none',
                }}
              >
                <Avatar username={conv.peer_username} pubkey={conv.peer_pubkey} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{
                      fontWeight: 600, fontSize: 14,
                      letterSpacing: '-0.01em',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      @{conv.peer_username || conv.peer_pubkey.slice(0, 8)}
                    </div>
                    <div style={{
                      fontSize: 11, color: 'var(--text-faint)',
                      fontFamily: 'var(--mono)', flexShrink: 0,
                    }}>{formatTime(last?.ts)}</div>
                  </div>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', gap: 6, marginTop: 2,
                  }}>
                    <div style={{
                      fontSize: 12, color: 'var(--text-dim)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      flex: 1,
                    }}>
                      {last?.direction === 'out' ? 'Ви: ' : ''}
                      {last?.text || (last?.status === 'undecryptable' ? '⚠ не вдалось розшифрувати' : '...')}
                    </div>
                    {last?.ttl && (
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
                        ⏱ {formatTTL(last.ttl)}
                      </div>
                    )}
                    {unread > 0 && (
                      <div style={{
                        minWidth: 18, height: 18, borderRadius: 9,
                        background: 'var(--accent)', color: '#fff',
                        fontSize: 10.5, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 5px',
                      }}>
                        {unread > 99 ? '99+' : unread}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Conversation action sheet */}
      {actionConv && (
        <div
          onClick={() => setActionConv(null)}
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
              @{actionConv.peer_username || actionConv.peer_pubkey.slice(0, 12)}
            </div>
            <div
              onClick={deleteConvClicked}
              style={{
                padding: '14px 18px', cursor: 'pointer',
                color: 'var(--danger)',
              }}
            >Видалити чат</div>
          </div>
        </div>
      )}

      <button
        onClick={() => onNavigate('newchat')}
        style={{
          position: 'absolute', bottom: 24, right: 16,
          width: 56, height: 56, borderRadius: '50%',
          background: 'var(--accent)', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 24px rgba(107, 138, 254, 0.4)',
          cursor: 'pointer', zIndex: 10,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
