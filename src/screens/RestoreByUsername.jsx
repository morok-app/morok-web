import { useState } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import { decryptWithSecret } from '../lib/vault.js';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '../lib/crypto.js';
import { parseAddress } from '../lib/addr.js';

export default function RestoreByUsername({ onNavigate }) {
  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function onUsername(e) {
    let v = e.target.value.toLowerCase().replace(/[^a-z0-9_@.-]/g, '');
    setUsername(v);
    setError(null);
  }

  async function restoreClicked() {
    if (busy) return;
    setError(null);

    let parsed;
    try {
      parsed = parseAddress(username);
    } catch (e) {
      setError(e.message);
      return;
    }
    if (passphrase.length < 12) {
      setError('Passphrase повинна бути мінімум 12 символів');
      return;
    }

    setBusy(true);
    try {
      // 1. Fetch backup blob
      // Note: server's by-username endpoint only looks on local relay.
      // Cross-relay restore needs the user to set api relay first. For
      // now, if parsed.relay is set, change the relay URL.
      if (parsed.relay && parsed.relay !== api.getRelayUrl().replace(/^https?:\/\//, '')) {
        api.setRelayUrl(`https://${parsed.relay}`);
      }

      let backup;
      try {
        backup = await api.restoreBackupByUsername(parsed.username);
      } catch (e) {
        if (e.status === 404) {
          setError('Backup для цього юзера не знайдено. Можливо, його не створювали або passphrase треба брати з іншого relay.');
        } else if (e.status === 429) {
          setError('Забагато спроб. Спробуйте за хвилину.');
        } else {
          setError(e.message);
        }
        setBusy(false);
        return;
      }

      // 2. Decrypt
      let seedBytes;
      try {
        seedBytes = decryptWithSecret(backup.encrypted_seed_b64, passphrase);
      } catch {
        setError('Невірна passphrase');
        setBusy(false);
        return;
      }

      // 3. Derive pubkey, sanity check
      const pubkeyBytes = ed25519.getPublicKey(seedBytes);
      const pubkeyHex = bytesToHex(pubkeyBytes);

      // 4. Save identity UNLOCKED (user will set PIN next)
      store.saveIdentityUnlocked({
        seedHex: bytesToHex(seedBytes),
        pubkeyHex,
        mnemonic: '(відновлено через backup — фразу можна побачити в Налаштуваннях)',
      });

      // 5. Auth with relay
      const session = await api.login({
        seed: seedBytes,
        pubkeyHex,
      });
      store.saveSession({
        token: session.session_token,
        pubkeyHex: session.pubkey_hex,
        expiresAt: session.expires_at,
        relayUrl: api.getRelayUrl(),
      });
      const me = await api.getMe();
      store.saveProfile({
        username: me.username, tier: me.tier, homeRelay: me.home_relay,
        pubkeyHex,
      });

      // 6. Done
      onNavigate('chats');
    } catch (e) {
      console.error(e);
      setError(e.message || 'Помилка');
      setBusy(false);
    }
  }

  return (
    <div className="onb">
      <div className="onb-header">
        <div className="back" onClick={() => onNavigate('welcome')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
      </div>

      <div className="onb-content">
        <h1>Відновити через сервер</h1>
        <p className="hint">
          Якщо ви активували server backup в попередніх сесіях — введіть ваш юзернейм і passphrase.
        </p>

        <div className="input-wrap" style={{ marginTop: 8 }}>
          <input
            className="input"
            type="text"
            placeholder="@username[@relay]"
            value={username}
            onChange={onUsername}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            autoFocus
          />
        </div>

        <input
          className="input"
          type="password"
          placeholder="Passphrase (12+ символів)"
          value={passphrase}
          onChange={(e) => { setPassphrase(e.target.value); setError(null); }}
          style={{ marginTop: 8 }}
        />

        {error && <div className="error-text">{error}</div>}
      </div>

      <div className="onb-footer">
        <button
          className="btn btn-primary"
          disabled={!username || !passphrase || busy}
          onClick={restoreClicked}
        >
          {busy ? 'Відновлюємо...' : 'Відновити'}
        </button>
      </div>
    </div>
  );
}
