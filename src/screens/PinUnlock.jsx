import { useState, useEffect, useRef } from 'react';
import { unlockSeedWithPin, getLockoutStatus, recordWrongPin, clearLockout, markUnlocked } from '../lib/vault.js';
import * as store from '../lib/storage.js';

export default function PinUnlock({ onUnlocked, onForgotPin }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lockout, setLockout] = useState(getLockoutStatus());
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const inputRef = useRef(null);

  // Update cooldown countdown
  useEffect(() => {
    if (!lockout.locked) return;
    setCooldownRemaining(lockout.remaining_s);
    const id = setInterval(() => {
      const s = getLockoutStatus();
      setLockout(s);
      setCooldownRemaining(s.locked ? s.remaining_s : 0);
      if (!s.locked) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [lockout.locked]);

  useEffect(() => {
    if (!lockout.locked) inputRef.current?.focus();
  }, [lockout.locked]);

  function onDigit(d) {
    if (busy || lockout.locked) return;
    if (pin.length >= 6) return;
    setPin(pin + d);
    setError(null);
  }

  function onBack() {
    if (busy || lockout.locked) return;
    setPin(pin.slice(0, -1));
    setError(null);
  }

  // Auto-attempt when 6 digits entered
  useEffect(() => {
    if (pin.length === 6 && !busy && !lockout.locked) {
      attempt();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function attempt() {
    setBusy(true);
    try {
      const id = store.loadIdentity();
      if (!id || !id.encrypted) {
        setError('Локальний акаунт не знайдено');
        setBusy(false);
        return;
      }
      const seedBytes = unlockSeedWithPin(id.blob_b64, pin);
      clearLockout();
      markUnlocked(seedBytes);
      onUnlocked?.(seedBytes);
    } catch (e) {
      const s = recordWrongPin();
      setLockout(s);
      setPin('');
      if (s.locked) {
        setError(`Забагато спроб. Зачекайте ${Math.ceil(s.remaining_s / 60)} хв.`);
      } else {
        setError('Неправильний PIN');
      }
      setBusy(false);
    }
  }

  function fmtCooldown(s) {
    if (s >= 3600) return `${Math.ceil(s / 3600)} год`;
    if (s >= 60) return `${Math.ceil(s / 60)} хв`;
    return `${s} с`;
  }

  return (
    <div className="onb" style={{ paddingTop: 60 }}>
      <div className="onb-content" style={{ alignItems: 'center', gap: 24 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22,
          background: 'linear-gradient(135deg, var(--accent) 0%, #4A5FB0 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 30, fontWeight: 800, color: '#FFF',
        }}>M</div>

        <h1 style={{ textAlign: 'center', fontSize: 22 }}>Введіть PIN</h1>

        {/* PIN dots */}
        <div style={{
          display: 'flex', gap: 14,
          justifyContent: 'center',
        }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                width: 16, height: 16, borderRadius: '50%',
                background: i < pin.length ? 'var(--accent)' : 'transparent',
                border: '1.5px solid var(--border)',
              }}
            />
          ))}
        </div>

        {lockout.locked && (
          <div style={{
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            color: 'var(--danger)',
            padding: '12px 14px',
            borderRadius: 12,
            fontSize: 13,
            textAlign: 'center',
            lineHeight: 1.5,
          }}>
            Локальний акаунт заблоковано<br/>
            Спробуйте знов через {fmtCooldown(cooldownRemaining)}
          </div>
        )}

        {!lockout.locked && error && (
          <div className="error-text" style={{ textAlign: 'center' }}>{error}</div>
        )}

        {/* Hidden input */}
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          maxLength={6}
          value={pin}
          onChange={(e) => {
            if (lockout.locked) return;
            const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
            setPin(v);
          }}
          style={{
            position: 'absolute', opacity: 0, pointerEvents: 'none',
            width: 1, height: 1,
          }}
        />

        {/* On-screen keypad */}
        <div style={{
          marginTop: 8, display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
          width: '100%', maxWidth: 280,
          opacity: lockout.locked ? 0.4 : 1,
          pointerEvents: lockout.locked ? 'none' : 'auto',
        }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <button
              key={d}
              className="btn btn-secondary"
              style={{ height: 56, fontSize: 22, fontWeight: 500 }}
              onClick={() => onDigit(String(d))}
            >{d}</button>
          ))}
          <div />
          <button
            className="btn btn-secondary"
            style={{ height: 56, fontSize: 22, fontWeight: 500 }}
            onClick={() => onDigit('0')}
          >0</button>
          <button
            className="btn btn-ghost"
            style={{ height: 56, fontSize: 18 }}
            onClick={onBack}
          >⌫</button>
        </div>

        <button
          className="btn btn-ghost"
          style={{ marginTop: 16, fontSize: 13 }}
          onClick={onForgotPin}
        >
          Забув PIN — увійти за 24 словами
        </button>
      </div>
    </div>
  );
}
