import { useState, useEffect, useRef } from 'react';
import { hexToBytes, bytesToHex } from '../lib/crypto.js';
import { lockSeedWithPin, encryptWithSecret } from '../lib/vault.js';
import { utf8 } from '../lib/crypto.js';
import * as store from '../lib/storage.js';

/**
 * Set up a new 6-digit PIN.
 *
 * Two steps:
 *   1. Enter PIN
 *   2. Confirm PIN (must match)
 *
 * On success: encrypt the seed and mnemonic with the PIN, save the locked
 * identity, and navigate to chats.
 *
 * Source of the seed:
 *   - From storage if identity is currently unlocked (existing user adding PIN)
 *   - From `prefilledSeed` prop if we're in the create-account flow (passed
 *     down via App from CreateAccount before saving)
 */
export default function PinSetup({ onNavigate, onDone, prefilledSeed, prefilledMnemonic, prefilledPubkeyHex }) {
  const [step, setStep] = useState(1);  // 1 = enter, 2 = confirm
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const input1Ref = useRef(null);
  const input2Ref = useRef(null);

  useEffect(() => {
    if (step === 1) input1Ref.current?.focus();
    else input2Ref.current?.focus();
  }, [step]);

  function onDigit(d, isConfirm) {
    if (busy) return;
    const setVal = isConfirm ? setPin2 : setPin1;
    const cur = isConfirm ? pin2 : pin1;
    if (cur.length >= 6) return;
    setVal(cur + d);
    setError(null);
  }

  function onBack(isConfirm) {
    const setVal = isConfirm ? setPin2 : setPin1;
    const cur = isConfirm ? pin2 : pin1;
    setVal(cur.slice(0, -1));
    setError(null);
  }

  // Advance when 6 digits entered
  useEffect(() => {
    if (step === 1 && pin1.length === 6) {
      setStep(2);
    }
  }, [pin1, step]);

  useEffect(() => {
    if (step === 2 && pin2.length === 6) {
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin2, step]);

  async function finish() {
    if (pin1 !== pin2) {
      setError('PIN не співпадає. Спробуйте ще раз.');
      setPin1('');
      setPin2('');
      setStep(1);
      return;
    }
    setBusy(true);

    try {
      // Source seed
      let seedBytes, mnemonic, pubkeyHex;
      if (prefilledSeed) {
        seedBytes = prefilledSeed;
        mnemonic = prefilledMnemonic;
        pubkeyHex = prefilledPubkeyHex;
      } else {
        const id = store.loadIdentity();
        if (!id || id.encrypted) {
          setError('Не вдалось знайти seed');
          setBusy(false);
          return;
        }
        seedBytes = hexToBytes(id.seed_hex);
        mnemonic = id.mnemonic;
        pubkeyHex = id.pubkey_hex;
      }

      const seedBlob = lockSeedWithPin(seedBytes, pin1);
      const mnemonicBlob = encryptWithSecret(utf8(mnemonic), pin1);
      store.saveIdentityLocked({
        blobB64: seedBlob,
        mnemonicBlobB64: mnemonicBlob,
        pubkeyHex,
      });

      onDone?.(seedBytes);  // hand back to caller
    } catch (e) {
      console.error('PIN setup failed:', e);
      setError(e.message || 'Помилка');
      setBusy(false);
    }
  }

  const currentPin = step === 1 ? pin1 : pin2;
  const title = step === 1 ? 'Створіть PIN-код' : 'Підтвердіть PIN-код';
  const hint = step === 1
    ? 'Цей PIN захищає ваш акаунт на цьому пристрої. Питатиметься раз на годину.'
    : 'Введіть той же PIN ще раз для підтвердження.';

  return (
    <div className="onb">
      {step === 1 && (
        <div className="onb-header">
          <div className="back" onClick={() => onNavigate('welcome')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </div>
        </div>
      )}

      <div className="onb-content" style={{ alignItems: 'center' }}>
        <h1 style={{ textAlign: 'center' }}>{title}</h1>
        <p className="hint" style={{ textAlign: 'center' }}>{hint}</p>

        {/* PIN dots */}
        <div style={{
          display: 'flex', gap: 14, marginTop: 24,
          justifyContent: 'center',
        }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                width: 16, height: 16, borderRadius: '50%',
                background: i < currentPin.length ? 'var(--accent)' : 'transparent',
                border: '1.5px solid var(--border)',
              }}
            />
          ))}
        </div>

        {error && <div className="error-text" style={{ textAlign: 'center', marginTop: 8 }}>{error}</div>}

        {/* Hidden input for keyboard entry (mobile + desktop) */}
        <input
          ref={step === 1 ? input1Ref : input2Ref}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          maxLength={6}
          value={currentPin}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
            if (step === 1) setPin1(v); else setPin2(v);
          }}
          style={{
            position: 'absolute', opacity: 0, pointerEvents: 'none',
            width: 1, height: 1,
          }}
        />

        {/* On-screen keypad */}
        <div style={{
          marginTop: 32, display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
          width: '100%', maxWidth: 280, alignSelf: 'center',
        }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <button
              key={d}
              className="btn btn-secondary"
              style={{ height: 56, fontSize: 22, fontWeight: 500 }}
              onClick={() => onDigit(String(d), step === 2)}
            >{d}</button>
          ))}
          <div />
          <button
            className="btn btn-secondary"
            style={{ height: 56, fontSize: 22, fontWeight: 500 }}
            onClick={() => onDigit('0', step === 2)}
          >0</button>
          <button
            className="btn btn-ghost"
            style={{ height: 56, fontSize: 18 }}
            onClick={() => onBack(step === 2)}
          >⌫</button>
        </div>
      </div>
    </div>
  );
}
