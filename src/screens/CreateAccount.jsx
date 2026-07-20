import { useState } from 'react';
import { generateIdentity } from '../lib/crypto.js';

/**
 * CreateAccount — Linear-style 2-step flow:
 *   1) Intro screen — explain what 24 words are, big "Generate" button
 *   2) Show 24 words in a 2-column grid with copy button, "I wrote them down" → next
 *
 * After confirmation we DON'T save identity ourselves — we hand the seed
 * back to App.jsx via onSeedReady(). App.jsx routes through PinSetup and
 * eventually calls login(). This keeps a single source of truth for the
 * sign-in/persist flow.
 */

export default function CreateAccount({ onNavigate, onSeedReady }) {
  const [step, setStep] = useState('intro'); // intro | show
  const [identity, setIdentity] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  function generateClicked() {
    const id = generateIdentity();
    setIdentity(id);
    setStep('show');
  }

  function copyClicked() {
    navigator.clipboard.writeText(identity.mnemonic).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function continueClicked() {
    // Hand the seed to App.jsx — it will route through PinSetup and login.
    onSeedReady({
      seed: identity.seed,
      pubkeyHex: identity.pubkeyHex,
      mnemonic: identity.mnemonic,
    });
  }

  return (
    <div className="screen" style={{ background: '#0A0A0B', position: 'relative' }}>

      {/* Header */}
      <Header
        title={
          step === 'intro' ? 'Створити акаунт' :
          'Ваш ключ відновлення'
        }
        subtitle={
          step === 'intro' ? 'Крок 1 з 2' :
          'Крок 2 з 2'
        }
        onClose={() => onNavigate('welcome')}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px' }}>
        {step === 'intro' && <IntroPanel onGenerate={generateClicked} />}
        {step === 'show' && identity && (
          <ShowWordsPanel
            mnemonic={identity.mnemonic}
            confirmed={confirmed}
            onConfirm={setConfirmed}
            onContinue={continueClicked}
            onCopy={copyClicked}
            copied={copied}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Sub-panels ─────────────────────────────────────────── */

function IntroPanel({ onGenerate }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      paddingTop: 20,
    }}>
      <div style={{
        background: '#13131A',
        border: '1px solid #232329',
        borderRadius: 14,
        padding: 18,
        marginBottom: 12,
        display: 'flex', gap: 14, alignItems: 'flex-start',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9,
          background: 'rgba(107, 138, 254, 0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#7B96FF', flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F5F5F7', marginBottom: 6 }}>
            24 секретні слова
          </div>
          <div style={{ fontSize: 12.5, color: '#ABADB8', lineHeight: 1.55 }}>
            Це єдиний спосіб відновити акаунт. Сервер не знає вашого паролю — тільки ви.
            Без слів — без доступу.
          </div>
        </div>
      </div>

      <div style={{
        background: '#13131A',
        border: '1px solid #232329',
        borderRadius: 14,
        padding: 18,
        marginBottom: 12,
        display: 'flex', gap: 14, alignItems: 'flex-start',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9,
          background: 'rgba(255, 169, 77, 0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#FFA94D', flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F5F5F7', marginBottom: 6 }}>
            Запишіть на папір
          </div>
          <div style={{ fontSize: 12.5, color: '#ABADB8', lineHeight: 1.55 }}>
            Не фотографуйте, не зберігайте в хмарі. Папір у безпечному місці —
            найнадійніший спосіб.
          </div>
        </div>
      </div>

      <div style={{
        background: '#13131A',
        border: '1px solid #232329',
        borderRadius: 14,
        padding: 18,
        marginBottom: 24,
        display: 'flex', gap: 14, alignItems: 'flex-start',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9,
          background: 'rgba(74, 222, 128, 0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#4ADE80', flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F5F5F7', marginBottom: 6 }}>
            Ніхто не побачить
          </div>
          <div style={{ fontSize: 12.5, color: '#ABADB8', lineHeight: 1.55 }}>
            Слова генеруються прямо у вашому браузері. Не передаються нікому — навіть нам.
          </div>
        </div>
      </div>

      <PrimaryButton onClick={onGenerate}>
        Згенерувати 24 слова
      </PrimaryButton>
    </div>
  );
}

function ShowWordsPanel({ mnemonic, confirmed, onConfirm, onContinue, onCopy, copied }) {
  const words = mnemonic.split(' ');

  return (
    <div>
      <div style={{
        fontSize: 13, color: '#ABADB8',
        lineHeight: 1.55, marginBottom: 20,
      }}>
        Запишіть ці слова у точному порядку. Без них відновити доступ неможливо.
      </div>

      {/* Words grid — 2 columns */}
      <div style={{
        background: '#13131A',
        border: '1px solid #232329',
        borderRadius: 14,
        padding: 16,
        marginBottom: 10,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
      }}>
        {words.map((w, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px',
            background: '#0A0A0B',
            border: '1px solid #1E1E27',
            borderRadius: 8,
          }}>
            <span style={{
              fontSize: 12.5, color: '#9EA0AC',
              fontFamily: 'var(--mono, monospace)',
              minWidth: 18,
            }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span style={{
              fontSize: 13.5, color: '#F5F5F7',
              fontFamily: 'var(--mono, monospace)',
              fontWeight: 500,
            }}>
              {w}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={onCopy}
        style={{
          width: '100%',
          padding: '11px 14px',
          borderRadius: 10,
          background: copied ? '#4ADE80' : '#16161B',
          border: '1px solid ' + (copied ? '#4ADE80' : '#232329'),
          color: copied ? '#0A0A0B' : '#F5F5F7',
          fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
          marginBottom: 16,
          transition: 'all 0.15s',
        }}
      >
        {copied ? '✓ Скопійовано в буфер' : 'Копіювати всі 24 слова'}
      </button>

      <div
        onClick={() => onConfirm(!confirmed)}
        style={{
          background: '#13131A',
          border: `1px solid ${confirmed ? '#4ADE80' : '#232329'}`,
          borderRadius: 12,
          padding: '14px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          cursor: 'pointer',
          marginBottom: 16,
        }}
      >
        <div style={{
          width: 20, height: 20, borderRadius: 6,
          border: `1.5px solid ${confirmed ? '#4ADE80' : '#3F3F45'}`,
          background: confirmed ? '#4ADE80' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {confirmed && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
        <div style={{ flex: 1, fontSize: 13, color: '#F5F5F7' }}>
          Я записав 24 слова у безпечному місці
        </div>
      </div>

      <PrimaryButton onClick={onContinue} disabled={!confirmed}>
        Продовжити
      </PrimaryButton>
    </div>
  );
}

/* ─── Shared header & buttons ─────────────────────────────── */

function Header({ title, subtitle, onClose }) {
  return (
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
          {title}
        </div>
        {subtitle && (
          <div style={{
            fontSize: 12.5, color: '#A4A6B2',
            marginTop: 6,
            fontFamily: 'var(--mono, monospace)',
            letterSpacing: '0.05em',
          }}>
            {subtitle.toUpperCase()}
          </div>
        )}
      </div>
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

function PrimaryButton({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '16px 22px',
        borderRadius: 14,
        background: disabled ? '#2A2A33' : '#F5F5F7',
        color: disabled ? '#5A5A65' : '#0A0A0B',
        border: 'none',
        fontSize: 15, fontWeight: 600,
        letterSpacing: '-0.005em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        transition: 'background 0.12s',
      }}
    >
      {children}
    </button>
  );
}
