import { useEffect, useMemo, useState } from 'react';
import * as contacts from '../lib/contacts.js';
import * as convs from '../lib/conversations.js';

/**
 * ContactsList — list of saved contacts with search.
 *
 * Tap a row → open profile (we route to `peer/<pubkey>` so the same
 * screen handles both "saved contact" and "discovered peer" — no need
 * for a contact-only profile view).
 *
 * Long-press on a row opens a small action sheet (remove / nickname).
 *
 * Empty state explains how to add a contact (from the PeerProfile of
 * anyone the user has chatted with, or via a future "+ Add" flow).
 */
const LONG_PRESS_MS = 500;

export default function ContactsList({ onNavigate }) {
  const [items, setItems] = useState(() => contacts.listExplicitContacts());
  const [query, setQuery] = useState('');
  const [actionItem, setActionItem] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  function refresh() {
    setItems(contacts.listExplicitContacts());
  }

  // Filtered view derived from the live list + query
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => {
      if (c.username && c.username.toLowerCase().includes(q)) return true;
      if (c.nickname && c.nickname.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [items, query]);

  function openItem(item) {
    // Make sure the conversation exists so chatting from contacts works
    // without going through PeerProfile first.
    convs.ensureConversation({
      peerPubkey:    item.pubkey_hex,
      peerUsername:  item.username,
      peerHomeRelay: item.home_relay,
    });
    onNavigate(`peer/${item.pubkey_hex}`);
  }

  function removeClicked() {
    if (!actionItem) return;
    contacts.removeFromContacts(actionItem.pubkey_hex);
    setActionItem(null);
    refresh();
  }

  function startRename() {
    if (!actionItem) return;
    setRenameTarget(actionItem);
    setRenameValue(actionItem.nickname || '');
    setActionItem(null);
  }

  function saveRename() {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    contacts.updateContactNickname(renameTarget.pubkey_hex, trimmed || null);
    setRenameTarget(null);
    setRenameValue('');
    refresh();
  }

  // long-press handling
  let pressTimer = null;
  function startPress(item) {
    cancelPress();
    pressTimer = setTimeout(() => {
      setActionItem(item);
      pressTimer = null;
    }, LONG_PRESS_MS);
  }
  function cancelPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  }

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      <div style={{
        padding: '20px 20px 18px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#F5F5F7', lineHeight: 1.1,
          }}>
            Контакти
          </div>
          <div style={{ fontSize: 12.5, color: '#6B6B72', marginTop: 6 }}>
            {items.length === 0
              ? 'Поки нікого'
              : `${items.length} ${pluralize(items.length, 'контакт', 'контакти', 'контактів')}`}
          </div>
        </div>
        <button
          onClick={() => onNavigate('chats')}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: '#16161B', border: '1px solid #232329',
            color: '#A8A8B0', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {items.length > 0 && (
        <div style={{ padding: '0 20px 14px' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Пошук за іменем"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '11px 14px',
              background: '#13131A',
              border: '1px solid #232329',
              borderRadius: 10,
              color: '#F5F5F7',
              fontSize: 13.5,
              outline: 'none', fontFamily: 'inherit',
            }}
            onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
            onBlur={(e) => e.target.style.borderColor = '#232329'}
          />
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 24px' }}>

        {items.length === 0 && (
          <div style={{
            padding: '36px 24px', textAlign: 'center',
          }}>
            <div style={{
              fontSize: 14, color: '#A8A8B0', marginBottom: 10,
              lineHeight: 1.5,
            }}>
              Контактів ще нема
            </div>
            <div style={{
              fontSize: 12.5, color: '#6B6B72', lineHeight: 1.6,
            }}>
              Зайдіть у будь-який профіль (вгорі чату на ім'я)
              і натисніть <b>«+ Додати в контакти»</b>.
            </div>
          </div>
        )}

        {items.length > 0 && filtered.length === 0 && (
          <div style={{
            padding: 24, textAlign: 'center',
            color: '#6B6B72', fontSize: 13,
          }}>
            Нічого не знайдено
          </div>
        )}

        {filtered.map((c) => (
          <ContactRow
            key={c.pubkey_hex}
            contact={c}
            onClick={() => openItem(c)}
            onPressStart={() => startPress(c)}
            onPressEnd={cancelPress}
          />
        ))}
      </div>

      {/* Action sheet on long-press */}
      {actionItem && (
        <Sheet onClose={() => setActionItem(null)}>
          <div style={{
            padding: '6px 22px 14px',
            color: '#A8A8B0', fontSize: 13, textAlign: 'center',
          }}>
            {actionItem.nickname || (actionItem.username ? `@${actionItem.username}` : 'Контакт')}
          </div>
          <button onClick={startRename} style={sheetBtnStyle('#F5F5F7')}>
            Змінити нікнейм
          </button>
          <button onClick={removeClicked} style={sheetBtnStyle('#FF6B7A')}>
            Видалити з контактів
          </button>
        </Sheet>
      )}

      {renameTarget && (
        <Sheet onClose={() => { setRenameTarget(null); setRenameValue(''); }}>
          <div style={{ padding: '6px 22px 12px', textAlign: 'center', color: '#A8A8B0', fontSize: 13 }}>
            Локальний нікнейм
          </div>
          <div style={{ padding: '0 22px 4px' }}>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={renameTarget.username ? `@${renameTarget.username}` : 'Назва'}
              maxLength={40}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '12px 14px',
                background: '#0A0A0B',
                border: '1px solid #232329',
                borderRadius: 10,
                color: '#F5F5F7', fontSize: 14,
                outline: 'none', fontFamily: 'inherit',
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); }}
            />
            <div style={{ fontSize: 10.5, color: '#5A5A65', marginTop: 6, lineHeight: 1.5 }}>
              Видно тільки тобі. Інші бачать оригінальне ім'я.
            </div>
          </div>
          <button onClick={saveRename} style={sheetBtnStyle('#7B96FF')}>
            Зберегти
          </button>
        </Sheet>
      )}
    </div>
  );
}

function ContactRow({ contact, onClick, onPressStart, onPressEnd }) {
  const displayName = contact.nickname
    ? contact.nickname
    : (contact.username ? `@${contact.username}` : `${contact.pubkey_hex.slice(0, 8)}…`);
  const subtitle = contact.nickname && contact.username
    ? `@${contact.username}`
    : (contact.home_relay || contact.pubkey_hex.slice(0, 16) + '…');
  const hue = parseInt(contact.pubkey_hex.slice(0, 6), 16) % 360;
  const initial = (contact.nickname || contact.username || contact.pubkey_hex)[0]?.toUpperCase() || '?';

  return (
    <div
      onClick={onClick}
      onMouseDown={onPressStart}
      onMouseUp={onPressEnd}
      onMouseLeave={onPressEnd}
      onTouchStart={onPressStart}
      onTouchEnd={onPressEnd}
      onTouchCancel={onPressEnd}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '11px 20px',
        cursor: 'pointer',
        userSelect: 'none', WebkitUserSelect: 'none',
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#0F0F14'; }}
      onMouseLeaveCapture={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: '50%',
        background: `hsl(${hue}, 45%, 45%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: 14, color: '#fff',
        flexShrink: 0,
      }}>
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 600, color: '#F5F5F7',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          letterSpacing: '-0.005em',
        }}>
          {displayName}
        </div>
        <div style={{
          fontSize: 12.5, color: '#6B6B72',
          marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {subtitle}
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
          padding: '12px 0 calc(28px + var(--inset-bottom, 0px))',
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

function sheetBtnStyle(color) {
  return {
    width: '100%', padding: '14px 22px',
    background: 'transparent', border: 'none', borderTop: '1px solid #232329',
    color, fontSize: 15, fontWeight: 600,
    textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit',
  };
}

function pluralize(n, one, few, many) {
  const m = n % 100;
  if (m >= 11 && m <= 14) return many;
  const r = n % 10;
  if (r === 1) return one;
  if (r >= 2 && r <= 4) return few;
  return many;
}
