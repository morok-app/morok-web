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
            Нова група
          </div>
          <div style={{ fontSize: 13, color: '#6B6B72', marginTop: 6 }}>
            Назва зашифрована, видима тільки учасникам
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
          fontFamily: 'var(--mono, monospace)',
          letterSpacing: '0.05em',
        }}>НАЗВА</div>

        <input
          type="text"
          placeholder="Друзі, Сімʼя, Робота..."
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          maxLength={50}
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '14px 16px',
            background: '#13131A',
            border: '1px solid #232329',
            borderRadius: 12,
            color: '#F5F5F7',
            fontSize: 14.5, fontFamily: 'inherit',
            outline: 'none', marginTop: -10,
          }}
          onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
          onBlur={(e) => e.target.style.borderColor = '#232329'}
        />

        {error && (
          <div style={{
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            color: '#FF6B7A',
            padding: '10px 14px', borderRadius: 10,
            fontSize: 13,
          }}>{error}</div>
        )}
      </div>

      <div style={{
        padding: '20px 20px 10px',
        fontSize: 11, color: '#3F3F45',
        textTransform: 'uppercase', letterSpacing: '0.1em',
        fontWeight: 600,
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span>УЧАСНИКИ</span>
        <span style={{ color: '#6B6B72', fontFamily: 'var(--mono, monospace)', letterSpacing: '0.02em' }}>
          {selected.size} обрано
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {myContacts.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '40px 24px', textAlign: 'center', gap: 12,
            marginTop: 20,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: '#13131A',
              border: '1px solid #232329',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#3F3F45',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/>
              </svg>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#F5F5F7' }}>Поки нема контактів</div>
            <div style={{ fontSize: 12, color: '#6B6B72', maxWidth: 260, lineHeight: 1.5 }}>
              Спершу напишіть комусь — і він зʼявиться тут
            </div>
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
                  padding: '12px 20px', cursor: 'pointer',
                  background: isSelected ? '#1A1F2E' : 'transparent',
                  borderLeft: '3px solid ' + (isSelected ? '#7B96FF' : 'transparent'),
                  transition: 'all 0.12s',
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: '50%',
                  background: `hsl(${hue}, 45%, 45%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 14, color: '#fff',
                  flexShrink: 0,
                }}>
                  {(c.username?.[0] || '?').toUpperCase()}
                </div>
                <div style={{
                  flex: 1, minWidth: 0,
                  fontSize: 14, fontWeight: 600,
                  color: '#F5F5F7',
                  fontFamily: 'var(--mono, monospace)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  @{c.username || c.pubkey_hex.slice(0, 8)}
                </div>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  border: `2px solid ${isSelected ? '#7B96FF' : '#3F3F45'}`,
                  background: isSelected ? '#7B96FF' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.12s',
                }}>
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{
        padding: '14px 20px 20px',
        borderTop: '1px solid #1E1E27',
        background: '#0A0A0B',
      }}>
        <button
          onClick={createClicked}
          disabled={!name.trim() || busy}
          style={{
            width: '100%',
            padding: '14px 22px',
            borderRadius: 14,
            background: (!name.trim() || busy) ? '#2A2A33' : '#F5F5F7',
            color: (!name.trim() || busy) ? '#5A5A65' : '#0A0A0B',
            border: 'none',
            fontSize: 14.5, fontWeight: 600,
            letterSpacing: '-0.005em',
            cursor: (!name.trim() || busy) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {busy ? 'Створюємо...' : `Створити${selected.size > 0 ? ` · ${selected.size}` : ''}`}
        </button>
      </div>
    </div>
  );
}
