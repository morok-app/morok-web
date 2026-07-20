import { useState, useEffect, useRef } from 'react';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { decryptWithSecret } from '../lib/vault.js';

/**
 * PinUnlock — Linear-style unlock screen.
 *
 * App.jsx routes here when identity is encrypted and the seed isn't in
 * memory. After a successful decrypt we call onUnlocked(seedBytes) and
 * App.jsx does the full login → inbox start → navigate('chats') flow.
 *
 * 5 wrong attempts → 30s lockout, escalating per vault's lockout policy.
 */
const isDesktop = typeof window !== 'undefined' && !('ontouchstart' in window);

export default function PinUnlock({ onUnlocked, onForgotPin }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [lockoutSeconds, setLockoutSeconds] = useState(() => {
    const s = vault.getLockoutStatus();
    return s.locked ? s.remaining_s : 0;
  });
  const [wipeStep, setWipeStep] = useState(0);
  const inputRef = useRef(null);
  const wipeResetTimer = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const t = setTimeout(() => setLockoutSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [lockoutSeconds]);

  function tryUnlock(value) {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setPin(digits);

    if (digits.length !== 6) return;

    setTimeout(() => {
      try {
        const identity = store.loadIdentity();
        const seedBytes = decryptWithSecret(identity.blob_b64, digits);
        vault.markUnlocked(seedBytes);
        vault.clearLockout();
        onUnlocked?.(seedBytes);
      } catch (e) {
        const status = vault.recordWrongPin();
        if (status.locked) {
          setLockoutSeconds(status.remaining_s);
          setError(`Забагато спроб. Зачекайте ${status.remaining_s}с.`);
        } else {
          setError('Неправильний PIN');
        }
        setPin('');
      }
    }, 100);
  }

  function emergencyExitClicked() {
    // 3-click confirmation with a 5-second reset timer between clicks.
    // Step 0 → Step 1 → Step 2 → triggers wipe. If user pauses for 5s
    // at any step, the counter resets to 0. This protects against
    // accidental taps without forcing the user through a modal flow.
    if (wipeResetTimer.current) {
      clearTimeout(wipeResetTimer.current);
      wipeResetTimer.current = null;
    }

    const next = wipeStep + 1;

    if (next >= 3) {
      setWipeStep(0);
      onForgotPin?.();
      return;
    }

    setWipeStep(next);
    wipeResetTimer.current = setTimeout(() => {
      setWipeStep(0);
      wipeResetTimer.current = null;
    }, 5000);
  }

  // Cleanup timer when component unmounts
  useEffect(() => {
    return () => {
      if (wipeResetTimer.current) {
        clearTimeout(wipeResetTimer.current);
        wipeResetTimer.current = null;
      }
    };
  }, []);

  const locked = lockoutSeconds > 0;

  return (
    <div className="screen" style={{
      background: '#0A0A0B',
      display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
    }}>
      <style>{`
        @keyframes morokWipePulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.55; }
        }
      `}</style>

      {/* Dot grid bg */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(circle, #1A1A22 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        opacity: 0.4,
        pointerEvents: 'none',
      }} />

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '20px',
        gap: 32, position: 'relative', zIndex: 1,
      }}>
        {/* M logo */}
        <div style={{
          width: 72, height: 72,
          borderRadius: 18,
          background: 'linear-gradient(135deg, #7B96FF 0%, #5A6FE0 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 800, fontSize: 42,
          boxShadow: '0 12px 36px rgba(107, 138, 254, 0.3)',
          letterSpacing: '-0.04em',
        }}>M</div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 22, fontWeight: 700, color: '#F5F5F7',
            letterSpacing: '-0.02em', marginBottom: 8,
          }}>
            Введіть PIN
          </div>
          <div style={{ fontSize: 13, color: '#6B6B72' }}>
            6 цифр щоб розблокувати акаунт
          </div>
        </div>

        {/* Dots */}
        <div style={{ display: 'flex', gap: 14 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              width: 14, height: 14, borderRadius: '50%',
              background: i < pin.length ? '#F5F5F7' : 'transparent',
              border: '1.5px solid ' + (i < pin.length ? '#F5F5F7' : '#3F3F45'),
              transition: 'all 0.12s',
            }} />
          ))}
        </div>

        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          autoFocus
          value={pin}
          disabled={locked}
          onBlur={() => setTimeout(() => inputRef.current?.focus(), 50)}
          onChange={(e) => tryUnlock(e.target.value)}
          style={{
            position: 'absolute', opacity: 0, pointerEvents: 'none',
            width: 1, height: 1,
          }}
        />

        <div
          onClick={() => inputRef.current?.focus()}
          style={{
            fontSize: 12.5, color: '#6B6B72',
            cursor: 'pointer', padding: 10,
          }}
        >
          {isDesktop
            ? '⌨ Введіть 6 цифр із клавіатури'
            : "Натисніть тут якщо клавіатура не з'явилась"}
        </div>

        {error && (
          <div style={{
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            color: '#FF6B7A',
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 13,
          }}>
            {error}
          </div>
        )}
      </div>

      <div style={{ padding: '0 20px 28px', textAlign: 'center', position: 'relative', zIndex: 1 }}>
        {wipeStep === 0 && (
          <button
            onClick={emergencyExitClicked}
            style={{
              background: 'transparent', border: 'none',
              color: '#FF6B7A', fontSize: 12.5,
              cursor: 'pointer', fontFamily: 'inherit',
              padding: 10,
            }}
          >
            🆘 Аварійний вихід (стерти все)
          </button>
        )}
        {wipeStep === 1 && (
          <button
            onClick={emergencyExitClicked}
            style={{
              background: 'rgba(255, 153, 0, 0.08)',
              border: '1px solid rgba(255, 153, 0, 0.35)',
              color: '#FF9900', fontSize: 12.5,
              cursor: 'pointer', fontFamily: 'inherit',
              padding: '10px 16px',
              borderRadius: 10,
              fontWeight: 600,
            }}
          >
            ⚠ Підтвердження 1/3 — натисніть ще двічі
          </button>
        )}
        {wipeStep === 2 && (
          <button
            onClick={emergencyExitClicked}
            style={{
              background: 'rgba(255, 74, 92, 0.12)',
              border: '1px solid rgba(255, 74, 92, 0.5)',
              color: '#FF4A5C', fontSize: 12.5,
              cursor: 'pointer', fontFamily: 'inherit',
              padding: '10px 16px',
              borderRadius: 10,
              fontWeight: 700,
              animation: 'morokWipePulse 0.8s ease-in-out infinite',
            }}
          >
            🔥 ОСТАННЄ ПОПЕРЕДЖЕННЯ — клік сотре ВСЕ
          </button>
        )}
        {wipeStep > 0 && (
          <div style={{
            fontSize: 10.5, color: '#5A5A65',
            marginTop: 8,
            fontFamily: 'var(--mono, monospace)',
          }}>
            відміна через 5с бездіяльності
          </div>
        )}
      </div>
    </div>
  );
}
