import { useState } from 'react';
import * as groups from '../lib/groups.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { hexToBytes } from '../lib/crypto.js';

function getSeedBytes() {
  const v = vault.getUnlockedSeed();
  if (v) return v;
  const id = store.loadIdentity();
  if (id && !id.encrypted && id.seed_hex) return hexToBytes(id.seed_hex);
  return null;
}

export default function JoinGroup({ routeArg, onNavigate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [joined, setJoined] = useState(null);

  const token = (() => {
    if (!routeArg) return null;
    const m = String(routeArg).match(/^t=([A-Za-z0-9_-]{20,40})$/);
    return m ? m[1] : null;
  })();

  if (!token) {
    return (
      <div className="screen" style={{ background: '#0A0A0B' }}>
        <Header onClose={() => onNavigate('chats')} title="Запрошення" />
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '40px 24px', textAlign: 'center', gap: 16,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18,
            background: 'rgba(255, 107, 122, 0.1)',
            border: '1px solid rgba(255, 107, 122, 0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#FF6B7A',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#F5F5F7', letterSpacing: '-0.02em' }}>
            Невалідний лінк
          </div>
          <div style={{ fontSize: 13, color: '#ABADB8', maxWidth: 320, lineHeight: 1.55 }}>
            Лінк запрошення некоректний або вже використаний.
          </div>
        </div>
      </div>
    );
  }

  async function joinClicked() {
    setBusy(true);
    setError(null);
    try {
      const seed = getSeedBytes();
      const myPubkeyHex = store.loadProfile()?.pubkey_hex
        || store.loadIdentity()?.pubkey_hex;

      if (!seed || !myPubkeyHex) {
        setError('Сеанс закінчився. Перезавантажте сторінку.');
        setBusy(false);
        return;
      }

      const result = await groups.joinViaToken({
        token,
        seed,
        myPubkeyHex,
      });
      setJoined(result);
      setTimeout(() => onNavigate(`group/${result.group_id}`), 800);
    } catch (e) {
      if (e.status === 404) {
        setError('Лінк недійсний або вже використаний.');
      } else if (e.status === 429) {
        setError('Забагато спроб. Спробуйте за хвилину.');
      } else {
        setError(e.message || 'Помилка');
      }
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{
      background: '#0A0A0B', position: 'relative', overflow: 'hidden',
    }}>
      {/* Dot grid bg */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(circle, #1A1A22 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        opacity: 0.4,
        pointerEvents: 'none',
      }} />

      <Header onClose={() => onNavigate('chats')} title="Запрошення" />

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '20px 24px',
        gap: 24, position: 'relative', zIndex: 1,
      }}>
        {/* Big group icon */}
        <div style={{
          width: 96, height: 96, borderRadius: 22,
          background: 'linear-gradient(135deg, #7B96FF 0%, #5A6FE0 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white',
          boxShadow: '0 16px 48px rgba(107, 138, 254, 0.3)',
        }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>

        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <h2 style={{
            fontSize: 24, fontWeight: 800,
            color: '#F5F5F7',
            letterSpacing: '-0.025em',
            margin: '0 0 12px',
          }}>
            Запрошення до групи
          </h2>
          <p style={{
            fontSize: 13.5, color: '#ABADB8',
            lineHeight: 1.55, margin: 0,
          }}>
            Хтось поділився з вами лінком на приватну групу Morok.
            Назва і повідомлення завантажаться автоматично за пару секунд.
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            color: '#FF6B7A',
            padding: '10px 14px', borderRadius: 10,
            fontSize: 13,
            maxWidth: 320, width: '100%',
          }}>{error}</div>
        )}

        {joined && (
          <div style={{
            background: 'rgba(74, 222, 128, 0.08)',
            border: '1px solid rgba(74, 222, 128, 0.25)',
            color: '#4ADE80',
            padding: '10px 14px', borderRadius: 10,
            fontSize: 13.5, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Ви в групі. Переходимо...
          </div>
        )}
      </div>

      <div style={{
        padding: '14px 20px 24px',
        position: 'relative', zIndex: 1,
      }}>
        <button
          onClick={joinClicked}
          disabled={busy || !!joined}
          style={{
            width: '100%',
            padding: '16px 22px',
            borderRadius: 14,
            background: (busy || joined) ? '#2A2A33' : '#F5F5F7',
            color: (busy || joined) ? '#5A5A65' : '#0A0A0B',
            border: 'none',
            fontSize: 15, fontWeight: 600,
            letterSpacing: '-0.005em',
            cursor: (busy || joined) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            marginBottom: 8,
          }}
        >
          {busy ? 'Приєднуємось...' : 'Приєднатися'}
        </button>
        {!joined && (
          <button
            onClick={() => onNavigate('chats')}
            style={{
              width: '100%',
              padding: '12px',
              background: 'transparent',
              border: 'none',
              color: '#A4A6B2',
              fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Скасувати
          </button>
        )}
      </div>
    </div>
  );
}

function Header({ title, onClose }) {
  return (
    <div style={{
      padding: '20px 20px 8px',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
      position: 'relative', zIndex: 2,
    }}>
      <button
        onClick={onClose}
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
  );
}
