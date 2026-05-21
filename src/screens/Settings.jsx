import { useState, useEffect } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { encryptWithSecret, decryptWithSecret } from '../lib/vault.js';
import { utf8, utf8Decode, bytesToBase64, base64ToBytes } from '../lib/crypto.js';

export default function Settings({ onNavigate }) {
  const profile = store.loadProfile();
  const identity = store.loadIdentity();
  const hasPin = identity?.encrypted === true;
  const [serverBackup, setServerBackup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  // Check server backup status
  useEffect(() => {
    (async () => {
      try {
        const info = await api.getMyBackup();
        setServerBackup({ exists: true, info });
        store.saveBackupHas({ has: true, updatedAt: info.updated_at });
      } catch (e) {
        if (e.status === 404) {
          setServerBackup({ exists: false });
          store.saveBackupHas({ has: false, updatedAt: 0 });
        } else {
          // backup is premium-only — 403 means free tier
          setServerBackup({ exists: false, error: e.message });
        }
      }
    })();
  }, []);

  async function setupPinClicked() {
    onNavigate('pin-setup-existing');
  }

  async function removePinClicked() {
    if (!confirm('Видалити PIN? Доведеться знову захищати акаунт після перезавантаження.')) return;

    // Need to unlock first to get seed
    const seed = vault.getUnlockedSeed();
    if (!seed) {
      alert('Сеанс закінчився. Перезавантажте сторінку щоб ввести PIN знову.');
      return;
    }

    setBusy(true);
    try {
      // Decrypt mnemonic from blob using a currently-unlocked PIN session
      // — but we only kept seed in memory, not the PIN. So we cannot
      // re-encrypt the mnemonic without a PIN. Instead we ask:
      const pin = prompt('Введіть PIN ще раз щоб видалити захист:');
      if (!pin || pin.length !== 6) { setBusy(false); return; }

      let mnemonicBytes;
      try {
        mnemonicBytes = decryptWithSecret(identity.mnemonic_b64, pin);
      } catch {
        alert('Неправильний PIN');
        setBusy(false);
        return;
      }
      const mnemonic = utf8Decode(mnemonicBytes);
      store.saveIdentityUnlocked({
        seedHex: Array.from(seed).map((b) => b.toString(16).padStart(2, '0')).join(''),
        pubkeyHex: identity.pubkey_hex,
        mnemonic,
      });
      vault.clearLockout();
      vault.lockNow();
      setMessage('PIN видалено. Перезавантажте сторінку.');
    } catch (e) {
      console.error(e);
      setMessage('Помилка: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createServerBackupClicked() {
    if (profile?.tier === 'free') {
      alert('Server backup доступний для premium-акаунтів.');
      return;
    }
    const passphrase = prompt(
      'Створіть passphrase для server backup (мінімум 12 символів).\n' +
      'Цю passphrase потрібно буде ввести при відновленні з іншого пристрою.'
    );
    if (!passphrase) return;
    if (passphrase.length < 12) {
      alert('Passphrase повинна бути мінімум 12 символів.');
      return;
    }
    const confirm2 = prompt('Введіть passphrase ще раз для підтвердження:');
    if (confirm2 !== passphrase) {
      alert('Не співпадає.');
      return;
    }

    // Need unlocked seed
    let seed = vault.getUnlockedSeed();
    if (!seed) {
      // try to read from unlocked identity
      if (identity?.encrypted === false && identity?.seed_hex) {
        seed = new Uint8Array(identity.seed_hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
      } else {
        alert('Сеанс закінчився. Перезавантажте сторінку.');
        return;
      }
    }

    setBusy(true);
    try {
      const encryptedBlob = encryptWithSecret(seed, passphrase);
      // Server schema wants salt+params separately; we encode our salt
      // inside the blob already (first 16 bytes). Re-encode it for the
      // server's `kdf_salt_b64` field by extracting.
      const blobBytes = base64ToBytes(encryptedBlob);
      const saltB64 = bytesToBase64(blobBytes.slice(0, 16));

      await api.uploadBackup({
        encryptedSeedB64: encryptedBlob,
        kdfSaltB64: saltB64,
        kdfParams: { alg: 'pbkdf2', hash: 'sha256', iter: 200000 },
      });
      setMessage('Backup створено успішно.');
      setServerBackup({ exists: true });
      store.saveBackupHas({ has: true, updatedAt: Math.floor(Date.now() / 1000) });
    } catch (e) {
      console.error(e);
      setMessage('Помилка: ' + (e.message || 'не вдалось створити backup'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteServerBackupClicked() {
    if (!confirm('Видалити backup з сервера? Відновлення можливо буде тільки через 24 слова.')) return;
    setBusy(true);
    try {
      await api.deleteMyBackup();
      setMessage('Backup видалено.');
      setServerBackup({ exists: false });
      store.saveBackupHas({ has: false, updatedAt: 0 });
    } catch (e) {
      setMessage('Помилка: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div className="back" onClick={() => onNavigate('chats')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        <div className="title">Налаштування</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 32px' }}>
        {message && (
          <div style={{
            background: 'rgba(74, 222, 128, 0.08)',
            border: '1px solid rgba(74, 222, 128, 0.25)',
            color: 'var(--success)',
            padding: '10px 12px',
            borderRadius: 10,
            fontSize: 13,
            marginBottom: 16,
          }}>{message}</div>
        )}

        {/* PIN section */}
        <div style={{
          fontSize: 11, color: 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          marginBottom: 10,
        }}>
          Захист на цьому пристрої
        </div>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 14, marginBottom: 24,
        }}>
          {hasPin ? (
            <>
              <div style={{ fontSize: 13.5, marginBottom: 6 }}>
                ✓ PIN встановлено
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 12 }}>
                Питається раз на годину при відкритті додатку.
              </div>
              <button
                className="btn btn-danger"
                onClick={removePinClicked}
                disabled={busy}
              >Видалити PIN</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13.5, marginBottom: 6, color: 'var(--danger)' }}>
                ⚠ PIN не встановлено
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 12 }}>
                Хто має доступ до браузера — може прочитати ваші повідомлення.
              </div>
              <button
                className="btn btn-primary"
                onClick={setupPinClicked}
                disabled={busy}
              >Поставити PIN</button>
            </>
          )}
        </div>

        {/* Server backup */}
        <div style={{
          fontSize: 11, color: 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          marginBottom: 10,
        }}>
          Backup на сервері (опційно)
        </div>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 14, marginBottom: 24,
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 12 }}>
            {profile?.tier === 'free'
              ? 'Доступно для premium. Дозволяє відновитись через @username + passphrase, без 24 слів.'
              : 'Дозволяє відновитись через @username + passphrase, без 24 слів. Relay бачить тільки шифротекст.'}
          </div>
          {serverBackup === null ? (
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Перевіряємо статус...</div>
          ) : serverBackup.exists ? (
            <>
              <div style={{ fontSize: 13, color: 'var(--success)', marginBottom: 12 }}>
                ✓ Backup активний
              </div>
              <button
                className="btn btn-danger"
                onClick={deleteServerBackupClicked}
                disabled={busy}
              >Видалити backup</button>
            </>
          ) : (
            <button
              className="btn btn-primary"
              onClick={createServerBackupClicked}
              disabled={busy || profile?.tier === 'free'}
            >Створити backup</button>
          )}
        </div>

        {/* Profile shortcut */}
        <div style={{
          fontSize: 11, color: 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          marginBottom: 10,
        }}>
          Акаунт
        </div>
        <button
          className="btn btn-secondary"
          style={{ marginBottom: 12 }}
          onClick={() => onNavigate('profile')}
        >Профіль і ключ відновлення</button>
      </div>
    </div>
  );
}
