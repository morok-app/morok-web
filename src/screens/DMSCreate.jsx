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
    <div className="screen">
      <div className="topbar">
        <div className="back" onClick={() => onNavigate('dms')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        <div className="title">Новий заповіт</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 32px' }}>
        <p className="hint" style={{ marginBottom: 20 }}>
          Це повідомлення доставиться обраному отримувачу, якщо ви не зайдете
          в Morok протягом обраного періоду.
        </p>

        {/* Label */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11, color: 'var(--text-faint)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            marginBottom: 8,
          }}>Назва (опційно)</div>
          <input
            className="input"
            type="text"
            placeholder="Наприклад: 'Сімʼя' або 'Бекап ключів'"
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 100))}
          />
        </div>

        {/* Recipient */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11, color: 'var(--text-faint)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            marginBottom: 8,
          }}>Отримувач</div>
          {recipient ? (
            <div
              onClick={() => setShowContactPicker(true)}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 12, padding: '12px 14px',
                display: 'flex', alignItems: 'center', gap: 10,
                cursor: 'pointer',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: `hsl(${parseInt(recipient.pubkey_hex.slice(0,6),16)%360}, 45%, 45%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 13, color: '#fff', flexShrink: 0,
              }}>
                {formatPeerName({ username: recipient.username, pubkey: recipient.pubkey_hex })[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  @{formatPeerName({ username: recipient.username, pubkey: recipient.pubkey_hex })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                  натисніть щоб змінити
                </div>
              </div>
            </div>
          ) : validRecipients.length === 0 ? (
            <div style={{
              padding: '12px 14px',
              background: 'rgba(255, 107, 122, 0.08)',
              border: '1px solid rgba(255, 107, 122, 0.25)',
              borderRadius: 12,
              fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5,
            }}>
              Спершу почніть звичайний чат з людиною — тоді її можна вибрати тут.
            </div>
          ) : (
            <button
              className="btn btn-secondary"
              onClick={() => setShowContactPicker(true)}
            >
              Вибрати з контактів
            </button>
          )}
        </div>

        {/* Trigger period */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11, color: 'var(--text-faint)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            marginBottom: 8,
          }}>Період неактивності</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dms.TRIGGER_OPTIONS.map((opt) => (
              <div
                key={opt.seconds}
                onClick={() => setTriggerSeconds(opt.seconds)}
                style={{
                  background: triggerSeconds === opt.seconds ? 'rgba(107, 138, 254, 0.1)' : 'var(--surface)',
                  border: `1px solid ${triggerSeconds === opt.seconds ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 10, padding: '10px 12px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{opt.hint}</div>
                </div>
                {triggerSeconds === opt.seconds && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Payload */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11, color: 'var(--text-faint)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            marginBottom: 8,
          }}>Повідомлення</div>
          <textarea
            className="textarea"
            placeholder="Те що отримає адресат коли заповіт спрацює..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ minHeight: 140 }}
          />
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.5 }}>
            Шифрується одразу на вашому пристрої. Сервер не може прочитати.
          </p>
        </div>

        {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

        <button
          className="btn btn-primary"
          disabled={!canCreate}
          onClick={createClicked}
        >
          {busy ? 'Створюємо...' : 'Створити заповіт'}
        </button>
      </div>

      {/* Contact picker */}
      {showContactPicker && (
        <div
          onClick={() => setShowContactPicker(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 60,
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', background: 'var(--surface)',
              borderTopLeftRadius: 22, borderTopRightRadius: 22,
              padding: '12px 0 28px', maxHeight: '70vh', overflowY: 'auto',
            }}
          >
            <div style={{ width: 32, height: 4, background: 'var(--text-faint)', borderRadius: 2, margin: '6px auto 14px', opacity: 0.4 }} />
            <div style={{
              fontSize: 13, color: 'var(--text-dim)',
              padding: '0 18px 14px',
              borderBottom: '1px solid var(--border)',
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
                    padding: '12px 18px', cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: `hsl(${hue}, 45%, 45%)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 13, color: '#fff',
                  }}>
                    {displayName[0].toUpperCase()}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
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
