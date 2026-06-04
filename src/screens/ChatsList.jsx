import { useEffect, useRef, useState } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import * as convs from '../lib/conversations.js';
import * as gstore from '../lib/group_storage.js';
import * as muted from '../lib/muted.js';
import { formatPeerName } from '../lib/display.js';

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

function formatVoiceDuration(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function Avatar({ username, pubkey, size = 40, isGroup }) {
  if (isGroup) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--accent) 0%, #4A5FB0 100%)',
        color: '#fff', fontSize: size * 0.5, flexShrink: 0,
      }}>👥</div>
    );
  }
  const hue = pubkey ? parseInt(pubkey.slice(0, 6), 16) % 360 : 0;
  // For anon users — use the first char of "anon_xxxx" → 'a'
  const displayName = username || `anon_${pubkey?.slice(0, 8) || ''}`;
  const initial = (displayName[0] || '?').toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `hsl(${hue}, 45%, 45%)`,
      color: '#fff', fontWeight: 700, fontSize: size * 0.4,
      flexShrink: 0,
    }}>{initial}</div>
  );
}

function useInboxState() {
  const [state, setState] = useState(window.__morok_inbox_state || 'open');
  useEffect(() => {
    const handler = (e) => setState(e.detail);
    window.addEventListener('morok-inbox-state', handler);
    return () => window.removeEventListener('morok-inbox-state', handler);
  }, []);
  return state;
}

/**
 * Build a unified, sorted list mixing DMs and groups.
 */
function buildMixedList() {
  const items = [];

  for (const c of convs.listConversations()) {
    const last = c.messages?.[c.messages.length - 1];
    const unread = (c.messages || []).filter((m) => m.direction === 'in' && !m.read_at).length;
    items.push({
      kind: 'dm',
      id: c.peer_pubkey,
      title: `@${formatPeerName({ username: c.peer_username, pubkey: c.peer_pubkey })}`,
      pubkey: c.peer_pubkey,
      username: c.peer_username,
      last,
      unread,
      ts: c.updated_at || last?.ts || 0,
      raw: c,
    });
  }

  for (const g of gstore.listGroups()) {
    const last = g.messages?.[g.messages.length - 1];
    const unread = (g.messages || []).filter((m) => m.direction === 'in' && !m.read_at).length;
    items.push({
      kind: 'group',
      id: g.group_id,
      title: g.name || 'Група без назви',
      last,
      unread,
      ts: g.updated_at || last?.ts || 0,
      raw: g,
    });
  }

  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return items;
}

export default function ChatsList({ onNavigate }) {
  const [profile, setProfile] = useState(store.loadProfile());
  const [items, setItems] = useState(() => buildMixedList());
  const [actionItem, setActionItem] = useState(null);
  const longPressTimer = useRef(null);
  const inboxState = useInboxState();
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [mutedKeys, setMutedKeys] = useState(new Set());

  // Refresh muted state periodically (cheap: 1 IDB read every 3s)
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const list = await muted.listMuted();
      if (cancelled) return;
      setMutedKeys(new Set(list.map((e) => e.key)));
    }
    refresh();
    const id = setInterval(refresh, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

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
    const id = setInterval(() => setItems(buildMixedList()), 3000);
    return () => clearInterval(id);
  }, []);

  function startLongPress(item) {
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
      setActionItem(item);
    }, LONG_PRESS_MS);
  }
  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }

  async function deleteForMe() {
    if (!actionItem) return;
    if (actionItem.kind === 'dm') {
      convs.deleteConversation(actionItem.id);
    } else {
      // Group "remove from list" — local only. Note: next incoming
      // message will re-create the local stub.
      gstore.removeGroup(actionItem.id);
    }
    setActionItem(null);
    setItems(buildMixedList());
  }

  async function deleteForAll() {
    if (!actionItem) return;
    const item = actionItem;
    setActionItem(null);

    if (item.kind === 'dm') {
      // Best-effort: for every outgoing envelope, ask the relay to drop
      // it from the recipient's inbox. Failures are swallowed — the goal
      // is "do as much as we can"; local cleanup happens unconditionally.
      const outgoing = (item.raw.messages || []).filter(
        (m) => m.direction === 'out' && m.envelope_id,
      );
      if (outgoing.length > 0) {
        await Promise.allSettled(
          outgoing.map((m) => api.deleteDMMessage(m.envelope_id, item.id)),
        );
      }
      convs.deleteConversation(item.id);
    } else {
      // Group: depending on role.
      const myPubkey = store.loadIdentity()?.pubkey_hex;
      const isAdmin = item.raw.creator_pubkey_hex === myPubkey;
      try {
        if (isAdmin) {
          // DELETE /groups/{id} — only the creator may do this; relay
          // tears down membership for everyone.
          await api.deleteGroup(item.id);
        } else {
          // Leave: remove myself from members.
          await api.removeGroupMember(item.id, myPubkey);
        }
      } catch (e) {
        alert(`Помилка: ${e.message}`);
      }
      gstore.removeGroup(item.id);
    }
    setItems(buildMixedList());
  }

  function openItem(item) {
    if (item.kind === 'dm') onNavigate(`chat/${item.id}`);
    else onNavigate(`group/${item.id}`);
  }

  const isEmpty = items.length === 0;
  const isAnon = profile && !profile.username;
  const isLocked = store.isIdentityEncrypted();
  const myPubkey = store.loadIdentity()?.pubkey_hex;
  const myHandle = profile?.username
    ? `@${profile.username}`
    : `@anon_${myPubkey?.slice(0, 8) || '????????'}`;

  const stateBadge = (() => {
    if (inboxState === 'connecting') return { text: 'підключення', color: 'var(--text-dim)' };
    if (inboxState === 'closed' || inboxState === 'error') return { text: 'офлайн', color: 'var(--danger)' };
    return null;
  })();

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      {/* ── HEADER ──────────────────────────────────────────── */}
      <div style={{
        padding: '20px 20px 14px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 32, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#F5F5F7', lineHeight: 1,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            Чати
            {stateBadge && (
              <span style={{
                fontSize: 9.5, fontWeight: 600,
                padding: '4px 8px',
                borderRadius: 100,
                background: '#16161B',
                border: '1px solid #232329',
                color: stateBadge.color === 'var(--danger)' ? '#FF6B7A' : '#8E8E99',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}>{stateBadge.text}</span>
            )}
          </div>
          <div
            onClick={() => onNavigate('profile')}
            style={{
              fontSize: 12.5, color: '#6B6B72',
              marginTop: 6,
              fontFamily: 'var(--mono, monospace)',
              letterSpacing: '0.02em',
              cursor: 'pointer',
              display: 'inline-block',
            }}
          >
            {myHandle}
          </div>
        </div>

        {/* Pill with action buttons */}
        <div style={{
          display: 'flex',
          background: '#16161B',
          border: '1px solid #232329',
          borderRadius: 100,
          padding: 3,
          gap: 0,
          flexShrink: 0,
        }}>
          <button
            onClick={() => onNavigate('tools')}
            title="Інструменти"
            style={{
              background: 'transparent', border: 'none',
              width: 34, height: 30, borderRadius: 100,
              color: '#A8A8B0', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0,
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          </button>
          <button
            onClick={() => onNavigate('settings')}
            title="Налаштування"
            style={{
              background: 'transparent', border: 'none',
              width: 34, height: 30, borderRadius: 100,
              color: '#A8A8B0', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0,
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Anonymous user banner — invites to claim a username */}
      {isAnon && (
        <div
          onClick={() => onNavigate('claim')}
          style={{
            margin: '6px 20px 0',
            background: '#16161B',
            border: '1px solid #232329',
            borderRadius: 12,
            padding: '12px 14px',
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer',
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'rgba(107, 138, 254, 0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#7B96FF', flexShrink: 0,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#F5F5F7' }}>
              Створіть юзернейм
            </div>
            <div style={{ fontSize: 11.5, color: '#6B6B72', marginTop: 2 }}>
              Інакше акаунт видалиться через 7 днів неактивності
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3F3F45" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      )}

      {/* PIN setup banner */}
      {!isAnon && !isLocked && (
        <div
          onClick={() => onNavigate('pin-setup-existing')}
          style={{
            margin: '6px 20px 0',
            background: '#16161B',
            border: '1px solid #232329',
            borderRadius: 12,
            padding: '12px 14px',
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer',
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'rgba(255, 107, 122, 0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#FF6B7A', flexShrink: 0,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#F5F5F7' }}>
              Захистіть акаунт PIN-кодом
            </div>
            <div style={{ fontSize: 11.5, color: '#6B6B72', marginTop: 2 }}>
              Хто має доступ до браузера — може прочитати ваші повідомлення
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3F3F45" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      )}

      {isEmpty ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '40px 24px',
          textAlign: 'center', gap: 16,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: '#16161B',
            border: '1px solid #232329',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#3F3F45',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#F5F5F7', letterSpacing: '-0.01em' }}>
            Поки немає чатів
          </div>
          <div style={{ fontSize: 13, color: '#6B6B72', maxWidth: 280, lineHeight: 1.5 }}>
            Натисніть кнопку нижче щоб почати новий чат або групу
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', marginTop: 10 }}>
          {items.map((item) => {
            const last = item.last;
            const isGroup = item.kind === 'group';
            const muteKey = isGroup
              ? muted.groupKey(item.id)
              : (item.username ? muted.dmKey(item.username) : null);
            const isMuted = !!(muteKey && mutedKeys.has(muteKey));
            return (
              <div
                key={`${item.kind}-${item.id}`}
                className="lin-chat-row"
                onClick={() => openItem(item)}
                onMouseDown={() => startLongPress(item)}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onTouchStart={() => startLongPress(item)}
                onTouchEnd={cancelLongPress}
                onTouchCancel={cancelLongPress}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 20px',
                  cursor: 'pointer',
                  userSelect: 'none', WebkitUserSelect: 'none',
                  transition: 'background 0.12s',
                }}
              >
                <Avatar
                  username={item.username}
                  pubkey={item.pubkey}
                  isGroup={isGroup}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'baseline', gap: 8,
                  }}>
                    <div style={{
                      fontWeight: 600, fontSize: 14.5,
                      color: '#F5F5F7',
                      letterSpacing: '-0.01em',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
                    }}>
                      <span style={{
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{item.title}</span>
                      {isMuted && (
                        <span style={{ fontSize: 11, color: '#5A5A65', flexShrink: 0 }} title="Заглушено">🔕</span>
                      )}
                    </div>
                    <div style={{
                      fontSize: 11, color: '#5A5A65',
                      fontFamily: 'var(--mono, monospace)', flexShrink: 0,
                    }}>{formatTime(last?.ts)}</div>
                  </div>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', gap: 6, marginTop: 3,
                  }}>
                    <div style={{
                      fontSize: 12.5, color: '#8E8E99',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      flex: 1, lineHeight: 1.4,
                    }}>
                      {isGroup && last && last.direction !== 'out'
                        ? `${formatPeerName({ username: last.sender_username, pubkey: last.sender_pubkey })}: `
                        : (last?.direction === 'out' ? 'Ви: ' : '')}
                      {last?.voice
                        ? `🎤 Голосове (${formatVoiceDuration(last.voice.duration_ms)})`
                        : last?.image
                        ? (last.text ? `📷 ${last.text}` : '📷 Картинка')
                        : (last?.text || (last?.status === 'undecryptable' ? '⚠ не вдалось розшифрувати' : '...'))}
                    </div>
                    {last?.ttl && (
                      <div style={{ fontSize: 10, color: '#5A5A65', fontFamily: 'var(--mono, monospace)' }}>
                        ⏱ {formatTTL(last.ttl)}
                      </div>
                    )}
                    {item.unread > 0 && (
                      <div style={{
                        minWidth: 18, height: 18, borderRadius: 9,
                        background: isMuted ? '#3F3F45' : '#6B8AFE',
                        color: isMuted ? '#A8A8B0' : '#fff',
                        fontSize: 10.5, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 5px',
                      }}>
                        {item.unread > 99 ? '99+' : item.unread}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .lin-chat-row:hover { background: #111116; }
        .lin-chat-row:active { background: #16161B; }
      `}</style>

      {actionItem && (
        <div
          onClick={() => setActionItem(null)}
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
              width: '100%', background: '#16161B',
              borderTop: '1px solid #232329',
              borderTopLeftRadius: 22, borderTopRightRadius: 22,
              padding: '12px 0 28px',
            }}
          >
            <div style={{ width: 36, height: 4, background: '#3F3F45', borderRadius: 2, margin: '6px auto 14px' }} />
            <div style={{
              fontSize: 13, color: '#8E8E99',
              padding: '0 20px 14px',
              borderBottom: '1px solid #232329',
              fontWeight: 500,
            }}>
              {actionItem.title}
            </div>
            {actionItem.kind === 'group' && (
              <div
                onClick={() => { onNavigate(`groupinfo/${actionItem.id}`); setActionItem(null); }}
                style={{
                  padding: '14px 20px', cursor: 'pointer',
                  fontSize: 14, color: '#F5F5F7',
                }}
              >Інфо групи</div>
            )}
            {actionItem.kind === 'dm' && (
              <>
                <div
                  onClick={deleteForMe}
                  style={{
                    padding: '14px 20px', cursor: 'pointer',
                    color: '#F5F5F7', fontSize: 14, fontWeight: 500,
                  }}
                >Видалити чат у мене</div>
                <div
                  onClick={deleteForAll}
                  style={{
                    padding: '14px 20px', cursor: 'pointer',
                    color: '#FF6B7A', fontSize: 14, fontWeight: 500,
                  }}
                >Видалити чат у всіх</div>
              </>
            )}
            {actionItem.kind === 'group' && (() => {
              const myPubkey = store.loadIdentity()?.pubkey_hex;
              const isAdmin = actionItem.raw.creator_pubkey_hex === myPubkey;
              return (
                <div
                  onClick={deleteForAll}
                  style={{
                    padding: '14px 20px', cursor: 'pointer',
                    color: '#FF6B7A', fontSize: 14, fontWeight: 500,
                  }}
                >{isAdmin ? 'Видалити групу для всіх' : 'Вийти з групи'}</div>
              );
            })()}
          </div>
        </div>
      )}

      {showNewMenu && (
        <div
          onClick={() => setShowNewMenu(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.7)', zIndex: 70,
            display: 'flex', alignItems: 'flex-end',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', background: '#16161B',
              borderTop: '1px solid #232329',
              borderTopLeftRadius: 22, borderTopRightRadius: 22,
              padding: '12px 0 28px',
            }}
          >
            <div style={{ width: 36, height: 4, background: '#3F3F45', borderRadius: 2, margin: '6px auto 18px' }} />
            <div
              onClick={() => { setShowNewMenu(false); onNavigate('newchat'); }}
              style={{
                padding: '14px 20px', cursor: 'pointer',
                display: 'flex', gap: 14, alignItems: 'center',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(107, 138, 254, 0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#7B96FF',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <span style={{ fontSize: 14, color: '#F5F5F7', fontWeight: 500 }}>Новий чат</span>
            </div>
            <div
              onClick={() => { setShowNewMenu(false); onNavigate('newgroup'); }}
              style={{
                padding: '14px 20px', cursor: 'pointer',
                display: 'flex', gap: 14, alignItems: 'center',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(107, 138, 254, 0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#7B96FF',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <span style={{ fontSize: 14, color: '#F5F5F7', fontWeight: 500 }}>Нова група</span>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setShowNewMenu(true)}
        style={{
          position: 'absolute', bottom: 24, right: 20,
          width: 54, height: 54, borderRadius: '50%',
          background: '#F5F5F7', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 4px 12px rgba(107, 138, 254, 0.15)',
          cursor: 'pointer', zIndex: 10,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
