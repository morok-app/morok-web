import { useState, useEffect, useRef } from 'react';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { utf8, hexToBytes } from '../lib/crypto.js';
import { encryptWithSecret } from '../lib/vault.js';

/**
 * PinSetup — Linear-style 6-digit PIN setup.
 *
 * 2-step:
 *   1) Enter new PIN
 *   2) Confirm by entering again
 *
 * Visual: 6 dots that fill as you type. Hidden text input for actual input.
 */
export default function PinSetup({ onNavigate, mode = 'initial' }) {
  // mode: 'initial' (from CreateAccount) | 'existing' (from Settings)
  const [step, setStep] = useState('enter'); // enter | confirm
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, [step]);

  function handleInput(value, target) {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    if (target === 'pin') setPin(digits);
    else setConfirm(digits);

    if (digits.length === 6) {
      // Auto-advance
      if (target === 'pin') {
        setTimeout(() => setStep('confirm'), 150);
      }
    }
  }

  function finalizeClicked() {
    if (pin !== confirm) {
      setError('PIN не співпадають');
      setConfirm('');
      return;
    }
    try {
      const identity = store.loadIdentity();
      if (!identity || !identity.seed_hex) {
        setError('Сесія завершилась. Перезавантажте сторінку.');
        return;
      }
      const seedBytes = hexToBytes(identity.seed_hex);
      const encryptedSeed = encryptWithSecret(seedBytes, pin);
      const mnemonicBytes = identity.mnemonic ? utf8(identity.mnemonic) : null;
      const encryptedMnemonic = mnemonicBytes ? encryptWithSecret(mnemonicBytes, pin) : null;

      store.saveIdentityEncrypted({
        seed_b64: encryptedSeed,
        mnemonic_b64: encryptedMnemonic,
        pubkey_hex: identity.pubkey_hex,
      });
      vault.markUnlocked(seedBytes);
      onNavigate(mode === 'existing' ? 'settings' : 'claim');
    } catch (e) {
      setError(e.message || 'Помилка');
    }
  }

  function skipClicked() {
    if (mode === 'existing') onNavigate('settings');
    else onNavigate('claim');
  }

  useEffect(() => {
    if (step === 'confirm' && confirm.length === 6) {
      setTimeout(finalizeClicked, 150);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm]);

  const currentValue = step === 'enter' ? pin : confirm;

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      <div style={{
        padding: '20px 20px 16px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#F5F5F7', lineHeight: 1.1,
          }}>
            {step === 'enter' ? 'Створіть PIN' : 'Повторіть PIN'}
          </div>
          <div style={{ fontSize: 13, color: '#6B6B72', marginTop: 6 }}>
            {step === 'enter'
              ? '6 цифр для захисту акаунта'
              : 'Введіть той самий PIN ще раз'}
          </div>
        </div>
        {mode === 'existing' && (
          <button
            onClick={() => onNavigate('settings')}
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
        )}
      </div>

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 20px',
        gap: 32,
      }}>
        {/* 6 dot indicators */}
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              width: 14, height: 14, borderRadius: '50%',
              background: i < currentValue.length ? '#F5F5F7' : 'transparent',
              border: '1.5px solid ' + (i < currentValue.length ? '#F5F5F7' : '#3F3F45'),
              transition: 'all 0.12s',
            }} />
          ))}
        </div>

        {/* Hidden input that captures digits */}
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          autoFocus
          value={currentValue}
          onChange={(e) => handleInput(e.target.value, step === 'enter' ? 'pin' : 'confirm')}
          style={{
            position: 'absolute',
            opacity: 0,
            pointerEvents: 'none',
            width: 1, height: 1,
          }}
        />

        <div
          onClick={() => inputRef.current?.focus()}
          style={{
            fontSize: 12.5, color: '#6B6B72',
            textAlign: 'center',
            cursor: 'pointer',
            padding: 10,
          }}
        >
          Натисніть тут якщо клавіатура не з'явилась
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

      {/* Bottom — skip option for initial flow */}
      {mode === 'initial' && step === 'enter' && (
        <div style={{ padding: '0 20px 28px', textAlign: 'center' }}>
          <button
            onClick={skipClicked}
            style={{
              background: 'transparent', border: 'none',
              color: '#6B6B72', fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
              padding: 10,
            }}
          >
            Пропустити — захищу пізніше
          </button>
        </div>
      )}
    </div>
  );
}
