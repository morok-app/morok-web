import { useEffect, useState } from 'react';
import * as burner from '../lib/burner.js';

/**
 * Public landing page for a burner link.
 *
 * URL: #burner-send?t=<token>
 *
 * No auth required. The visitor doesn't need a Morok account.
 * Just an ephemeral keypair generated in their browser, used once.
 */
export default function BurnerSend({ routeArg }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [senderLabel, setSenderLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const token = (() => {
    if (!routeArg) return null;
    const m = String(routeArg).match(/^t=([A-Za-z0-9_-]{20,40})$/);
    return m ? m[1] : null;
  })();

  useEffect(() => {
    if (!token) {
      setError('Невалідний лінк');
      return;
    }
    (async () => {
      try {
        const i = await burner.fetchPublicInfo(token);
        setInfo(i);
      } catch (e) {
        if (e.status === 404) {
          setError('Лінк не дійсний — можливо, його анулювали або термін закінчився.');
        } else {
          setError(e.message || 'Помилка');
        }
      }
    })();
  }, [token]);

  async function sendClicked() {
    if (!text.trim() || !info || busy) return;
    setError(null);
    setBusy(true);
    try {
      await burner.sendAnonymousMessage({
        token,
        ownerPubkeyHex: info.owner_pubkey_hex,
        plaintext: text,
        senderLabel: senderLabel.trim() || null,
      });
      setSent(true);
    } catch (e) {
      console.error(e);
      const code = e.message || '';
      const friendly = code.includes('message_limit_reached')
        ? 'Цей лінк більше не приймає повідомлень.'
        : code.includes('too_many_send_attempts')
        ? 'Забагато спроб з вашої адреси. Спробуйте за хвилину.'
        : code.includes('invalid_or_expired')
        ? 'Лінк недійсний або вже закінчився.'
        : code || 'Помилка надсилання';
      setError(friendly);
      setBusy(false);
    }
  }

  // ── Loading state ──
  if (!info && !error) {
    return (
      <div className="screen" style={{
        background: '#0A0A0B',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 28, height: 28,
          border: '2px solid #232329',
          borderTopColor: '#7B96FF',
          borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Error state ──
  if (error && !info) {
    return (
      <div className="screen" style={{ background: '#0A0A0B' }}>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '40px 24px', textAlign: 'center', gap: 20,
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
          <div style={{
            fontSize: 20, fontWeight: 700,
            color: '#F5F5F7',
            letterSpacing: '-0.02em',
          }}>Лінк недоступний</div>
          <div style={{
            fontSize: 13, color: '#ABADB8',
            maxWidth: 320, lineHeight: 1.55,
          }}>{error}</div>
          <a
            href="/web/"
            style={{
              padding: '12px 22px',
              borderRadius: 12,
              background: '#16161B',
              border: '1px solid #232329',
              color: '#F5F5F7',
              fontSize: 13, fontWeight: 600,
              textDecoration: 'none',
              marginTop: 8,
            }}
          >
            Про Morok
          </a>
        </div>
      </div>
    );
  }

  // ── Sent confirmation ──
  if (sent) {
    return (
      <div className="screen" style={{
        background: '#0A0A0B',
        position: 'relative', overflow: 'hidden',
      }}>
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
          padding: '40px 24px', textAlign: 'center', gap: 20,
          position: 'relative', zIndex: 1,
        }}>
          <div style={{
            width: 84, height: 84, borderRadius: 24,
            background: 'rgba(74, 222, 128, 0.1)',
            border: '1px solid rgba(74, 222, 128, 0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#4ADE80',
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div style={{
            fontSize: 24, fontWeight: 800,
            color: '#F5F5F7',
            letterSpacing: '-0.025em',
          }}>
            Повідомлення надіслано
          </div>
          <div style={{
            fontSize: 13.5, color: '#ABADB8',
            maxWidth: 360, lineHeight: 1.55,
          }}>
            Воно зашифроване і доставиться адресату.
            Жодних слідів вашої особи у системі не залишилось.
          </div>
          <div style={{
            display: 'flex', gap: 10, marginTop: 12,
            flexWrap: 'wrap', justifyContent: 'center',
          }}>
            <button
              onClick={() => {
                setSent(false); setBusy(false);
                setText(''); setSenderLabel('');
              }}
              style={{
                padding: '12px 22px',
                borderRadius: 12,
                background: '#16161B',
                border: '1px solid #232329',
                color: '#F5F5F7',
                fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Написати ще
            </button>
            <a
              href="/web/"
              style={{
                padding: '12px 22px',
                borderRadius: 12,
                background: '#F5F5F7',
                color: '#0A0A0B',
                fontSize: 13, fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Створити свій Morok
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Send form ──
  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>
      {/* Custom top — no back button (this is a public landing) */}
      <div style={{
        padding: '20px 20px 18px',
        borderBottom: '1px solid #1E1E27',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'linear-gradient(135deg, #7B96FF 0%, #5A6FE0 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 18, color: 'white',
          letterSpacing: '-0.04em',
          flexShrink: 0,
          boxShadow: '0 4px 12px rgba(107, 138, 254, 0.3)',
        }}>M</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 700,
            color: '#F5F5F7',
            letterSpacing: '-0.01em',
          }}>
            Morok · Анонімна скринька
          </div>
          <div style={{
            fontSize: 12, color: '#A4A6B2', marginTop: 2,
            fontFamily: 'var(--mono, monospace)',
            letterSpacing: '0.02em',
          }}>
            🔒 шифрується у вашому браузері
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 32px' }}>
        <h2 style={{
          fontSize: 26, fontWeight: 800,
          color: '#F5F5F7',
          letterSpacing: '-0.025em',
          margin: '0 0 10px',
        }}>
          Напишіть анонімне<br/>повідомлення
        </h2>

        {info.label && (
          <div style={{
            fontSize: 13, color: '#ABADB8',
            marginBottom: 6,
          }}>
            отримувач: <strong style={{ color: '#F5F5F7' }}>{info.label}</strong>
          </div>
        )}
        <p style={{
          fontSize: 13, color: '#ABADB8',
          lineHeight: 1.55, margin: '0 0 24px',
        }}>
          Цей лінк створив користувач Morok щоб приймати анонімні повідомлення.
          Повідомлення зашифрується тут, у браузері — навіть сервер Morok не зможе його прочитати.
        </p>

        <div style={{
          fontSize: 12, color: '#9EA0AC',
          marginBottom: 8,
          fontFamily: 'var(--mono, monospace)',
          letterSpacing: '0.05em',
        }}>ЯК ПІДПИСАТИСЬ (ОПЦІЙНО)</div>
        <input
          type="text"
          placeholder="Залиште порожнім для повної анонімності"
          value={senderLabel}
          onChange={(e) => setSenderLabel(e.target.value.slice(0, 64))}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '13px 14px',
            background: '#13131A',
            border: '1px solid #232329',
            borderRadius: 12,
            color: '#F5F5F7',
            fontSize: 14, fontFamily: 'inherit',
            outline: 'none',
            marginBottom: 6,
          }}
          onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
          onBlur={(e) => e.target.style.borderColor = '#232329'}
        />
        <p style={{
          fontSize: 12, color: '#9EA0AC',
          margin: '6px 0 22px', lineHeight: 1.5,
        }}>
          Можна вказати ім'я, ник, email — що завгодно. Не перевіряється.
        </p>

        <div style={{
          fontSize: 12, color: '#9EA0AC',
          marginBottom: 8,
          fontFamily: 'var(--mono, monospace)',
          letterSpacing: '0.05em',
        }}>ПОВІДОМЛЕННЯ</div>
        <textarea
          placeholder="Ваше повідомлення..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={4096}
          style={{
            width: '100%', boxSizing: 'border-box',
            minHeight: 160,
            padding: '14px 16px',
            background: '#13131A',
            border: '1px solid #232329',
            borderRadius: 12,
            color: '#F5F5F7',
            fontSize: 14, fontFamily: 'inherit',
            lineHeight: 1.6,
            outline: 'none', resize: 'none',
            marginBottom: 6,
          }}
          onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
          onBlur={(e) => e.target.style.borderColor = '#232329'}
        />
        <p style={{
          fontSize: 12, color: '#9EA0AC',
          margin: '6px 0 18px', lineHeight: 1.5,
          fontFamily: 'var(--mono, monospace)',
        }}>
          {text.length} / 4096
        </p>

        {error && (
          <div style={{
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            color: '#FF6B7A',
            padding: '10px 14px', borderRadius: 10,
            fontSize: 13, marginBottom: 14,
          }}>{error}</div>
        )}

        <button
          onClick={sendClicked}
          disabled={!text.trim() || busy}
          style={{
            width: '100%',
            padding: '16px 22px',
            borderRadius: 14,
            background: (!text.trim() || busy) ? '#2A2A33' : '#F5F5F7',
            color: (!text.trim() || busy) ? '#5A5A65' : '#0A0A0B',
            border: 'none',
            fontSize: 15, fontWeight: 600,
            letterSpacing: '-0.005em',
            cursor: (!text.trim() || busy) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {busy ? 'Шифруємо й надсилаємо...' : 'Надіслати анонімно'}
        </button>

        <div style={{
          marginTop: 24,
          background: '#13131A',
          border: '1px solid #232329',
          borderRadius: 12,
          padding: '14px 16px',
          fontSize: 12, color: '#ABADB8',
          lineHeight: 1.55,
        }}>
          <strong style={{ color: '#F5F5F7' }}>🔒 Як це працює:</strong> ваш браузер створює одноразовий ключ,
          шифрує повідомлення спеціально для отримувача, відправляє шифротекст.
          Жодних cookies, жодних логів — після того як заберете цю сторінку,
          сліди ваших дій зникають.
        </div>
      </div>
    </div>
  );
}
