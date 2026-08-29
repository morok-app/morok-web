import { useEffect, useState } from 'react';
import * as contacts from '../lib/contacts.js';
import { t } from '../lib/i18n.js';

/**
 * Blocked — screen listing peers the user has blocked.
 *
 * Blocked peers will be filtered out from incoming messages (planned for
 * the next session — that filter goes into messages.js processIncoming).
 * For now this screen is the management UI; unblocking removes them
 * from the list and they'll be visible again on incoming.
 */
export default function Blocked({ onNavigate }) {
  const [items, setItems] = useState(() => contacts.listBlocked());

  function refresh() {
    setItems(contacts.listBlocked());
  }

  function unblock(pubkeyHex) {
    contacts.unblockPeer(pubkeyHex);
    refresh();
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
            {t('Blocked')}
          </div>
          <div style={{ fontSize: 12.5, color: '#A4A6B2', marginTop: 6 }}>
            {t('Don\'t accept messages from them')}
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

        {items.length === 0 && (
          <div style={{
            padding: 24, textAlign: 'center',
            color: '#A4A6B2', fontSize: 13,
          }}>
            {t('Nobody blocked')}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it) => (
            <div key={it.pubkey_hex} style={{
              background: '#13131A',
              border: '1px solid #232329',
              borderRadius: 12,
              padding: '12px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ fontSize: 16, opacity: 0.6 }}>🚫</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5, color: '#D5D5DA',
                  fontFamily: 'var(--mono, monospace)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  letterSpacing: '0.01em',
                }}>
                  {it.pubkey_hex.slice(0, 24)}…
                </div>
                <div style={{
                  fontSize: 12.5, color: '#A4A6B2', marginTop: 3,
                  fontFamily: 'var(--mono, monospace)',
                }}>
                  {it.added_at
                    ? new Date(it.added_at * 1000).toLocaleDateString('uk-UA')
                    : ''}
                </div>
              </div>
              <button
                onClick={() => unblock(it.pubkey_hex)}
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
                {t('Unlock')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
