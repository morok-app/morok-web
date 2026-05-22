import { useState } from 'react';
import * as contacts from '../lib/contacts.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import * as groups from '../lib/groups.js';
import { hexToBytes } from '../lib/crypto.js';

function getSeedBytes() {
  const v = vault.getUnlockedSeed();
  if (v) return v;
  const id = store.loadIdentity();
  if (id && !id.encrypted && id.seed_hex) return hexToBytes(id.seed_hex);
  return null;
}

export default function NewGroup({ onNavigate }) {
  const me = store.loadProfile();
  const myContacts = contacts.listContacts();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function toggle(pubkey) {
    const next = new Set(selected);
    if (next.has(pubkey)) next.delete(pubkey);
    else next.add(pubkey);
    setSelected(next);
  }

  async function createClicked() {
    if (!name.trim() || busy) return;
    const seed = getSeedBytes();
    if (!seed) {
      alert('Сеанс закінчився. Перезавантажте сторінку.');
      return;
    }
    if (!me?.pubkey_hex) {
      alert('Не знайдено мій pubkey.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const members = myContacts.filter((c) => selected.has(c.pubkey_hex));
      const result = await groups.createGroup({
        name: name.trim(),
        members,
        seed,
        myPubkeyHex: me.pubkey_hex,
      });
      vault.refreshSession();
      onNavigate(`group/${result.group_id}`);
    } catch (e) {
      console.error(e);
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
        <div className="title">Нова група</div>
      </div>

      <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="hint">
          Назва зашифрована і видима тільки учасникам.
        </p>

        <input
          className="input"
          type="text"
          placeholder="Назва групи"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          maxLength={50}
          autoFocus
        />

        {error && <div className="error-text">{error}</div>}
      </div>

      <div style={{
        padding: '14px 20px 8px',
        fontSize: 11, color: 'var(--text-faint)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>
        Учасники з контактів ({selected.size} обрано)
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {myContacts.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, padding: 24 }}>
            Поки нема контактів. Спершу напишіть комусь — і він зʼявиться тут.
          </div>
        ) : (
          myContacts.map((c) => {
            const hue = parseInt(c.pubkey_hex.slice(0, 6), 16) % 360;
            const isSelected = selected.has(c.pubkey_hex);
            return (
              <div
                key={c.pubkey_hex}
                onClick={() => toggle(c.pubkey_hex)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 20px', cursor: 'pointer',
                  background: isSelected ? 'rgba(107, 138, 254, 0.08)' : 'transparent',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: `hsl(${hue}, 45%, 45%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 14, color: '#fff',
                }}>
                  {(c.username?.[0] || '?').toUpperCase()}
                </div>
                <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>
                  @{c.username || c.pubkey_hex.slice(0, 8)}
                </div>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)' }}>
        <button
          className="btn btn-primary"
          disabled={!name.trim() || busy}
          onClick={createClicked}
        >
          {busy ? 'Створюємо...' : `Створити${selected.size > 0 ? ` (${selected.size} учасників)` : ''}`}
        </button>
      </div>
    </div>
  );
}
