import { useState } from 'react';
import * as vault from '../lib/vault.js';
import * as store from '../lib/storage.js';
import { mnemonicFromSeed } from '../lib/crypto.js';
import { hapticSuccess, hapticWarning } from '../lib/haptics.js';

/*
 * Екран "Ключ відновлення" — присвячений саме 24 словам.
 *
 * Раніше пункт у налаштуваннях вів у загальний Профіль, де слова губились
 * серед аватара/QR/публічного ключа (а для залогіненого акаунта взагалі
 * не показувались). Тепер — окремий екран: попередження → "Показати" →
 * сітка слів → копіювати.
 *
 * Seed дістаємо з активної сесії (getUnlockedSeed). seed == BIP39 entropy,
 * тож мнемоніка відновлюється детерміновано — ті самі слова, що при
 * створенні акаунта. Слова за замовчуванням приховані (blur), показуються
 * лише за явним тапом.
 */
export default function RecoveryKey({ onNavigate }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const identity = store.loadIdentity?.() || {};
  const mnemonic = (() => {
    if (identity.mnemonic) return identity.mnemonic;
    const seed = vault.getUnlockedSeed?.();
    if (!seed) return null;
    try { return mnemonicFromSeed(seed); } catch { return null; }
  })();

  const words = mnemonic ? mnemonic.split(' ') : [];

  async function copyAll() {
    if (!mnemonic) return;
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopied(true);
      hapticSuccess();
      setTimeout(() => setCopied(false), 1800);
    } catch {
      hapticWarning();
    }
  }

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
            color: '#F5F5F7', lineHeight: 1.1,
          }}>
            Ключ відновлення
          </div>
          <div style={{ fontSize: 12.5, color: '#A4A6B2', marginTop: 6 }}>
            24 слова для відновлення акаунта
          </div>
        </div>
        <button
          onClick={() => onNavigate('settings')}
          className="back"
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

        {!mnemonic ? (
          // Сесія не активна — seed недоступний.
          <div style={{
            background: '#13131A', border: '1px solid #232329',
            borderRadius: 14, padding: 20, textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, color: '#A8A8B0', lineHeight: 1.6 }}>
              Сесію заблоковано. Розблокуйте застосунок PIN-кодом і
              спробуйте ще раз.
            </div>
          </div>
        ) : (
          <>
            {/* Попередження */}
            <div style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: 14, padding: 16, marginBottom: 16,
              display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div style={{ fontSize: 13, color: '#D4A04A', lineHeight: 1.55 }}>
                Будь-хто з цими словами отримає повний доступ до акаунта.
                Нікому не показуйте і не вводьте на чужих сайтах.
              </div>
            </div>

            {/* Сітка слів (blur поки не показано) */}
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                filter: revealed ? 'none' : 'blur(7px)',
                transition: 'filter 0.2s ease',
                pointerEvents: revealed ? 'auto' : 'none',
                userSelect: revealed ? 'text' : 'none',
              }}>
                {words.map((w, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '9px 11px',
                    background: '#13131A',
                    border: '1px solid #232329',
                    borderRadius: 10,
                  }}>
                    <span style={{
                      fontSize: 12, color: '#9EA0AC', minWidth: 16,
                      fontVariantNumeric: 'tabular-nums',
                    }}>{i + 1}</span>
                    <span style={{ fontSize: 14, color: '#ECECF0', fontWeight: 600 }}>{w}</span>
                  </div>
                ))}
              </div>

              {!revealed && (
                <button
                  onClick={() => setRevealed(true)}
                  style={{
                    position: 'absolute', inset: 0, margin: 'auto',
                    width: 'fit-content', height: 'fit-content',
                    padding: '11px 20px', borderRadius: 12,
                    background: '#6B8AFE', border: 'none',
                    color: '#fff', fontSize: 14, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                  Показати 24 слова
                </button>
              )}
            </div>

            {/* Копіювати — лише коли показано */}
            {revealed && (
              <button
                onClick={copyAll}
                style={{
                  width: '100%', padding: '13px 14px', borderRadius: 12,
                  background: copied ? 'rgba(74, 222, 128, 0.12)' : '#16161B',
                  border: `1px solid ${copied ? 'rgba(74,222,128,0.4)' : '#232329'}`,
                  color: copied ? '#4ADE80' : '#F5F5F7',
                  fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all 0.15s ease',
                }}
              >
                {copied ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Скопійовано
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    Копіювати всі слова
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
