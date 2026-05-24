import { useState } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import { decryptWithSecret } from '../lib/vault.js';
import { bytesToHex, hexToBytes } from '../lib/crypto.js';

/**
 * RestoreByUsername — Linear-style.
 *
 * 2-step form:
 *   1) Username input → fetches encrypted blob from server
 *   2) Passphrase input → decrypts locally
 */
export default function RestoreByUsername({ onNavigate }) {
  const [step, setStep] = useState('username'); // username | passphrase
  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [encryptedBlob, setEncryptedBlob] = useState(null);
  const [pubkeyHex, setPubkeyHex] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function lookupClicked() {
    if (!username.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const result = await api.restoreBackupByUsername(username.trim());
      setEncryptedBlob(result.encrypted_seed_b64);
      setPubkeyHex(result.pubkey_hex);
      setStep('passphrase');
    } catch (e) {
      if (e.status === 404) {
        setError('Юзернейм не знайдено або в нього немає бекапу');
      } else {
        setError(e.message || 'Помилка');
      }
    } finally {
      setBusy(false);
    }
  }

  async function decryptClicked() {
    if (!passphrase) return;
    setError(null);
    setBusy(true);
    try {
      const seed = decryptWithSecret(encryptedBlob, passphrase);
      store.saveIdentityUnlocked({
        seedHex: bytesToHex(seed),
        pubkeyHex,
        mnemonic: null, // user restored from backup, doesn't have mnemonic
      });
      onNavigate('chats');
    } catch (e) {
      setError('Неправильна passphrase');
      setBusy(false);
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
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#F5F5F7', lineHeight: 1.1,
          }}>
            Відновити з бекапу
          </div>
          <div style={{
            fontSize: 12.5, color: '#6B6B72',
            marginTop: 6,
            fontFamily: 'var(--mono, monospace)',
            letterSpacing: '0.05em',
          }}>
            КРОК {step === 'username' ? '1' : '2'} З 2
          </div>
        </div>
        <button
          onClick={() => step === 'passphrase' ? setStep('username') : onNavigate('welcome')}
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

        {step === 'username' ? (
          <>
            <div style={{ fontSize: 13, color: '#8E8E99', lineHeight: 1.55, marginBottom: 20 }}>
              Введіть свій юзернейм. Сервер віддасть зашифрований бекап — розшифрувати його зможете тільки ви, локально.
            </div>

            <div style={{
              fontSize: 11, color: '#5A5A65',
              marginBottom: 8,
              fontFamily: 'var(--mono, monospace)',
              letterSpacing: '0.05em',
            }}>
              ЮЗЕРНЕЙМ
            </div>
            <div style={{
              display: 'flex', alignItems: 'center',
              background: '#13131A',
              border: '1px solid #232329',
              borderRadius: 12,
              paddingLeft: 14,
            }}>
              <span style={{ color: '#5A5A65', fontSize: 14, marginRight: 4 }}>@</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/^@/, '').toLowerCase())}
                placeholder="kaban"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  flex: 1, boxSizing: 'border-box',
                  padding: '13px 14px 13px 0',
                  background: 'transparent',
                  border: 'none',
                  color: '#F5F5F7',
                  fontSize: 14, fontFamily: 'var(--mono, monospace)',
                  outline: 'none',
                }}
              />
            </div>

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
              onClick={lookupClicked}
              disabled={busy || !username.trim()}
              style={{
                width: '100%', marginTop: 20,
                padding: '16px 22px',
                borderRadius: 14,
                background: (busy || !username.trim()) ? '#2A2A33' : '#F5F5F7',
                color: (busy || !username.trim()) ? '#5A5A65' : '#0A0A0B',
                border: 'none',
                fontSize: 15, fontWeight: 600,
                cursor: (busy || !username.trim()) ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {busy ? 'Шукаємо...' : 'Знайти бекап'}
            </button>
          </>
        ) : (
          <>
            <div style={{
              background: '#13131A',
              border: '1px solid #232329',
              borderRadius: 12,
              padding: '12px 14px',
              marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'rgba(74, 222, 128, 0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#4ADE80',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div style={{ fontSize: 13, color: '#F5F5F7' }}>
                Бекап знайдено для <strong style={{ fontFamily: 'var(--mono, monospace)' }}>@{username}</strong>
              </div>
            </div>

            <div style={{ fontSize: 13, color: '#8E8E99', lineHeight: 1.55, marginBottom: 20 }}>
              Введіть passphrase яку ви створили при налаштуванні бекапу. Розшифрування відбувається на вашому пристрої.
            </div>

            <div style={{
              fontSize: 11, color: '#5A5A65',
              marginBottom: 8,
              fontFamily: 'var(--mono, monospace)',
              letterSpacing: '0.05em',
            }}>
              PASSPHRASE
            </div>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="••••••••••••"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '13px 14px',
                background: '#13131A',
                border: '1px solid #232329',
                borderRadius: 12,
                color: '#F5F5F7',
                fontSize: 14, fontFamily: 'var(--mono, monospace)',
                outline: 'none',
              }}
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
              onClick={decryptClicked}
              disabled={busy || !passphrase}
              style={{
                width: '100%', marginTop: 20,
                padding: '16px 22px',
                borderRadius: 14,
                background: (busy || !passphrase) ? '#2A2A33' : '#F5F5F7',
                color: (busy || !passphrase) ? '#5A5A65' : '#0A0A0B',
                border: 'none',
                fontSize: 15, fontWeight: 600,
                cursor: (busy || !passphrase) ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {busy ? 'Розшифровуємо...' : 'Розшифрувати і увійти'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
