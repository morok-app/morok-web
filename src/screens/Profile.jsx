import { useState, useEffect } from 'react';
import * as store from '../lib/storage.js';
import * as api from '../lib/api.js';
import * as vault from '../lib/vault.js';
import QRCode from 'qrcode';

/**
 * Profile — Linear-style.
 *
 * Sections:
 *   - Hero: avatar + handle
 *   - Share: QR code + copy-link
 *   - Mnemonic: show 24 words (hidden by default, click to reveal)
 *   - Username: release / change (links elsewhere)
 */
export default function Profile({ onNavigate }) {
  const profile = store.loadProfile() || {};
  const identity = store.loadIdentity() || {};
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [qrUrl, setQrUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const pubkeyHex = identity.pubkey_hex || profile.pubkeyHex;
  const username = profile.username;
  const isAnon = !username;
  const handle = username ? `@${username}` : `@anon_${pubkeyHex?.slice(0, 8) || '?'}`;

  const shareUrl = (() => {
    const origin = window.location.origin;
    if (username) {
      return `${origin}/web/#newchat?u=${encodeURIComponent(username)}`;
    }
    return `${origin}/web/#newchat?p=${pubkeyHex}`;
  })();

  useEffect(() => {
    QRCode.toDataURL(shareUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: '#F5F5F7',
        light: '#0A0A0B',
      },
    }).then(setQrUrl);
  }, [shareUrl]);

  function copyLinkClicked() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function releaseUsernameClicked() {
    if (!confirm(`Звільнити @${username}? Інші зможуть його зайняти.`)) return;
    setBusy(true);
    try {
      await api.releaseUsername();
      const p = store.loadProfile() || {};
      store.saveProfile({ ...p, username: null });
      setTimeout(() => window.location.reload(), 200);
    } catch (e) {
      alert(e.message || 'Помилка');
      setBusy(false);
    }
  }

  const mnemonic = (() => {
    if (identity.mnemonic) return identity.mnemonic;
    const seed = vault.getUnlockedSeed?.();
    if (!seed) return null;
    return null; // can't reconstruct without re-deriving; leave hidden
  })();

  // Avatar color from pubkey
  const hue = pubkeyHex ? parseInt(pubkeyHex.slice(0, 6), 16) % 360 : 220;

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      {/* Header */}
      <div style={{
        padding: '20px 20px 24px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#F5F5F7', lineHeight: 1.1,
          }}>
            Профіль
          </div>
          <div style={{ fontSize: 13, color: '#6B6B72', marginTop: 6 }}>
            Як вас бачать інші
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px' }}>

        {/* Avatar + handle hero */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 14,
          padding: '12px 0 calc(28px + var(--inset-bottom, 0px))',
        }}>
          <div style={{
            width: 84, height: 84, borderRadius: '50%',
            background: `hsl(${hue}, 45%, 45%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, fontWeight: 700, color: '#FFF',
            letterSpacing: '-0.02em',
          }}>
            {handle.replace('@', '')[0].toUpperCase()}
          </div>
          <div style={{
            fontSize: 22, fontWeight: 700, color: '#F5F5F7',
            letterSpacing: '-0.02em',
            fontFamily: 'var(--mono, monospace)',
          }}>
            {handle}
          </div>
          {isAnon && (
            <div style={{
              fontSize: 11, color: '#FFA94D',
              background: 'rgba(255, 169, 77, 0.1)',
              border: '1px solid rgba(255, 169, 77, 0.3)',
              padding: '4px 10px',
              borderRadius: 100,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}>
              Анонімний акаунт
            </div>
          )}
        </div>

        {/* QR + Share */}
        <SectionLabel>Поділитись</SectionLabel>
        <div style={{
          background: '#13131A',
          border: '1px solid #232329',
          borderRadius: 14,
          padding: 20,
          marginBottom: 12,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 14,
        }}>
          {qrUrl ? (
            <img src={qrUrl} alt="QR" style={{
              width: 200, height: 200, borderRadius: 8,
            }} />
          ) : (
            <div style={{ width: 200, height: 200, background: '#0A0A0B', borderRadius: 8 }} />
          )}
          <div style={{
            width: '100%',
            fontSize: 11, color: '#8E8E99',
            fontFamily: 'var(--mono, monospace)',
            wordBreak: 'break-all',
            textAlign: 'center', padding: '0 4px',
          }}>
            {shareUrl}
          </div>
          <button
            onClick={copyLinkClicked}
            style={{
              width: '100%',
              padding: '11px 16px',
              borderRadius: 10,
              background: copied ? '#4ADE80' : '#16161B',
              border: '1px solid ' + (copied ? '#4ADE80' : '#232329'),
              color: copied ? '#0A0A0B' : '#F5F5F7',
              fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            {copied ? '✓ Скопійовано' : 'Копіювати лінк'}
          </button>
        </div>

        {/* Mnemonic */}
        {identity.mnemonic && (
          <>
            <SectionLabel>Ключ відновлення</SectionLabel>
            <div style={{
              background: '#13131A',
              border: '1px solid #232329',
              borderRadius: 14,
              padding: 16,
              marginBottom: 12,
            }}>
              {!showMnemonic ? (
                <>
                  <div style={{ fontSize: 12.5, color: '#8E8E99', lineHeight: 1.55, marginBottom: 12 }}>
                    24 секретні слова. Збережіть у безпечному місці.
                    Без них відновити акаунт неможливо.
                  </div>
                  <button
                    onClick={() => setShowMnemonic(true)}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: 10,
                      background: '#16161B',
                      border: '1px solid #232329',
                      color: '#F5F5F7', fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Показати 24 слова
                  </button>
                </>
              ) : (
                <>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                    marginBottom: 12,
                  }}>
                    {identity.mnemonic.split(' ').map((w, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 9px',
                        background: '#0A0A0B',
                        border: '1px solid #1E1E27',
                        borderRadius: 7,
                      }}>
                        <span style={{
                          fontSize: 10, color: '#5A5A65',
                          fontFamily: 'var(--mono, monospace)',
                          minWidth: 18,
                        }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span style={{
                          fontSize: 12.5, color: '#F5F5F7',
                          fontFamily: 'var(--mono, monospace)',
                        }}>
                          {w}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowMnemonic(false)}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: 10,
                      background: '#16161B',
                      border: '1px solid #232329',
                      color: '#F5F5F7', fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Сховати
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* Username actions */}
        <SectionLabel>Юзернейм</SectionLabel>
        <div style={{
          background: '#13131A',
          border: '1px solid #232329',
          borderRadius: 14,
          padding: 16,
        }}>
          {isAnon ? (
            <button
              onClick={() => onNavigate('claim')}
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 10,
                background: '#F5F5F7',
                border: 'none',
                color: '#0A0A0B', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Зайняти юзернейм
            </button>
          ) : (
            <button
              onClick={releaseUsernameClicked}
              disabled={busy}
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 10,
                background: 'transparent',
                border: '1px solid rgba(255, 107, 122, 0.3)',
                color: '#FF6B7A', fontSize: 13, fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}
            >
              {busy ? 'Звільняємо...' : `Звільнити @${username}`}
            </button>
          )}
        </div>

        {/* Pubkey */}
        <SectionLabel>Публічний ключ</SectionLabel>
        <div style={{
          background: '#13131A',
          border: '1px solid #232329',
          borderRadius: 14,
          padding: '14px 16px',
          fontSize: 11, color: '#8E8E99',
          fontFamily: 'var(--mono, monospace)',
          wordBreak: 'break-all',
          lineHeight: 1.6,
        }}>
          {pubkeyHex}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, color: '#3F3F45',
      textTransform: 'uppercase', letterSpacing: '0.1em',
      fontWeight: 600,
      padding: '20px 0 10px',
    }}>
      {children}
    </div>
  );
}
