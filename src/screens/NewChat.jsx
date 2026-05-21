import { useState } from 'react';
import * as api from '../lib/api.js';
import * as convs from '../lib/conversations.js';
import * as store from '../lib/storage.js';

export default function NewChat({ onNavigate }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function onInput(e) {
    let v = e.target.value.toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    if (v.length > 20) v = v.slice(0, 20);
    setValue(v);
    setError(null);
  }

  async function findClicked() {
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const me = store.loadProfile();

      // Try local lookup first; if user is on another relay, the server returns 404
      // and the client needs to retry with ?relay=. For now MVP: try local, if 404 try with their home relay (we'd need to ask user)
      // For simplicity, just lookup locally. Cross-relay will need a hostname hint later.
      let user;
      try {
        user = await api.lookupUsername(value);
      } catch (e) {
        if (e.status === 404) {
          setError(`Юзер @${value} не знайдений на цьому сервері`);
        } else if (e.status === 503) {
          setError('Сервер тимчасово недоступний, спробуйте пізніше');
        } else {
          setError(e.message || 'Помилка пошуку');
        }
        setBusy(false);
        return;
      }

      if (user.pubkey_hex === me?.pubkey_hex) {
        setError('Це ви самі. Не можна писати собі.');
        setBusy(false);
        return;
      }

      // Open conversation
      convs.ensureConversation({
        peerPubkey: user.pubkey_hex,
        peerUsername: user.username,
        peerHomeRelay: user.home_relay,
      });
      onNavigate(`chat/${user.pubkey_hex}`);
    } catch (e) {
      setError(e.message || 'Помилка');
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
        <div className="title">Новий чат</div>
      </div>

      <div style={{ padding: '24px 24px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
        <p className="hint">
          Введіть юзернейм людини з якою хочете зв'язатись.
        </p>

        <div className="input-wrap">
          <span className="input-prefix">@</span>
          <input
            className="input with-prefix"
            type="text"
            placeholder="username"
            value={value}
            onChange={onInput}
            onKeyDown={(e) => e.key === 'Enter' && findClicked()}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            autoFocus
          />
        </div>

        {error && <div className="error-text">{error}</div>}

        <button
          className="btn btn-primary"
          disabled={!value || busy}
          onClick={findClicked}
        >
          {busy ? 'Шукаємо...' : 'Знайти'}
        </button>
      </div>
    </div>
  );
}
