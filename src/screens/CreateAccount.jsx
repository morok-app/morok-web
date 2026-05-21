import { useMemo, useState } from 'react';
import { generateIdentity, bytesToHex } from '../lib/crypto.js';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';

export default function CreateAccount({ onNavigate }) {
  // Generate once on mount and keep stable until "Continue"
  const identity = useMemo(() => generateIdentity(), []);
  const words = identity.mnemonic.split(' ');

  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function copyToClipboard() {
    navigator.clipboard?.writeText(identity.mnemonic).catch(() => {});
  }

  async function continueClicked() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Persist identity locally
      store.saveIdentity({
        seedHex: bytesToHex(identity.seed),
        pubkeyHex: identity.pubkeyHex,
        mnemonic: identity.mnemonic,
      });

      // Auth with relay
      const session = await api.login({
        seed: identity.seed,
        pubkeyHex: identity.pubkeyHex,
      });
      store.saveSession({
        token: session.session_token,
        pubkeyHex: session.pubkey_hex,
        expiresAt: session.expires_at,
        relayUrl: api.getRelayUrl(),
      });

      // Pull initial profile, then go claim username
      const me = await api.getMe();
      store.saveProfile({
        username: me.username,
        tier: me.tier,
        homeRelay: me.home_relay,
      });

      onNavigate('claim');
    } catch (e) {
      console.error(e);
      setError(e.message || 'Помилка з\'єднання з сервером');
      setBusy(false);
    }
  }

  return (
    <div className="onb">
      <div className="onb-header">
        <div className="back" onClick={() => onNavigate('welcome')}>
          <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg>
        </div>
      </div>

      <div className="onb-content">
        <h1>Ваш ключ відновлення</h1>
        <p className="hint">
          Це 24 слова — єдиний спосіб відновити ваш акаунт на іншому пристрої.
          Збережіть їх у безпечному місці. Ніхто, включно з Morok, не зможе
          відновити доступ якщо ви їх загубите.
        </p>

        <div className="mnemonic-grid">
          {words.map((w, i) => (
            <div className="mnemonic-word" key={i}>
              <span className="num">{i + 1}</span>
              <span className="word">{w}</span>
            </div>
          ))}
        </div>

        <button className="btn btn-ghost" onClick={copyToClipboard} style={{ height: 36, fontSize: 13 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Скопіювати
        </button>

        <div className="warning-card">
          <div className="icon">
            <svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          </div>
          <div className="text">
            <strong>Не показуйте нікому цю фразу.</strong> Будь-хто з нею може
            прочитати всі ваші повідомлення і видавати себе за вас.
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 8 }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
          />
          <span style={{ fontSize: 13.5 }}>Я зберіг(ла) фразу в безпечному місці</span>
        </label>

        {error && <div className="error-text">{error}</div>}
      </div>

      <div className="onb-footer">
        <button
          className="btn btn-primary"
          disabled={!confirmed || busy}
          onClick={continueClicked}
        >
          {busy ? 'Підключаюсь...' : 'Продовжити'}
        </button>
      </div>
    </div>
  );
}
