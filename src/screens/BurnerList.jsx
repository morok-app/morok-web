import { shareOrigin } from '../lib/share_origin.js';
import { useEffect, useState } from 'react';
import * as burner from '../lib/burner.js';
import { t, tp } from '../lib/i18n.js';

function buildShareUrl(token) {
  return `${shareOrigin()}/web/#burner-send?t=${encodeURIComponent(token)}`;
}

export default function BurnerList({ onNavigate }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [copiedToken, setCopiedToken] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  async function refresh() {
    try {
      const list = await burner.listMyTokens();
      setItems(list);
      setError(null);
    } catch (e) {
      console.error(e);
      setError(e.message || t('Loading failed'));
      setItems([]);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function copyShareLink(token) {
    const url = buildShareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {}
  }

  async function revoke(token) {
    if (!confirm(t('Revoke this link? It will stop working immediately.'))) return;
    try {
      await burner.revokeToken(token);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  const activeCount = items?.length || 0;

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
            {t('Anonymous inbox')}
          </div>
          <div style={{
            fontSize: 13, color: '#A4A6B2',
            marginTop: 8,
            letterSpacing: '-0.01em',
          }}>
            {items === null ? '…' : tp("active: {0}", [activeCount])}
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
            background: 'rgba(255, 169, 77, 0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, fontSize: 14,
          }}>🔥</div>
          <div style={{ fontSize: 12.5, color: '#ABADB8', lineHeight: 1.55, flex: 1 }}>
            {t('Create a link — anyone can send you an anonymous message without signing up. The message is encrypted on the sender\'s device; the server sees only ciphertext. But keys can\'t be verified here the way they are in a regular chat — the sender has no way to check the key is really yours.')}
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
              fontSize: 24, opacity: 0.5,
            }}>🔥</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F5F7' }}>{t('No links yet')}</div>
            <div style={{ fontSize: 12.5, color: '#A4A6B2', maxWidth: 260, lineHeight: 1.5 }}>
              {t('Tap “+” below to create your first one')}
            </div>
          </div>
        ) : (
          items.map((t) => {
            const url = buildShareUrl(t.token);
            return (
              <div
                key={t.token}
                style={{
                  background: '#13131A',
                  border: '1px solid #232329',
                  borderRadius: 14, padding: 16, marginBottom: 10,
                }}
              >
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'flex-start', gap: 10, marginBottom: 12,
                }}>
                  <div style={{
                    fontSize: 15, fontWeight: 700,
                    color: '#F5F5F7',
                    letterSpacing: '-0.01em', flex: 1,
                  }}>
                    {t.label || t('Untitled')}
                  </div>
                  <div style={{
                    fontSize: 12.5, fontWeight: 600,
                    color: '#FFA94D', background: 'rgba(255, 169, 77, 0.1)',
                    padding: '3px 8px', borderRadius: 6,
                    fontFamily: 'var(--mono, monospace)',
                    letterSpacing: '0.02em',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}>
                    {burner.formatRemainingTime(t.expires_at)}
                  </div>
                </div>

                <div style={{
                  fontFamily: 'var(--mono, monospace)', fontSize: 12,
                  color: '#ABADB8',
                  background: '#0A0A0B',
                  border: '1px solid #1E1E27',
                  borderRadius: 8,
                  padding: '10px 12px',
                  marginBottom: 10,
                  wordBreak: 'break-all',
                  lineHeight: 1.5,
                }}>
                  {url}
                </div>

                <div style={{
                  display: 'flex', gap: 12, marginBottom: 12,
                  fontSize: 12, color: '#9EA0AC',
                  fontFamily: 'var(--mono, monospace)',
                }}>
                  <span>{t('messages:')} <span style={{ color: '#F5F5F7' }}>{t.message_count}</span></span>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => copyShareLink(t.token)}
                    style={{
                      flex: 1, height: 40,
                      borderRadius: 10,
                      background: copiedToken === t.token ? '#4ADE80' : '#16161B',
                      border: '1px solid ' + (copiedToken === t.token ? '#4ADE80' : '#232329'),
                      color: copiedToken === t.token ? '#0A0A0B' : '#F5F5F7',
                      fontSize: 12.5, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all 0.15s',
                    }}
                  >
                    {copiedToken === t.token ? t('✓ Copied') : t('Copy link')}
                  </button>
                  <button
                    onClick={() => revoke(t.token)}
                    style={{
                      flex: 1, height: 40,
                      borderRadius: 10,
                      background: 'transparent',
                      border: '1px solid rgba(255, 107, 122, 0.3)',
                      color: '#FF6B7A',
                      fontSize: 12.5, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {t('Revoke')}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showCreate && (
        <CreateBurnerModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}

      <button
        onClick={() => setShowCreate(true)}
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function CreateBurnerModal({ onClose, onCreated }) {
  const [label, setLabel] = useState('');
  const [ttl, setTtl] = useState(24 * 3600);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function createClicked() {
    setBusy(true);
    setError(null);
    try {
      await burner.createToken({ ttlSeconds: ttl, label });
      onCreated();
    } catch (e) {
      console.error(e);
      const friendly = (e.message || '').includes('too_many_active_burner_links')
        ? t('Limit of 10 active links reached. Delete an old one.')
        : (e.message || t('Error'));
      setError(friendly);
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.7)', zIndex: 80,
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
          padding: '12px 20px 28px',
        }}
      >
        <div style={{
          width: 36, height: 4, background: '#3F3F45',
          borderRadius: 2, margin: '6px auto 18px',
        }} />

        <h3 style={{
          fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em',
          color: '#F5F5F7', margin: '0 0 18px',
        }}>
          {t('Create link')}
        </h3>

        <div style={{
          fontSize: 12, color: '#9EA0AC',
          marginBottom: 8,
          fontFamily: 'var(--mono, monospace)',
          letterSpacing: '0.05em',
        }}>{t('NAME (OPTIONAL)')}</div>
        <input
          type="text"
          placeholder={t("For example: \\u201cDonate-page\\u201d or \\u201cWhisper\\u201d")}
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 64))}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '13px 14px',
            background: '#0A0A0B',
            border: '1px solid #232329',
            borderRadius: 12,
            color: '#F5F5F7',
            fontSize: 14, fontFamily: 'inherit',
            outline: 'none', marginBottom: 18,
          }}
          onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
          onBlur={(e) => e.target.style.borderColor = '#232329'}
        />

        <div style={{
          fontSize: 12, color: '#9EA0AC',
          marginBottom: 8,
          fontFamily: 'var(--mono, monospace)',
          letterSpacing: '0.05em',
        }}>{t('HOW LONG IT WORKS')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
          {burner.TTL_OPTIONS.map((opt) => {
            const active = ttl === opt.seconds;
            return (
              <div
                key={opt.seconds}
                onClick={() => setTtl(opt.seconds)}
                style={{
                  background: active ? '#1A1F2E' : '#0A0A0B',
                  border: `1px solid ${active ? '#7B96FF' : '#232329'}`,
                  borderRadius: 10, padding: '11px 14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#F5F5F7' }}>{opt.label}</div>
                  <div style={{ fontSize: 12, color: '#A4A6B2' }}>{opt.hint}</div>
                </div>
                {active && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7B96FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            );
          })}
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

        <button
          onClick={createClicked}
          disabled={busy}
          style={{
            width: '100%',
            padding: '14px 22px',
            borderRadius: 14,
            background: busy ? '#2A2A33' : '#F5F5F7',
            color: busy ? '#5A5A65' : '#0A0A0B',
            border: 'none',
            fontSize: 14.5, fontWeight: 600,
            letterSpacing: '-0.005em',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {busy ? t('Creating...') : t('Create link')}
        </button>
      </div>
    </div>
  );
}
