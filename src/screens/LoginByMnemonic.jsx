import { useState } from 'react';
import { identityFromMnemonic } from '../lib/crypto.js';

/**
 * LoginByMnemonic — Linear-style.
 *
 * Single big textarea for 24 words. Validates on submit, then hands the
 * seed back to App.jsx via onSeedReady (which routes through PinSetup
 * and ultimately calls login()).
 */
export default function LoginByMnemonic({ onNavigate, onSeedReady }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  async function submitClicked() {
    if (wordCount !== 24) {
      setError(`Потрібно рівно 24 слова, зараз ${wordCount}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = identityFromMnemonic(text);
      onSeedReady({
        seed: id.seed,
        pubkeyHex: id.pubkeyHex,
        mnemonic: id.mnemonic,
      });
    } catch (e) {
      setError(e.message || 'Не вдалось розпізнати фразу');
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      {/* Header */}
      <div style={{
        padding: '20px 20px 24px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#F5F5F7', lineHeight: 1.1,
          }}>
            Увійти в акаунт
          </div>
          <div style={{ fontSize: 13, color: '#A4A6B2', marginTop: 6 }}>
            Введіть свої 24 слова
          </div>
        </div>
        <button
          onClick={() => onNavigate('welcome')}
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px' }}>

        <div style={{
          fontSize: 12, color: '#9EA0AC',
          marginBottom: 8,
          fontFamily: 'var(--mono, monospace)',
          letterSpacing: '0.05em',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>24 СЛОВА</span>
          <span style={{
            color: wordCount === 24 ? '#4ADE80' : (wordCount > 24 ? '#FF6B7A' : '#5A5A65'),
          }}>
            {wordCount} / 24
          </span>
        </div>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          placeholder="word1 word2 word3 ..."
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          style={{
            width: '100%', boxSizing: 'border-box',
            minHeight: 140,
            padding: '14px 16px',
            background: '#13131A',
            border: '1px solid #232329',
            borderRadius: 12,
            color: '#F5F5F7',
            fontSize: 14,
            fontFamily: 'var(--mono, monospace)',
            lineHeight: 1.6,
            outline: 'none', resize: 'none',
            letterSpacing: '0.01em',
          }}
          onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
          onBlur={(e) => e.target.style.borderColor = '#232329'}
        />

        <p style={{ fontSize: 12.5, color: '#9EA0AC', marginTop: 10, lineHeight: 1.5 }}>
          Вставте всі 24 слова через пробіл. Регістр не має значення.
        </p>

        {error && (
          <div style={{
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            color: '#FF6B7A',
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 13, marginTop: 14,
          }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          <button
            onClick={submitClicked}
            disabled={busy || wordCount !== 24}
            style={{
              width: '100%',
              padding: '16px 22px',
              borderRadius: 14,
              background: (busy || wordCount !== 24) ? '#2A2A33' : '#F5F5F7',
              color: (busy || wordCount !== 24) ? '#5A5A65' : '#0A0A0B',
              border: 'none',
              fontSize: 15, fontWeight: 600,
              letterSpacing: '-0.005em',
              cursor: (busy || wordCount !== 24) ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {busy ? 'Перевіряємо...' : 'Увійти'}
          </button>
        </div>

        {/* Посилання на серверний бекап прибрано — його не існує.
            Без 24 слів акаунт відновити неможливо, і це чесна відповідь. */}
      </div>
    </div>
  );
}
