import { useState } from 'react';
import { identityFromMnemonic } from '../lib/crypto.js';

export default function LoginByMnemonic({ onNavigate, onSeedReady }) {
  const [mnemonic, setMnemonic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;
  const ready = wordCount === 24;

  function loginClicked() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = identityFromMnemonic(mnemonic);
      onSeedReady?.({
        seed: id.seed,
        pubkeyHex: id.pubkeyHex,
        mnemonic: id.mnemonic,
      });
    } catch (e) {
      setError(e.message || 'Не вдалось');
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
        <h1>Увійти за ключем</h1>
        <p className="hint">
          Введіть 24 слова з ключа відновлення через пробіл або з нових рядків.
        </p>

        <textarea
          className="textarea"
          placeholder="abandon ability able about above ..."
          value={mnemonic}
          onChange={(e) => { setMnemonic(e.target.value); setError(null); }}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />

        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
          {wordCount} / 24 слів
        </div>

        {error && <div className="error-text">{error}</div>}
      </div>

      <div className="onb-footer">
        <button
          className="btn btn-primary"
          disabled={!ready || busy}
          onClick={loginClicked}
        >
          {busy ? 'Перевіряємо...' : 'Увійти'}
        </button>
      </div>
    </div>
  );
}
