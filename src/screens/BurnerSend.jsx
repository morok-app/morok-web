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
      <div className="screen">
        <div className="center-spinner">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error && !info) {
    return (
      <div className="screen">
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '40px 24px', textAlign: 'center', gap: 20,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(255, 107, 122, 0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--danger)', fontSize: 28,
          }}>⚠</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Лінк недоступний</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', maxWidth: 320, lineHeight: 1.5 }}>
            {error}
          </div>
          <a
            href="/web/"
            className="btn btn-secondary"
            style={{ maxWidth: 260, marginTop: 12, textDecoration: 'none' }}
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
      <div className="screen">
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '40px 24px', textAlign: 'center', gap: 20,
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'rgba(74, 222, 128, 0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--success)',
          }}>
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Повідомлення надіслано
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--text-dim)', maxWidth: 360, lineHeight: 1.55 }}>
            Воно зашифроване і доставиться адресату.
            Жодних слідів вашої особи у системі не залишилось.
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              className="btn btn-secondary"
              style={{ maxWidth: 200 }}
              onClick={() => {
                setSent(false); setBusy(false);
                setText(''); setSenderLabel('');
              }}
            >
              Написати ще
            </button>
            <a
              href="/web/"
              className="btn btn-primary"
              style={{ maxWidth: 200, textDecoration: 'none' }}
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
    <div className="screen">
      {/* Custom top — no back button (this is a public landing) */}
      <div style={{
        padding: '20px 20px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 18, color: 'white',
          flexShrink: 0,
        }}>M</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Morok · Анонімна скринька
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            повідомлення шифрується у вашому браузері
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 32px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>
          Напишіть анонімне повідомлення
        </h2>
        {info.label && (
          <div style={{
            fontSize: 13, color: 'var(--text-dim)',
            marginBottom: 4,
          }}>
            <span style={{ color: 'var(--text-faint)' }}>отримувач:</span> <strong style={{ color: 'var(--text)' }}>{info.label}</strong>
          </div>
        )}
        <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: 22 }}>
          Цей лінк створив користувач Morok щоб приймати анонімні повідомлення.
          Ваше повідомлення зашифрується тут, у браузері — навіть сервер Morok не зможе його прочитати.
        </p>

        <div style={{
          fontSize: 11, color: 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          marginBottom: 8,
        }}>Як підписатись (опційно)</div>
        <input
          className="input"
          type="text"
          placeholder="Залиште порожнім для повної анонімності"
          value={senderLabel}
          onChange={(e) => setSenderLabel(e.target.value.slice(0, 64))}
          style={{ marginBottom: 4 }}
        />
        <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 18, marginTop: 6, lineHeight: 1.5 }}>
          Можна вказати ім'я, ник, email — що завгодно. Не перевіряється.
        </p>

        <div style={{
          fontSize: 11, color: 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          marginBottom: 8,
        }}>Повідомлення</div>
        <textarea
          className="textarea"
          placeholder="Ваше повідомлення..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ minHeight: 160, marginBottom: 6 }}
          maxLength={4096}
        />
        <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 18, lineHeight: 1.5 }}>
          {text.length} / 4096 символів
        </p>

        {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

        <button
          className="btn btn-primary"
          onClick={sendClicked}
          disabled={!text.trim() || busy}
        >
          {busy ? 'Шифруємо й надсилаємо...' : 'Надіслати анонімно'}
        </button>

        <div style={{
          marginTop: 24,
          background: 'rgba(107, 138, 254, 0.06)',
          border: '1px solid rgba(107, 138, 254, 0.2)',
          borderRadius: 12,
          padding: '12px 14px',
          fontSize: 12, color: 'var(--text-dim)',
          lineHeight: 1.55,
        }}>
          🔒 <strong>Як це працює:</strong> ваш браузер створює одноразовий ключ,
          шифрує повідомлення спеціально для отримувача, відправляє шифротекст.
          Жодних cookies, жодних логів — після того як заберете цю сторінку,
          сліди ваших дій зникають.
        </div>
      </div>
    </div>
  );
}
