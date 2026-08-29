import { useEffect, useState } from 'react';
import * as dms from '../lib/dms.js';
import * as contacts from '../lib/contacts.js';
import { formatPeerName } from '../lib/display.js';
import { t, tp } from '../lib/i18n.js';

export default function DMSList({ onNavigate }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  async function refresh() {
    try {
      const list = await dms.listAll();
      setItems(list);
      setError(null);
    } catch (e) {
      console.error(e);
      setError(e.message || t('Loading failed'));
      setItems([]);
    }
  }

  useEffect(() => { refresh(); }, []);

  function renderRecipient(d) {
    const pk = d.recipients?.[0]?.recipient_pubkey_hex;
    if (!pk) return '—';
    const c = contacts.getByPubkey(pk);
    return formatPeerName({ username: c?.username, pubkey: pk });
  }

  const armedCount = items?.filter((x) => x.status === 'armed').length || 0;

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      {/* Header */}
      <div style={{
        padding: '20px 20px 24px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 27, fontWeight: 800, letterSpacing: '-0.03em',
            color: '#F5F5F7', lineHeight: 1,
          }}>
            {t('Digital last message')}
          </div>
          <div style={{
            fontSize: 12.5, color: '#A4A6B2',
            marginTop: 8, fontFamily: 'var(--mono, monospace)',
            letterSpacing: '0.02em',
          }}>
            {items === null ? '...' : tp("active: {0}", [armedCount])}
          </div>
        </div>
        <button
          onClick={() => onNavigate('tools')}
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 80px' }}>

        <div style={{
          background: '#13131A',
          border: '1px solid #232329',
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 14,
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: 'rgba(107, 138, 254, 0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#7B96FF', flexShrink: 0, fontSize: 14,
          }}>📜</div>
          <div style={{ fontSize: 12.5, color: '#ABADB8', lineHeight: 1.55, flex: 1 }}>
            {t('If you don\'t sign in to Morok for N days, the chosen message is delivered to the recipient. End-to-end encrypted: the server sees only ciphertext.')}
          </div>
        </div>

        {error && (
          <div style={{
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            color: '#FF6B7A',
            padding: '10px 14px', borderRadius: 10,
            fontSize: 13, marginBottom: 12,
          }}>{error}</div>
        )}

        {items === null ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '40px 0',
          }}>
            <div style={{
              width: 24, height: 24,
              border: '2px solid #232329',
              borderTopColor: '#7B96FF',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
          </div>
        ) : items.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '40px 24px', textAlign: 'center', gap: 12,
            marginTop: 20,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: '#13131A',
              border: '1px solid #232329',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#8B8D99',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              </svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F5F7' }}>{t('No last messages yet')}</div>
            <div style={{ fontSize: 12.5, color: '#A4A6B2', maxWidth: 260, lineHeight: 1.5 }}>
              {t('Tap “+” below to create your first one')}
            </div>
          </div>
        ) : (
          items.map((d) => {
            const statusColor =
              d.status === 'armed' ? '#4ADE80' :
              d.status === 'triggered' ? '#FF6B7A' :
              '#6B6B72';
            const statusBg =
              d.status === 'armed' ? 'rgba(74, 222, 128, 0.1)' :
              d.status === 'triggered' ? 'rgba(255, 107, 122, 0.1)' :
              'rgba(143, 143, 153, 0.08)';

            return (
              <div
                key={d.dms_id}
                onClick={() => onNavigate(`dms-detail/${d.dms_id}`)}
                className="lin-row-hover"
                style={{
                  background: '#13131A',
                  border: '1px solid #232329',
                  borderRadius: 14, padding: 16, marginBottom: 10,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
              >
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'flex-start', gap: 10, marginBottom: 8,
                }}>
                  <div style={{
                    fontSize: 15, fontWeight: 700,
                    color: '#F5F5F7',
                    letterSpacing: '-0.01em', flex: 1,
                  }}>
                    {d.label || t('Untitled')}
                  </div>
                  <div style={{
                    fontSize: 12.5, fontWeight: 600,
                    color: statusColor, background: statusBg,
                    padding: '3px 8px', borderRadius: 6,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    flexShrink: 0,
                  }}>
                    {dms.statusLabel(d.status)}
                  </div>
                </div>

                <div style={{
                  fontSize: 12.5, color: '#ABADB8',
                  marginBottom: 6,
                }}>
                  {t('Recipient:')} <span style={{ color: '#F5F5F7', fontFamily: 'var(--mono, monospace)' }}>
                    @{renderRecipient(d)}
                  </span>
                </div>

                <div style={{
                  fontSize: 12.5, color: '#A4A6B2',
                  fontFamily: 'var(--mono, monospace)',
                  display: 'flex', gap: 12, flexWrap: 'wrap',
                }}>
                  <span>{dms.formatTriggerLabel(d.trigger_seconds)}</span>
                  {d.status === 'armed' && (
                    <span>· triggers in {dms.formatRemainingTime(d.fires_at)}</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <button
        onClick={() => onNavigate('dms-create')}
        style={{
          position: 'absolute', bottom: 24, right: 20,
          width: 54, height: 54, borderRadius: '50%',
          background: '#F5F5F7', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          cursor: 'pointer', zIndex: 10,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .lin-row-hover:hover { border-color: #2F2F38 !important; }
      `}</style>
    </div>
  );
}
