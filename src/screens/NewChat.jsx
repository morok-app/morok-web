import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import * as convs from '../lib/conversations.js';
import * as contacts from '../lib/contacts.js';
import * as store from '../lib/storage.js';
import { parseAddress } from '../lib/addr.js';
import { formatPeerName } from '../lib/display.js';

export default function NewChat({ onNavigate, routeArg }) {
  const me = store.loadProfile();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [hint, setHint] = useState(null);

  // Preload from share-link:
  //   ?u=username[@relay]   — named user
  //   ?p=<64hex>            — anonymous user (pubkey-only contact)
  useEffect(() => {
    if (!routeArg) return;
    const raw = String(routeArg);

    const mUser = raw.match(/^u=([\w.@-]+)$/);
    if (mUser) {
      setValue(mUser[1]);
      return;
    }

    const mPub = raw.match(/^p=([0-9a-f]{64})$/i);
    if (mPub) {
      const pub = mPub[1].toLowerCase();
      if (pub === me?.pubkey_hex) {
        setError('Це посилання на ваш власний акаунт.');
        return;
      }
      // Anonymous contact — open chat by pubkey directly, no lookup needed
      openAnonChat(pub);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeArg]);

  function onInput(e) {
    let v = e.target.value.toLowerCase().replace(/[^a-z0-9_@.-]/g, '');
    setValue(v);
    setError(null);
    setHint(null);
  }

  function openAnonChat(pubkeyHex) {
    const contact = contacts.upsert({
      pubkey_hex: pubkeyHex,
      username: null,
      home_relay: null,
    });
    convs.ensureConversation({
      peerPubkey: contact.pubkey_hex,
      peerUsername: null,
      peerHomeRelay: null,
    });
    onNavigate(`chat/${pubkeyHex}`);
  }

  async function findClicked() {
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setHint(null);

    let parsed;
    try {
      parsed = parseAddress(value);
    } catch (e) {
      setError(e.message);
      setBusy(false);
      return;
    }

    const cached = contacts.findByUsername(parsed.username, parsed.relay);
    if (cached) {
      openChat(cached);
      return;
    }

    if (!parsed.relay || parsed.relay === me.home_relay) {
      try {
        const user = await api.lookupUsername(parsed.username);
        const contact = contacts.upsert({
          pubkey_hex: user.pubkey_hex,
          username: user.username,
          home_relay: user.home_relay,
        });
        if (contact.pubkey_hex === me.pubkey_hex) {
          setError('Це ви самі.');
          setBusy(false);
          return;
        }
        openChat(contact);
        return;
      } catch (e) {
        if (e.status === 404 && !parsed.relay) {
          setHint(`Юзера немає на цьому сервері. Спробуйте написати повну адресу типу @${parsed.username}@relay2.morok.app`);
          setBusy(false);
          return;
        }
        if (e.status !== 404) {
          setError(e.message);
          setBusy(false);
          return;
        }
      }
    }

    if (parsed.relay && parsed.relay !== me.home_relay) {
      try {
        const user = await api.lookupUsername(parsed.username, parsed.relay);
        const contact = contacts.upsert({
          pubkey_hex: user.pubkey_hex,
          username: user.username,
          home_relay: user.home_relay,
        });
        if (contact.pubkey_hex === me.pubkey_hex) {
          setError('Це ви самі.');
          setBusy(false);
          return;
        }
        openChat(contact);
        return;
      } catch (e) {
        if (e.status === 404) {
          setError(`Юзер @${parsed.username} не знайдений на ${parsed.relay}`);
        } else if (e.status === 503) {
          setError(`Сервер ${parsed.relay} тимчасово недоступний. Спробуйте пізніше.`);
        } else {
          setError(e.message || 'Помилка пошуку');
        }
        setBusy(false);
        return;
      }
    }

    setError('Юзера не знайдено');
    setBusy(false);
  }

  function openChat(contact) {
    convs.ensureConversation({
      peerPubkey: contact.pubkey_hex,
      peerUsername: contact.username,
      peerHomeRelay: contact.home_relay,
    });
    onNavigate(`chat/${contact.pubkey_hex}`);
  }

  const knownContacts = contacts.listContacts();

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

      <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="hint">
          Юзернейм людини або повна адреса якщо вона на іншому сервері:<br/>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-faint)' }}>
            @vasya · @vasya@relay2.morok.app
          </span>
        </p>

        <div className="input-wrap">
          <input
            className="input"
            type="text"
            placeholder="@username[@relay]"
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
        {hint && (
          <div style={{
            background: 'rgba(107, 138, 254, 0.08)',
            border: '1px solid rgba(107, 138, 254, 0.25)',
            color: 'var(--text)',
            padding: '10px 12px',
            borderRadius: 10,
            fontSize: 12.5,
            lineHeight: 1.5,
          }}>{hint}</div>
        )}

        <button
          className="btn btn-primary"
          disabled={!value || busy}
          onClick={findClicked}
        >
          {busy ? 'Шукаємо...' : 'Знайти'}
        </button>

        <p style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.5 }}>
          Якщо у людини нема юзернейма — попросіть її QR/лінк і відкрийте його.
        </p>
      </div>

      {knownContacts.length > 0 && (
        <div style={{ marginTop: 24, flex: 1, overflowY: 'auto' }}>
          <div style={{
            fontSize: 11, color: 'var(--text-faint)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            padding: '4px 20px 10px', fontWeight: 600,
          }}>
            Нещодавні
          </div>
          {knownContacts.slice(0, 30).map((c) => {
            const hue = parseInt(c.pubkey_hex.slice(0, 6), 16) % 360;
            const displayName = formatPeerName({ username: c.username, pubkey: c.pubkey_hex });
            return (
              <div
                key={c.pubkey_hex}
                onClick={() => openChat(c)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 20px', cursor: 'pointer',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: `hsl(${hue}, 45%, 45%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 14, color: '#fff',
                }}>
                  {displayName[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    @{displayName}
                    {c.home_relay && c.home_relay !== me?.home_relay && (
                      <span style={{ fontSize: 10.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)', fontWeight: 400 }}>
                        @{c.home_relay}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
