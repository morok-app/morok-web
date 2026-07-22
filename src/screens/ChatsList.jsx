import { useEffect, useRef, useState } from 'react';
import { hapticTap } from '../lib/haptics.js';
import AvatarShared from '../components/Avatar.jsx';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import * as convs from '../lib/conversations.js';
import * as gstore from '../lib/group_storage.js';
import * as muted from '../lib/muted.js';
import * as contacts from '../lib/contacts.js';
import { formatPeerName } from '../lib/display.js';
import * as groupsLib from '../lib/groups.js';

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

function Avatar(props) {
  return <AvatarShared {...props} />;
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
/**
 * Build the unified list of DMs + groups for the chats screen.
 *
 * Each item is tagged with a `category`:
 *   'chat'    — shows up in the main "Чати" tab
 *   'request' — shows up in "Запити повідомлень" tab
 *
 * Categorisation rules for DMs:
 *   - peer blocked  → item is omitted entirely (privacy-preserving filter)
 *   - peer is an explicit contact → 'chat'
 *   - user has sent at least one outgoing message in this conv:
 *       'chat'   when contactsOnly is OFF (user has engaged → counts as a real chat)
 *       'request' when contactsOnly is ON (stricter mode: stranger stays in requests
 *                until explicitly added)
 *   - otherwise (incoming-only from a stranger) → 'request'
 *
 * Groups are always 'chat' (joining a group is itself a consent step).
 */
function buildMixedList(contactsOnly) {
  const items = [];

  for (const c of convs.listConversations()) {
    // Drop conversations with blocked peers — they shouldn't surface anywhere.
    if (contacts.isBlocked(c.peer_pubkey)) continue;

    const last = c.messages?.[c.messages.length - 1];
    const unread = (c.messages || []).filter((m) => m.direction === 'in' && !m.read_at).length;

    const isContact = contacts.isInContacts(c.peer_pubkey);
    const hasOutgoing = (c.messages || []).some((m) => m.direction === 'out');
    let category;
    if (isContact) {
      category = 'chat';
    } else if (hasOutgoing && !contactsOnly) {
      category = 'chat';
    } else {
      category = 'request';
    }

    items.push({
      kind: 'dm',
      id: c.peer_pubkey,
      title: `@${formatPeerName({ username: c.peer_username, pubkey: c.peer_pubkey })}`,
      pubkey: c.peer_pubkey,
      username: c.peer_username,
      last,
      unread,
      ts: c.updated_at || last?.ts || 0,
      category,
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
      category: 'chat',
      raw: g,
    });
  }

  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return items;
}

export default function ChatsList({ onNavigate, activeChatId = null }) {
  const [profile, setProfile] = useState(store.loadProfile());
  const [contactsOnly, setContactsOnly] = useState(
    () => !!store.getPreference('contacts_only_mode', false)
  );
  const [items, setItems] = useState(() => buildMixedList(contactsOnly));
  const [activeTab, setActiveTab] = useState('chats');   // 'chats' | 'requests'
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
    const id = setInterval(() => {
      setItems(buildMixedList(contactsOnly));
      // Самотроттлиться всередині (раз на 20с): ловить групи, видалені
      // адміном, навіть якщо вкладка зі списком висить відкритою. Без
      // цього звірка працювала ЛИШЕ на mount — якщо групу видалили
      // поки список уже відкритий, вона не зникала до перезавантаження.
      groupsLib.validateGroupsAgainstRelay()
        .then((removedAny) => { if (removedAny) setItems(buildMixedList(contactsOnly)); })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [contactsOnly]);

  // Фонова валідація груп: якщо адмін видалив групу на релеї, інші
  // учасники інакше про це не дізнаються — група висітиме в списку
  // вічно. Раз на відкриття списку (з троттлінгом у groups.js)
  // звіряємо локальні групи з релеєм і зносимо мертві.
  useEffect(() => {
    let cancelled = false;
    groupsLib.validateGroupsAgainstRelay()
      .then((removedAny) => {
        if (removedAny && !cancelled) setItems(buildMixedList(contactsOnly));
      })
      .catch(() => { /* мережа лягла — спробуємо наступного разу */ });
    return () => { cancelled = true; };
  }, []);

  // Re-poll the Settings preference. Cheap enough — synchronous local-storage
  // read every 2s — and lets the user flip the toggle in Settings and see
  // the chat list re-categorise without having to navigate back/forward.
  useEffect(() => {
    const id = setInterval(() => {
      const cur = !!store.getPreference('contacts_only_mode', false);
      if (cur !== contactsOnly) setContactsOnly(cur);
    }, 2000);
    return () => clearInterval(id);
  }, [contactsOnly]);

  function startLongPress(item) {
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      hapticTap();
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
    setItems(buildMixedList(contactsOnly));
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
          // tears down membership for everyone. Pass seed so the relay
          // can federate group_gone to members on other relays (signed).
          let seed = null;
          try {
            const vault = await import('../lib/vault.js');
            seed = vault.getUnlockedSeed?.() || null;
            if (!seed) {
              const id = store.loadIdentity();
              if (id && !id.encrypted && id.seed_hex) {
                const { hexToBytes } = await import('../lib/crypto.js');
                seed = hexToBytes(id.seed_hex);
              }
            }
          } catch { /* seed недоступний -> deleteGroup піде без підпису */ }
          await api.deleteGroup(item.id, seed);
        } else {
          // Leave: remove myself from members.
          await api.removeGroupMember(item.id, myPubkey);
        }
      } catch (e) {
        // 404/403 = групи на релеї вже немає (адмін видалив раніше).
        // Це не помилка для користувача — просто чистимо локально.
        if (!groupsLib.isGroupGoneError(e)) {
          alert(`Помилка: ${e.message}`);
        }
      }
      gstore.removeGroup(item.id);
    }
    setItems(buildMixedList(contactsOnly));
  }

  function openItem(item) {
    if (item.kind === 'dm') onNavigate(`chat/${item.id}`);
    else onNavigate(`group/${item.id}`);
  }

  const chatItems = items.filter((it) => it.category === 'chat');
  const requestItems = items.filter((it) => it.category === 'request');
  const requestCount = requestItems.length;
  const requestUnread = requestItems.reduce((sum, it) => sum + (it.unread || 0), 0);

  // If "Запити" tab no longer has items (user accepted/blocked them all),
  // snap back to the main tab automatically.
  useEffect(() => {
    if (activeTab === 'requests' && requestCount === 0) {
      setActiveTab('chats');
    }
  }, [activeTab, requestCount]);

  const visibleItems = activeTab === 'requests' ? requestItems : chatItems;
  const isEmpty = visibleItems.length === 0;
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
            fontSize: 27, fontWeight: 800, letterSpacing: '-0.03em',
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
              fontSize: 13, color: '#A4A6B2',
              marginTop: 6,
              letterSpacing: '-0.01em',
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
            <div style={{ fontSize: 12.5, color: '#A4A6B2', marginTop: 2 }}>
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
            <div style={{ fontSize: 12.5, color: '#A4A6B2', marginTop: 2 }}>
              Хто має доступ до браузера — може прочитати ваші повідомлення
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3F3F45" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      )}

      {/* Tabs — shown only when there are requests, otherwise the row is hidden */}
      {requestCount > 0 && (
        <div style={{
          display: 'flex', gap: 4,
          padding: '4px 16px 12px',
        }}>
          <TabButton
            active={activeTab === 'chats'}
            onClick={() => setActiveTab('chats')}
            label="Чати"
          />
          <TabButton
            active={activeTab === 'requests'}
            onClick={() => setActiveTab('requests')}
            label="Запити"
            badge={requestUnread > 0 ? requestUnread : null}
            count={requestCount}
          />
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
            color: '#8B8D99',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#F5F5F7', letterSpacing: '-0.01em' }}>
            {activeTab === 'requests' ? 'Нема нових запитів' : 'Поки немає чатів'}
          </div>
          <div style={{ fontSize: 13, color: '#A4A6B2', maxWidth: 280, lineHeight: 1.5 }}>
            {activeTab === 'requests'
              ? 'Сюди потрапляють повідомлення від людей, яких немає у ваших контактах'
              : 'Натисніть кнопку нижче щоб почати новий чат або групу'}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', marginTop: 10 }}>
          {visibleItems.map((item) => {
            const last = item.last;
            const isGroup = item.kind === 'group';
            const muteKey = isGroup
              ? muted.groupKey(item.id)
              : (item.username ? muted.dmKey(item.username) : null);
            const isMuted = !!(muteKey && mutedKeys.has(muteKey));
            return (
              <div
                key={`${item.kind}-${item.id}`}
                className={`lin-chat-row${item.id === activeChatId ? ' dt-active' : ''}`}
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
                        <span style={{ fontSize: 12, color: '#9EA0AC', flexShrink: 0 }} title="Заглушено">🔕</span>
                      )}
                    </div>
                    <div style={{
                      fontSize: 12, color: '#9EA0AC',
                      fontFamily: 'var(--mono, monospace)', flexShrink: 0,
                    }}>{formatTime(last?.ts)}</div>
                  </div>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', gap: 6, marginTop: 3,
                  }}>
                    <div style={{
                      fontSize: 12.5, color: '#ABADB8',
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
                      <div style={{ fontSize: 12.5, color: '#9EA0AC', fontFamily: 'var(--mono, monospace)' }}>
                        ⏱ {formatTTL(last.ttl)}
                      </div>
                    )}
                    {item.unread > 0 && (
                      <div style={{
                        minWidth: 18, height: 18, borderRadius: 9,
                        background: isMuted ? '#3F3F45' : '#6B8AFE',
                        color: isMuted ? '#A8A8B0' : '#fff',
                        fontSize: 12.5, fontWeight: 700,
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
              padding: '12px 0 calc(28px + var(--inset-bottom, 0px))',
            }}
          >
            <div style={{ width: 36, height: 4, background: '#3F3F45', borderRadius: 2, margin: '6px auto 14px' }} />
            <div style={{
              fontSize: 13, color: '#ABADB8',
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
            {actionItem.kind === 'dm' && actionItem.category === 'request' && (
              <>
                <div
                  onClick={() => {
                    contacts.addToContacts({
                      pubkey_hex: actionItem.pubkey,
                      username: actionItem.username,
                      home_relay: actionItem.raw?.peer_home_relay,
                    });
                    setActionItem(null);
                    setItems(buildMixedList(contactsOnly));
                  }}
                  style={{
                    padding: '14px 20px', cursor: 'pointer',
                    color: '#4ADE80', fontSize: 14, fontWeight: 600,
                  }}
                >✓ Прийняти (додати в контакти)</div>
                <div
                  onClick={() => {
                    contacts.blockPeer(actionItem.pubkey);
                    setActionItem(null);
                    setItems(buildMixedList(contactsOnly));
                  }}
                  style={{
                    padding: '14px 20px', cursor: 'pointer',
                    color: '#FF6B7A', fontSize: 14, fontWeight: 500,
                  }}
                >🚫 Заблокувати</div>
                <div style={{ height: 1, background: '#232329', margin: '4px 0' }} />
              </>
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
              padding: '12px 0 calc(28px + var(--inset-bottom, 0px))',
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

function TabButton({ active, onClick, label, badge, count }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '9px 14px',
        background: active ? '#16161B' : 'transparent',
        border: '1px solid ' + (active ? '#232329' : 'transparent'),
        color: active ? '#F5F5F7' : '#6B6B72',
        borderRadius: 9,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        transition: 'background 0.12s, color 0.12s',
        letterSpacing: '-0.005em',
      }}
    >
      <span>{label}</span>
      {count !== undefined && count !== null && (
        <span style={{
          fontSize: 12.5,
          color: active ? '#A8AAB5' : 'var(--text-faint)',
          fontFamily: 'var(--mono, monospace)',
        }}>
          {count}
        </span>
      )}
      {badge !== null && badge !== undefined && badge > 0 && (
        <span style={{
          minWidth: 16, height: 16, borderRadius: 8,
          background: '#6B8AFE', color: '#fff',
          fontSize: 9.5, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 4px',
        }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}
