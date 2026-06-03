import { useState } from 'react';
import { identityFromMnemonic } from '../lib/crypto.js';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';

/**
 * DeleteAccount — permanent account removal screen.
 *
 * Flow:
 *   1. User types their 24-word mnemonic into a textarea
 *   2. We derive seed+pubkey locally (no network), compare with current
 *      session pubkey. Mismatch → error, nothing leaves the device.
 *   3. After match, a "I understand" checkbox unlocks the red Delete button.
 *   4. Click → DELETE /api/v1/me on the relay → wipe localStorage → back to welcome.
 *
 * Why mnemonic verification (not just session token):
 *   The session token alone proves "this tab is logged in" — anyone with
 *   an unlocked device could destroy the account. Requiring the 24-word
 *   mnemonic means the user genuinely is the owner (or has the backup,
 *   which is fine — if you have the backup, you control the identity).
 *
 * The mnemonic NEVER leaves the device. The relay only gets a normal
 * authenticated DELETE — it can't tell that an extra check happened.
 */
export default function DeleteAccount({ onNavigate, currentPubkeyHex }) {
  const [text, setText] = useState('');
  const [verified, setVerified] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  function verifyClicked() {
    if (wordCount !== 24) {
      setError(`Потрібно рівно 24 слова, зараз ${wordCount}`);
      return;
    }
    setError(null);
    try {
      const id = identityFromMnemonic(text);
      if (id.pubkeyHex !== currentPubkeyHex) {
        setError('Ці 24 слова не належать вашому акаунту');
        return;
      }
      setVerified(true);
    } catch (e) {
      setError(e.message || 'Не вдалось розпізнати фразу');
    }
  }

  async function confirmDeleteClicked() {
    if (!verified || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
    } catch (e) {
      setBusy(false);
      setError(`Сервер: ${e.message || 'не вдалось видалити'}`);
      return;
    }
    // Wipe ALL local state regardless of where we go next.
    try { vault.lockNow(); } catch { /* ignore */ }
    try { vault.clearLockout(); } catch { /* ignore */ }
    store.wipeAll();
    // Hop to welcome — the next render will see no identity.
    onNavigate('welcome');
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
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#F5F5F7', lineHeight: 1.1,
          }}>
            Видалити акаунт
          </div>
          <div style={{
            fontSize: 12.5, color: '#FF6B7A', marginTop: 6,
            fontWeight: 600,
          }}>
            Дія НЕЗВОРОТНА
          </div>
        </div>
        <button
          onClick={() => onNavigate('settings')}
          disabled={busy}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: '#16161B', border: '1px solid #232329',
            color: '#A8A8B0',
            cursor: busy ? 'not-allowed' : 'pointer',
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

        {/* Warning card */}
        <div style={{
          background: 'rgba(255, 107, 122, 0.06)',
          border: '1px solid rgba(255, 107, 122, 0.22)',
          borderRadius: 14,
          padding: 16,
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#FF6B7A', marginBottom: 10 }}>
            ⚠ Що буде видалено
          </div>
          <ul style={{
            fontSize: 12.5, color: '#C5C5CC', lineHeight: 1.7,
            paddingLeft: 18, margin: 0,
          }}>
            <li>Ваш username (звільниться через 30 днів)</li>
            <li>Push підписки на всіх пристроях</li>
            <li>Зашифровані бекапи на сервері</li>
            <li>Dead-man's switch (якщо налаштований)</li>
            <li>Локальна історія чатів і груп</li>
          </ul>
          <div style={{ fontSize: 11.5, color: '#8E8E99', marginTop: 12, lineHeight: 1.55 }}>
            Чати в групах залишаться — інші бачитимуть вас як "@невідомий".
            Якщо у вас є 24 слова — ви зможете зайти знову, але історія
            не повернеться.
          </div>
        </div>

        {!verified && (
          <>
            <div style={{
              fontSize: 11, color: '#5A5A65',
              marginBottom: 8,
              fontFamily: 'var(--mono, monospace)',
              letterSpacing: '0.05em',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>ПІДТВЕРДЖЕННЯ — ВВЕДІТЬ 24 СЛОВА</span>
              <span style={{
                color: wordCount === 24 ? '#4ADE80' : (wordCount > 24 ? '#FF6B7A' : '#5A5A65'),
              }}>
                {wordCount} / 24
              </span>
            </div>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setError(null); }}
              placeholder="word1 word2 word3 ..."
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              disabled={busy}
              style={{
                width: '100%', boxSizing: 'border-box',
                minHeight: 140,
                padding: '14px 16px',
                background: '#13131A',
                border: '1px solid #232329',
                borderRadius: 12,
                color: '#F5F5F7',
                fontSize: 14,
                fontFamily: 'var(--mono, monospace)',
                lineHeight: 1.6,
                outline: 'none', resize: 'none',
                letterSpacing: '0.01em',
              }}
              onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
              onBlur={(e) => e.target.style.borderColor = '#232329'}
            />

            {error && (
              <div style={{
                background: 'rgba(255, 107, 122, 0.08)',
                border: '1px solid rgba(255, 107, 122, 0.25)',
                color: '#FF6B7A',
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 13, marginTop: 14,
              }}>
                {error}
              </div>
            )}

            <button
              onClick={verifyClicked}
              disabled={busy || wordCount !== 24}
              style={{
                width: '100%',
                marginTop: 24,
                padding: '16px 22px',
                borderRadius: 14,
                background: (busy || wordCount !== 24) ? '#2A2A33' : '#F5F5F7',
                color: (busy || wordCount !== 24) ? '#5A5A65' : '#0A0A0B',
                border: 'none',
                fontSize: 15, fontWeight: 600,
                cursor: (busy || wordCount !== 24) ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Перевірити фразу
            </button>
          </>
        )}

        {verified && (
          <>
            <div style={{
              background: 'rgba(74, 222, 128, 0.06)',
              border: '1px solid rgba(74, 222, 128, 0.25)',
              borderRadius: 12,
              padding: '12px 14px',
              fontSize: 13, color: '#4ADE80',
              marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Фраза підтверджена. Це ваш акаунт.
            </div>

            <div
              onClick={() => !busy && setConfirmed(!confirmed)}
              style={{
                background: '#13131A',
                border: `1px solid ${confirmed ? '#FF6B7A' : '#232329'}`,
                borderRadius: 12,
                padding: '14px 16px',
                display: 'flex', alignItems: 'center', gap: 12,
                cursor: busy ? 'not-allowed' : 'pointer',
                marginBottom: 16,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: 6,
                border: `1.5px solid ${confirmed ? '#FF6B7A' : '#3F3F45'}`,
                background: confirmed ? '#FF6B7A' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {confirmed && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <div style={{ flex: 1, fontSize: 13, color: '#F5F5F7' }}>
                Я розумію, що ця дія незворотна
              </div>
            </div>

            {error && (
              <div style={{
                background: 'rgba(255, 107, 122, 0.08)',
                border: '1px solid rgba(255, 107, 122, 0.25)',
                color: '#FF6B7A',
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 13, marginBottom: 14,
              }}>
                {error}
              </div>
            )}

            <button
              onClick={confirmDeleteClicked}
              disabled={busy || !confirmed}
              style={{
                width: '100%',
                padding: '16px 22px',
                borderRadius: 14,
                background: (busy || !confirmed) ? '#2A2A33' : '#FF4A5C',
                color: (busy || !confirmed) ? '#5A5A65' : '#FFFFFF',
                border: 'none',
                fontSize: 15, fontWeight: 700,
                cursor: (busy || !confirmed) ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                transition: 'background 0.12s',
              }}
            >
              {busy ? 'Видаляю...' : '🔥 Видалити акаунт назавжди'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
