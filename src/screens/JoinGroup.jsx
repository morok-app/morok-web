import { useState, useEffect } from 'react';
import * as groups from '../lib/groups.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { hexToBytes } from '../lib/crypto.js';

/**
 * Landing page for invite links:
 *   #join?t=<token>
 *
 * If not authenticated, App.jsx saves the URL as pending and routes to
 * welcome — after the user signs up/in, they come back here.
 */
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

  // Parse routeArg "t=<token>"
  const token = (() => {
    if (!routeArg) return null;
    const m = String(routeArg).match(/^t=([A-Za-z0-9_-]{20,40})$/);
    return m ? m[1] : null;
  })();

  if (!token) {
    return (
      <div className="onb">
        <div className="onb-header">
          <div className="back" onClick={() => onNavigate('chats')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </div>
        </div>
        <div className="onb-content">
          <h1>Невалідний лінк</h1>
          <p className="hint">Лінк запрошення некоректний.</p>
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
      // Wait a moment, then route to the group
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
    <div className="onb">
      <div className="onb-header">
        <div className="back" onClick={() => onNavigate('chats')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
      </div>

      <div className="onb-content" style={{ alignItems: 'center', textAlign: 'center', gap: 20 }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent) 0%, #4A5FB0 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36,
        }}>👥</div>

        <h1 style={{ textAlign: 'center' }}>Запрошення до групи</h1>
        <p className="hint" style={{ textAlign: 'center' }}>
          Хтось поділився з вами лінком на приватну групу Morok.<br/>
          Назва і повідомлення завантажаться автоматично за пару секунд.
        </p>

        {error && <div className="error-text">{error}</div>}
        {joined && (
          <div style={{ color: 'var(--success)', fontSize: 13.5 }}>
            ✓ Ви в групі. Переходимо...
          </div>
        )}
      </div>

      <div className="onb-footer">
        <button
          className="btn btn-primary"
          disabled={busy || !!joined}
          onClick={joinClicked}
        >
          {busy ? 'Приєднуємось...' : 'Приєднатися'}
        </button>
        {!joined && (
          <button
            className="btn btn-ghost"
            onClick={() => onNavigate('chats')}
          >
            Скасувати
          </button>
        )}
      </div>
    </div>
  );
}
