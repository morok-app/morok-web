import { useState } from 'react';
import * as dms from '../lib/dms.js';
import * as contacts from '../lib/contacts.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { hexToBytes } from '../lib/crypto.js';
import { formatPeerName } from '../lib/display.js';

function getSeedBytes() {
  const v = vault.getUnlockedSeed();
  if (v) return v;
  const id = store.loadIdentity();
  if (id && !id.encrypted && id.seed_hex) return hexToBytes(id.seed_hex);
  return null;
}

export default function DMSCreate({ onNavigate }) {
  const [label, setLabel] = useState('');
  const [recipient, setRecipient] = useState(null);
  const [text, setText] = useState('');
  const [triggerSeconds, setTriggerSeconds] = useState(30 * 86400);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const knownContacts = contacts.listContacts();
  const myPubkey = store.loadIdentity()?.pubkey_hex;
  const validRecipients = knownContacts.filter((c) => c.pubkey_hex !== myPubkey);

  async function createClicked() {
    if (!recipient || !text || busy) return;
    setError(null);
    setBusy(true);
    try {
      const seed = getSeedBytes();
      const myProfile = store.loadProfile();
      const myPubkeyHex = myProfile?.pubkey_hex || store.loadIdentity()?.pubkey_hex;
      if (!seed || !myPubkeyHex) {
        setError('Сеанс закінчився. Перезавантажте сторінку.');
        setBusy(false);
        return;
      }
      await dms.createDeadManSwitch({
        seed, myPubkeyHex,
        recipientPubkeyHex: recipient.pubkey_hex,
        plaintext: text,
        triggerSeconds,
        label: label.trim() || null,
      });
      onNavigate('dms');
    } catch (e) {
      console.error(e);
      const friendly = {
        'too_many_recipients_for_tier_max_5': 'У free-акаунті ліміт 5 активних заповітів',
      }[e.message] || (e.message || 'Помилка');
      setError(friendly);
      setBusy(false);
    }
  }

  const canCreate = recipient && text.trim().length > 0 && !busy;

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
            Новий заповіт
          </div>
          <div style={{ fontSize: 13, color: '#6B6B72', marginTop: 6 }}>
            Доставиться якщо ви не зайдете
          </div>
        </div>
        <button
          onClick={() => onNavigate('dms')}
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

        {/* Label */}
        <FieldLabel>Назва (опційно)</FieldLabel>
        <input
          type="text"
          placeholder="Наприклад: «Сімʼя» або «Бекап ключів»"
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 100))}
          style={inputStyle}
          onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
          onBlur={(e) => e.target.style.borderColor = '#232329'}
        />
        <div style={{ height: 18 }} />

        {/* Recipient */}
        <FieldLabel>Отримувач</FieldLabel>
        {recipient ? (
          <div
            onClick={() => setShowContactPicker(true)}
            style={{
              background: '#13131A',
              border: '1px solid #232329',
              borderRadius: 12,
              padding: '12px 14px',
              display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: `hsl(${parseInt(recipient.pubkey_hex.slice(0, 6), 16) % 360}, 45%, 45%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 14, color: '#fff',
              flexShrink: 0,
            }}>
              {formatPeerName({ username: recipient.username, pubkey: recipient.pubkey_hex })[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 14, fontWeight: 600, color: '#F5F5F7',
                fontFamily: 'var(--mono, monospace)',
              }}>
                @{formatPeerName({ username: recipient.username, pubkey: recipient.pubkey_hex })}
              </div>
              <div style={{ fontSize: 11, color: '#5A5A65', marginTop: 2 }}>
                натисніть щоб змінити
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3F3F45" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        ) : validRecipients.length === 0 ? (
          <div style={{
            padding: '14px 16px',
            background: 'rgba(255, 169, 77, 0.08)',
            border: '1px solid rgba(255, 169, 77, 0.25)',
            borderRadius: 12,
            fontSize: 12.5, color: '#FFA94D', lineHeight: 1.5,
          }}>
            Спершу почніть звичайний чат з людиною — тоді її можна вибрати тут.
          </div>
        ) : (
          <button
            onClick={() => setShowContactPicker(true)}
            style={{
              width: '100%',
              padding: '14px 16px',
              background: '#13131A',
              border: '1px solid #232329',
              borderRadius: 12,
              color: '#A8A8B0', fontSize: 13.5,
              cursor: 'pointer', fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            + Вибрати з контактів
          </button>
        )}
        <div style={{ height: 18 }} />

        {/* Trigger period */}
        <FieldLabel>Період неактивності</FieldLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dms.TRIGGER_OPTIONS.map((opt) => {
            const active = triggerSeconds === opt.seconds;
            return (
              <div
                key={opt.seconds}
                onClick={() => setTriggerSeconds(opt.seconds)}
                style={{
                  background: active ? '#1A1F2E' : '#13131A',
                  border: `1px solid ${active ? '#7B96FF' : '#232329'}`,
                  borderRadius: 10, padding: '11px 14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#F5F5F7' }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: '#6B6B72' }}>{opt.hint}</div>
                </div>
                {active && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7B96FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ height: 18 }} />

        {/* Payload */}
        <FieldLabel>Повідомлення</FieldLabel>
        <textarea
          placeholder="Те що отримає адресат коли заповіт спрацює..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ ...inputStyle, minHeight: 140, resize: 'none' }}
          onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
          onBlur={(e) => e.target.style.borderColor = '#232329'}
        />
        <p style={{ fontSize: 11.5, color: '#5A5A65', marginTop: 8, lineHeight: 1.5 }}>
          Шифрується на вашому пристрої. Сервер не може прочитати.
        </p>

        {error && (
          <div style={{
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            color: '#FF6B7A',
            padding: '10px 14px', borderRadius: 10,
            fontSize: 13, marginTop: 14,
          }}>{error}</div>
        )}

        <button
          onClick={createClicked}
          disabled={!canCreate}
          style={{
            width: '100%', marginTop: 20,
            padding: '16px 22px',
            borderRadius: 14,
            background: canCreate ? '#F5F5F7' : '#2A2A33',
            color: canCreate ? '#0A0A0B' : '#5A5A65',
            border: 'none',
            fontSize: 15, fontWeight: 600,
            letterSpacing: '-0.005em',
            cursor: canCreate ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}
        >
          {busy ? 'Створюємо...' : 'Створити заповіт'}
        </button>
      </div>

      {/* Contact picker sheet */}
      {showContactPicker && (
        <div
          onClick={() => setShowContactPicker(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.7)', zIndex: 60,
            display: 'flex', alignItems: 'flex-end',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', background: '#16161B',
              borderTop: '1px solid #232329',
              borderTopLeftRadius: 22, borderTopRightRadius: 22,
              padding: '12px 0 28px', maxHeight: '70vh', overflowY: 'auto',
            }}
          >
            <div style={{
              width: 36, height: 4, background: '#3F3F45',
              borderRadius: 2, margin: '6px auto 14px',
            }} />
            <div style={{
              fontSize: 13, color: '#8E8E99',
              padding: '0 20px 14px',
              borderBottom: '1px solid #232329',
              fontWeight: 500,
            }}>
              Виберіть отримувача
            </div>
            {validRecipients.map((c) => {
              const hue = parseInt(c.pubkey_hex.slice(0, 6), 16) % 360;
              const displayName = formatPeerName({ username: c.username, pubkey: c.pubkey_hex });
              return (
                <div
                  key={c.pubkey_hex}
                  onClick={() => {
                    setRecipient(c);
                    setShowContactPicker(false);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 20px', cursor: 'pointer',
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
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: '#F5F5F7',
                    fontFamily: 'var(--mono, monospace)',
                  }}>
                    @{displayName}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, color: '#5A5A65',
      marginBottom: 8,
      fontFamily: 'var(--mono, monospace)',
      letterSpacing: '0.05em',
    }}>
      {String(children).toUpperCase()}
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '13px 14px',
  background: '#13131A',
  border: '1px solid #232329',
  borderRadius: 12,
  color: '#F5F5F7',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'border-color 0.15s',
};
