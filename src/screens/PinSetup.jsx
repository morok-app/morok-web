import { useState, useEffect, useRef } from 'react';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { utf8, hexToBytes } from '../lib/crypto.js';
import { encryptWithSecret } from '../lib/vault.js';
import { t } from '../lib/i18n.js';

/**
 * PinSetup — Linear-style 6-digit PIN setup.
 *
 * Two modes determined by props:
 *   - INITIAL (from CreateAccount → App.jsx routes here with prefilledSeed):
 *     We don't have identity in store yet. Use prefilledSeed + prefilledPubkeyHex
 *     to encrypt the seed, save the locked identity, then call onDone(seed).
 *   - EXISTING (from Settings "Set PIN" — identity already in store unencrypted):
 *     Load identity from store, take its seed_hex, encrypt with PIN, save locked.
 *     Then call onDone (which routes back to settings).
 *
 * 2-step UX:
 *   1) Enter new PIN (6 digits, auto-advances when full)
 *   2) Confirm by entering again
 */
const isDesktop = typeof window !== 'undefined' && !('ontouchstart' in window);

export default function PinSetup({
  onNavigate,
  prefilledSeed,
  prefilledMnemonic,
  prefilledPubkeyHex,
  onDone,
}) {
  const [step, setStep] = useState('enter'); // enter | confirm
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // Existing-mode = no prefilled seed (Settings path)
  const isExistingMode = !prefilledSeed;

  useEffect(() => { inputRef.current?.focus(); }, [step]);

  function handleInput(value, target) {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    if (target === 'pin') setPin(digits);
    else setConfirm(digits);

    if (digits.length === 6 && target === 'pin') {
      setTimeout(() => setStep('confirm'), 150);
    }
  }

  function finalizeClicked() {
    if (pin !== confirm) {
      setError('PINs don\'t match');
      setConfirm('');
      return;
    }
    try {
      let seedBytes, pubkeyHex, mnemonic;

      if (isExistingMode) {
        // Pull from store
        const identity = store.loadIdentity();
        if (!identity || identity.encrypted) {
          setError('Can\'t find an identity in storage.');
          return;
        }
        seedBytes = hexToBytes(identity.seed_hex);
        pubkeyHex = identity.pubkey_hex;
        mnemonic = identity.mnemonic;
      } else {
        seedBytes = prefilledSeed;
        pubkeyHex = prefilledPubkeyHex;
        mnemonic = prefilledMnemonic;
      }

      const encryptedSeed = encryptWithSecret(seedBytes, pin);
      const encryptedMnemonic = mnemonic
        ? encryptWithSecret(utf8(mnemonic), pin)
        : null;

      store.saveIdentityLocked({
        blobB64: encryptedSeed,
        mnemonicBlobB64: encryptedMnemonic,
        pubkeyHex,
      });
      vault.markUnlocked(seedBytes);
      vault.clearLockout();

      onDone?.(seedBytes);
    } catch (e) {
      console.error(e);
      setError(e.message || t('Error'));
    }
  }

  function skipClicked() {
    // Initial-mode skip: just save identity unlocked + call onDone so App
    // proceeds to login as if PIN was set (the seed itself is what onDone
    // needs to start the session).
    if (isExistingMode) {
      onNavigate('settings');
      return;
    }
    try {
      const seedHex = Array.from(prefilledSeed).map((b) => b.toString(16).padStart(2, '0')).join('');
      store.saveIdentityUnlocked({
        seedHex,
        pubkeyHex: prefilledPubkeyHex,
        mnemonic: prefilledMnemonic,
      });
      vault.markUnlocked(prefilledSeed);
      onDone?.(prefilledSeed);
    } catch (e) {
      setError(e.message || t('Error'));
    }
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
            {step === 'enter' ? t('Create a PIN') : t('Repeat the PIN')}
          </div>
          <div style={{ fontSize: 13, color: '#A4A6B2', marginTop: 6 }}>
            {step === 'enter'
              ? t('6 digits to protect your account')
              : t('Enter the same PIN again')}
          </div>
        </div>
        {isExistingMode && (
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
        {/* Крапки = велика тап-зона. Прозорий інпут лежить ПОВЕРХ них,
            тож тап по крапках — це нативний тап по інпуту: мобільний
            браузер гарантовано відкриває клавіатуру (програмний focus()
            після переходу екранів він часто ігнорує). */}
        <div
          onClick={() => inputRef.current?.focus()}
          style={{ position: 'relative', padding: '14px 18px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{
                width: 14, height: 14, borderRadius: '50%',
                background: i < currentValue.length ? '#F5F5F7' : 'transparent',
                border: '1.5px solid ' + (i < currentValue.length ? '#F5F5F7' : '#70727E'),
                transition: 'all 0.12s',
              }} />
            ))}
          </div>
          <input
            ref={inputRef}
            type="tel"
            inputMode="numeric"
            autoFocus
            value={currentValue}
            onBlur={() => setTimeout(() => inputRef.current?.focus(), 50)}
            onChange={(e) => handleInput(e.target.value, step === 'enter' ? 'pin' : 'confirm')}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              opacity: 0.01,
              fontSize: 16,               /* iOS: <16px = зум сторінки при фокусі */
              background: 'transparent', color: 'transparent',
              caretColor: 'transparent', border: 'none', outline: 'none',
            }}
          />
        </div>

        <div
          onClick={() => inputRef.current?.focus()}
          style={isDesktop ? {
            fontSize: 12.5, color: '#A4A6B2', textAlign: 'center',
            cursor: 'pointer', padding: 10,
          } : {
            fontSize: 15.5, fontWeight: 700, color: '#F5F5F7',
            textAlign: 'center', cursor: 'pointer',
            padding: '14px 22px', borderRadius: 12,
            background: '#16161B', border: '1px solid #34343E',
          }}
        >
          {isDesktop
            ? t('⌨ Type 6 digits on the keyboard')
            : t("Tap here if the keyboard didn't appear")}
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
      {!isExistingMode && step === 'enter' && (
        <div style={{ padding: '0 20px 28px', textAlign: 'center' }}>
          <button
            onClick={skipClicked}
            style={{
              background: 'transparent', border: 'none',
              color: '#A4A6B2', fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
              padding: 10,
            }}
          >
            {t('Skip — I\'ll protect it later')}
          </button>
        </div>
      )}
    </div>
  );
}
