import { useState } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';

export default function ClaimUsername({ onNavigate }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function onInput(e) {
    // sanitize: lowercase, allow [a-z0-9_], strip leading @
    let v = e.target.value.toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    if (v.length > 20) v = v.slice(0, 20);
    setValue(v);
    setError(null);
  }

  const validLocal = (() => {
    if (value.length < 5) return false; // free-tier min
    if (/^[0-9_]/.test(value)) return false;
    return true;
  })();

  async function claim() {
    if (!validLocal || busy) return;
    setBusy(true);
    setError(null);
    try {
      const me = await api.claimUsername(value);
      store.saveProfile({
        username: me.username,
        tier: me.tier,
        homeRelay: me.home_relay,
      });
      onNavigate('chats');
    } catch (e) {
      console.error(e);
      const code = e.message;
      const friendly = {
        'username_taken': 'Цей юзернейм вже зайнятий',
        'username_in_cooldown': 'Юзернейм нещодавно звільнено, спробуйте інший',
      }[code] || code;
      setError(friendly);
      setBusy(false);
    }
  }

  return (
    <div className="onb">
      <div className="onb-content" style={{ paddingTop: 40 }}>
        <h1>Як вас називати?</h1>
        <p className="hint">
          Це ваш юзернейм у Morok. Без телефонів, без email, без імен.
          Мінімум 5 символів, тільки латиниця, цифри і нижнє підкреслення.
        </p>

        <div className="input-wrap">
          <span className="input-prefix">@</span>
          <input
            className="input with-prefix"
            type="text"
            placeholder="username"
            value={value}
            onChange={onInput}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="text"
          />
        </div>

        {error && <div className="error-text">{error}</div>}

        <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
          Шорші юзернейми (3-4 символи) доступні на premium.
        </p>
      </div>

      <div className="onb-footer">
        <button
          className="btn btn-primary"
          disabled={!validLocal || busy}
          onClick={claim}
        >
          {busy ? 'Резервуємо...' : 'Продовжити'}
        </button>
      </div>
    </div>
  );
}
