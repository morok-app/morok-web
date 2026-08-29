import { useState } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { decryptWithSecret } from '../lib/vault.js';
import { bytesToHex } from '../lib/crypto.js';
import { t } from '../lib/i18n.js';
import LangSwitch from '../components/LangSwitch.jsx';

/**
 * RestoreByUsername — Linear-style.
 *
 * 2-step form:
 *   1) Username input → fetches encrypted blob from server
 *   2) Passphrase input → decrypts locally, then full login
 *
 * After successful decrypt we save identity AND immediately log in
 * via api.login() — so the session token is set before we navigate to chats.
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
        setError(t('Username not found or it has no backup'));
      } else {
        setError(e.message || t('Error'));
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

      // Save identity locally
      store.saveIdentityUnlocked({
        seedHex: bytesToHex(seed),
        pubkeyHex,
        mnemonic: null,
      });

      // Authenticate so we have a session token before going to chats
      const session = await api.login({ seed, pubkeyHex });
      store.saveSession({
        token: session.session_token,
        pubkeyHex: session.pubkey_hex,
        expiresAt: session.expires_at,
        relayUrl: api.getRelayUrl(),
      });

      const me = await api.getMe();
      store.saveProfile({
        username: me.username,
        tier: me.tier,
        homeRelay: me.home_relay,
        pubkeyHex,
      });

      vault.markUnlocked(seed);

      // Reload so App.jsx's boot picks up the fresh state cleanly
      window.location.href = '/web/#chats';
      window.location.reload();
    } catch (e) {
      console.error(e);
      setError(t('Wrong passphrase or the server refused'));
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>
      <LangSwitch />

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
            {t('Restore from backup')}
          </div>
          <div style={{
            fontSize: 12.5, color: '#A4A6B2',
            marginTop: 6,
            fontFamily: 'var(--mono, monospace)',
            letterSpacing: '0.05em',
          }}>
            STEP {step === 'username' ? '1' : '2'} OF 2
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
            <div style={{ fontSize: 13, color: '#ABADB8', lineHeight: 1.55, marginBottom: 20 }}>
              {t('Enter your username. The server returns an encrypted backup — only you can decrypt it, locally.')}
            </div>

            <div style={{
              fontSize: 12, color: '#9EA0AC',
              marginBottom: 8,
              fontFamily: 'var(--mono, monospace)',
              letterSpacing: '0.05em',
            }}>
              {t('USERNAME')}
            </div>
            <div style={{
              display: 'flex', alignItems: 'center',
              background: '#13131A',
              border: '1px solid #232329',
              borderRadius: 12,
              paddingLeft: 14,
            }}>
              <span style={{ color: '#9EA0AC', fontSize: 14, marginRight: 4 }}>@</span>
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
              {busy ? t('Searching...') : t('Find backup')}
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
                {t('Backup found for')} <strong style={{ fontFamily: 'var(--mono, monospace)' }}>@{username}</strong>
              </div>
            </div>

            <div style={{ fontSize: 13, color: '#ABADB8', lineHeight: 1.55, marginBottom: 20 }}>
              {t('Enter the passphrase you created when setting up the backup. Decryption happens on your device.')}
            </div>

            <div style={{
              fontSize: 12, color: '#9EA0AC',
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
              {busy ? t('Decrypting...') : t('Decrypt and sign in')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
