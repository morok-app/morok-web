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
    <div className="screen" style={{ background: '#0A0A0B' }}>

      {/* Header */}
      <div style={{
        padding: '20px 20px 24px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 12,
      }}>
        <div>
          <div style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#F5F5F7', lineHeight: 1.1,
          }}>
            Новий чат
          </div>
          <div style={{ fontSize: 13, color: '#6B6B72', marginTop: 6 }}>
            Знайти юзера за іменем
          </div>
        </div>
        <button
          onClick={() => onNavigate('chats')}
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

      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        <div style={{
          fontSize: 11, color: '#5A5A65',
          marginBottom: -4,
          fontFamily: 'var(--mono, monospace)',
          letterSpacing: '0.05em',
        }}>ЮЗЕРНЕЙМ</div>

        <input
          type="text"
          placeholder="@username[@relay]"
          value={value}
          onChange={onInput}
          onKeyDown={(e) => e.key === 'Enter' && findClicked()}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '14px 16px',
            background: '#13131A',
            border: '1px solid #232329',
            borderRadius: 12,
            color: '#F5F5F7',
            fontSize: 14.5, fontFamily: 'var(--mono, monospace)',
            outline: 'none',
            letterSpacing: '0.01em',
          }}
          onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
          onBlur={(e) => e.target.style.borderColor = '#232329'}
        />

        <p style={{
          fontSize: 11.5, color: '#5A5A65',
          margin: '-4px 0 0', lineHeight: 1.5,
          fontFamily: 'var(--mono, monospace)',
        }}>
          @vasya · @vasya@relay2.morok.app
        </p>

        {error && (
          <div style={{
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            color: '#FF6B7A',
            padding: '10px 14px', borderRadius: 10,
            fontSize: 13,
          }}>{error}</div>
        )}

        {hint && (
          <div style={{
            background: 'rgba(107, 138, 254, 0.08)',
            border: '1px solid rgba(107, 138, 254, 0.25)',
            color: '#A8B5F0',
            padding: '10px 14px', borderRadius: 10,
            fontSize: 12.5, lineHeight: 1.5,
          }}>{hint}</div>
        )}

        <button
          onClick={findClicked}
          disabled={!value || busy}
          style={{
            width: '100%',
            padding: '14px 22px',
            borderRadius: 14,
            background: (!value || busy) ? '#2A2A33' : '#F5F5F7',
            color: (!value || busy) ? '#5A5A65' : '#0A0A0B',
            border: 'none',
            fontSize: 14.5, fontWeight: 600,
            letterSpacing: '-0.005em',
            cursor: (!value || busy) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {busy ? 'Шукаємо...' : 'Знайти'}
        </button>

        <p style={{ fontSize: 11.5, color: '#5A5A65', margin: '4px 0 0', lineHeight: 1.5 }}>
          Якщо у людини нема юзернейма — попросіть її QR/лінк і відкрийте його.
        </p>
      </div>

      {knownContacts.length > 0 && (
        <div style={{ marginTop: 28, flex: 1, overflowY: 'auto', paddingBottom: 16 }}>
          <div style={{
            fontSize: 11, color: '#3F3F45',
            textTransform: 'uppercase', letterSpacing: '0.1em',
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
                className="lin-row-hover"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 20px', cursor: 'pointer',
                  transition: 'background 0.12s',
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: '50%',
                  background: `hsl(${hue}, 45%, 45%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 14, color: '#fff',
                  flexShrink: 0,
                }}>
                  {displayName[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: '#F5F5F7',
                    fontFamily: 'var(--mono, monospace)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    @{displayName}
                    {c.home_relay && c.home_relay !== me?.home_relay && (
                      <span style={{
                        fontSize: 11, color: '#5A5A65', fontWeight: 400,
                        marginLeft: 2,
                      }}>
                        @{c.home_relay}
                      </span>
                    )}
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3F3F45" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .lin-row-hover:hover { background: #111116; }
      `}</style>
    </div>
  );
}
