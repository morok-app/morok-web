import { useEffect, useState } from 'react';
import * as muted from '../lib/muted.js';
import { t, tp } from '../lib/i18n.js';

/**
 * MutedChats — list of currently muted DMs and groups.
 *
 * Reads the IndexedDB store (morok_muted) via lib/muted.js. Each row
 * shows the chat key as it was stored ("dm:<username>" or
 * "group:<uuid>"), the time-left, and an inline unmute button.
 *
 * "Unmute all" wipes the store entirely; we ask for a single
 * confirmation tap before doing it.
 */
export default function MutedChats({ onNavigate }) {
  const [items, setItems] = useState(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  async function load() {
    const list = await muted.listMuted();
    list.sort((a, b) => {
      // forever first, then by until ascending
      if (a.until === 'forever' && b.until !== 'forever') return -1;
      if (b.until === 'forever' && a.until !== 'forever') return 1;
      if (a.until === 'forever') return 0;
      return a.until - b.until;
    });
    setItems(list);
  }

  useEffect(() => { load(); }, []);

  // Auto-disarm "confirm clear all"
  useEffect(() => {
    if (!confirmClearAll) return undefined;
    const t = setTimeout(() => setConfirmClearAll(false), 5000);
    return () => clearTimeout(t);
  }, [confirmClearAll]);

  async function unmuteOne(key) {
    await muted.unmute(key);
    await load();
  }

  async function clearAllClicked() {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      return;
    }
    await muted.clearAllMuted();
    setConfirmClearAll(false);
    await load();
  }

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      <div style={{
        padding: '20px 20px 24px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#F5F5F7', lineHeight: 1.1,
          }}>
            {t('Muted chats')}
          </div>
          <div style={{ fontSize: 12.5, color: '#A4A6B2', marginTop: 6 }}>
            {t('Chats without push notifications')}
          </div>
        </div>
        <button
          onClick={() => onNavigate('settings')}
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px' }}>

        {items === null && (
          <div style={{ color: '#9EA0AC', fontSize: 13, padding: 20, textAlign: 'center' }}>
            {t('Loading…')}
          </div>
        )}

        {items !== null && items.length === 0 && (
          <div style={{
            padding: 24, textAlign: 'center',
            color: '#A4A6B2', fontSize: 13,
          }}>
            {t('No muted chats')}
          </div>
        )}

        {items !== null && items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it) => (
              <MutedRow key={it.key} item={it} onUnmute={() => unmuteOne(it.key)} />
            ))}
          </div>
        )}

        {items !== null && items.length > 0 && (
          <button
            onClick={clearAllClicked}
            style={{
              width: '100%',
              marginTop: 24,
              padding: '14px 18px',
              borderRadius: 12,
              background: confirmClearAll ? '#FF4A5C' : '#13131A',
              border: `1px solid ${confirmClearAll ? '#FF4A5C' : '#232329'}`,
              color: confirmClearAll ? '#FFFFFF' : '#FF6B7A',
              fontSize: 13.5, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'background 0.15s',
            }}
          >
            {confirmClearAll
              ? t('🔔 Tap again to unmute all')
              : t('Unmute all')}
          </button>
        )}
      </div>
    </div>
  );
}

function MutedRow({ item, onUnmute }) {
  // Parse the chat key back into a label.
  let label;
  if (item.key.startsWith('dm:')) {
    label = `@${item.key.slice(3)}`;
  } else if (item.key.startsWith('group:')) {
    const id = item.key.slice(6);
    label = tp("Group · {0}…", [id.slice(0, 8)]);
  } else {
    label = item.key;
  }

  return (
    <div style={{
      background: '#13131A',
      border: '1px solid #232329',
      borderRadius: 12,
      padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ fontSize: 16, opacity: 0.55 }}>🔕</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, fontWeight: 600, color: '#F5F5F7',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {label}
        </div>
        <div style={{
          fontSize: 12, color: '#A4A6B2',
          fontFamily: 'var(--mono, monospace)',
          marginTop: 2,
        }}>
          {muted.formatMuteUntil(item.until)}
        </div>
      </div>
      <button
        onClick={onUnmute}
        style={{
          padding: '7px 12px',
          background: 'transparent',
          border: '1px solid #2A2A33',
          borderRadius: 8,
          color: '#7B96FF', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
          flexShrink: 0,
        }}
      >
        {t('Unmute')}
      </button>
    </div>
  );
}
