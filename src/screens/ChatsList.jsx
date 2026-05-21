import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import * as convs from '../lib/conversations.js';

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
  // Color from pubkey hex
  const hue = pubkey ? parseInt(pubkey.slice(0, 6), 16) % 360 : 0;
  const initial = (username?.[0] || '?').toUpperCase();
  return (
    <div
      className="avatar"
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

export default function ChatsList({ onNavigate }) {
  const [profile, setProfile] = useState(store.loadProfile());
  const [conversations, setConversations] = useState(() => convs.listConversations());

  // Refresh profile
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.getMe();
        if (cancelled) return;
        store.saveProfile({
          username: me.username, tier: me.tier, homeRelay: me.home_relay,
        });
        setProfile({ username: me.username, tier: me.tier, home_relay: me.home_relay });
      } catch (e) { console.warn('Profile refresh failed:', e); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Refresh conversation list every 5s (in case of inbox activity from App-level)
  useEffect(() => {
    const id = setInterval(() => {
      setConversations(convs.listConversations());
    }, 5000);
    return () => clearInterval(id);
  }, []);

  async function logoutClicked() {
    if (!confirm('Вийти з акаунта? Локальні дані видаляться.')) return;
    await api.logout();
    store.wipeAll();
    onNavigate('welcome');
  }

  const isEmpty = conversations.length === 0;

  return (
    <div className="screen">
      <div className="topbar">
        <div className="title">Чати</div>
        <div className="actions">
          <button
            className="btn btn-ghost"
            style={{ width: 'auto', height: 36, padding: '0 12px', fontSize: 12 }}
            onClick={() => onNavigate('profile')}
          >
            @{profile?.username || '...'}
          </button>
        </div>
      </div>

      {isEmpty ? (
        <div className="empty-state">
          <div className="icon-wrap">
            <svg viewBox="0 0 24 24">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <div className="title">Поки немає чатів</div>
          <div className="desc">
            Натисніть кнопку нижче щоб почати новий чат
          </div>
        </div>
      ) : (
        <div className="chats-list">
          {conversations.map((conv) => {
            const last = conv.messages[conv.messages.length - 1];
            const unreadIn = conv.messages.some((m) => m.direction === 'in' && !m.read_at);
            return (
              <div
                key={conv.peer_pubkey}
                className="chat-item"
                onClick={() => onNavigate(`chat/${conv.peer_pubkey}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px',
                  borderBottom: '1px solid rgba(46,46,56,0.4)',
                  cursor: 'pointer',
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
                    {unreadIn && <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />}
                  </div>
                </div>
              </div>
            );
          })}
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
