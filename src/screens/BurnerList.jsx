import { useEffect, useState } from 'react';
import * as burner from '../lib/burner.js';

function buildShareUrl(token) {
  return `${window.location.origin}/web/#burner-send?t=${encodeURIComponent(token)}`;
}

export default function BurnerList({ onNavigate }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [copiedToken, setCopiedToken] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  async function refresh() {
    try {
      const list = await burner.listMyTokens();
      setItems(list);
      setError(null);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Помилка завантаження');
      setItems([]);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function copyShareLink(token) {
    const url = buildShareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {}
  }

  async function revoke(token) {
    if (!confirm('Анулювати цей лінк? Він перестане працювати негайно.')) return;
    try {
      await burner.revokeToken(token);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div className="back" onClick={() => onNavigate('settings')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        <div className="title">Анонімна скринька</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 80px' }}>
        <p className="hint" style={{ marginBottom: 16 }}>
          Створіть одноразовий лінк — хто завгодно зможе написати вам анонімне повідомлення без реєстрації.
          Зашифровано наскрізно: сервер бачить тільки шифротекст. Лінк працює до анулювання або закінчення терміну.
        </p>

        {error && (
          <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>
        )}

        {items === null ? (
          <div className="center-spinner">
            <div className="spinner" />
          </div>
        ) : items.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '32px 20px',
            color: 'var(--text-dim)', fontSize: 13,
          }}>
            Поки немає жодного лінка.
          </div>
        ) : (
          items.map((t) => {
            const url = buildShareUrl(t.token);
            return (
              <div
                key={t.token}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: 14, marginBottom: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
                    {t.label || 'Без назви'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    {burner.formatRemainingTime(t.expires_at)}
                  </div>
                </div>

                <div style={{
                  fontFamily: 'var(--mono)', fontSize: 11,
                  color: 'var(--text-dim)',
                  background: 'var(--bg)',
                  border: '1px solid var(--border-soft, var(--border))',
                  borderRadius: 8,
                  padding: '8px 10px',
                  marginTop: 10,
                  wordBreak: 'break-all',
                }}>
                  {url}
                </div>

                <div style={{
                  display: 'flex', gap: 8, marginTop: 10,
                  fontSize: 12, color: 'var(--text-faint)',
                  alignItems: 'center',
                }}>
                  <span>Повідомлень: {t.message_count}</span>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1, height: 40, fontSize: 13 }}
                    onClick={() => copyShareLink(t.token)}
                  >
                    {copiedToken === t.token ? '✓ Скопійовано' : 'Копіювати лінк'}
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ flex: 1, height: 40, fontSize: 13 }}
                    onClick={() => revoke(t.token)}
                  >
                    Анулювати
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showCreate && (
        <CreateBurnerModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}

      <button
        onClick={() => setShowCreate(true)}
        style={{
          position: 'absolute', bottom: 24, right: 16,
          width: 56, height: 56, borderRadius: '50%',
          background: 'var(--accent)', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 24px rgba(107, 138, 254, 0.4)',
          cursor: 'pointer', zIndex: 10,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}

function CreateBurnerModal({ onClose, onCreated }) {
  const [label, setLabel] = useState('');
  const [ttl, setTtl] = useState(24 * 3600);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function createClicked() {
    setBusy(true);
    setError(null);
    try {
      await burner.createToken({ ttlSeconds: ttl, label });
      onCreated();
    } catch (e) {
      console.error(e);
      const friendly = (e.message || '').includes('too_many_active_burner_links')
        ? 'Досягнуто ліміту 10 активних лінків. Видаліть якийсь старий.'
        : (e.message || 'Помилка');
      setError(friendly);
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.5)', zIndex: 80,
        display: 'flex', alignItems: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', background: 'var(--surface)',
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          padding: '12px 20px 28px',
        }}
      >
        <div style={{ width: 32, height: 4, background: 'var(--text-faint)', borderRadius: 2, margin: '6px auto 18px', opacity: 0.4 }} />

        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 18, letterSpacing: '-0.01em' }}>
          Створити лінк
        </h3>

        <div style={{
          fontSize: 11, color: 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          marginBottom: 8,
        }}>Назва (опційно)</div>
        <input
          className="input"
          type="text"
          placeholder="Наприклад: 'Donate-page' або 'Whisper'"
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 64))}
          style={{ marginBottom: 16 }}
        />

        <div style={{
          fontSize: 11, color: 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          marginBottom: 8,
        }}>Скільки працює</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {burner.TTL_OPTIONS.map((opt) => (
            <div
              key={opt.seconds}
              onClick={() => setTtl(opt.seconds)}
              style={{
                background: ttl === opt.seconds ? 'rgba(107, 138, 254, 0.1)' : 'var(--bg)',
                border: `1px solid ${ttl === opt.seconds ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10, padding: '10px 12px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{opt.hint}</div>
              </div>
              {ttl === opt.seconds && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          ))}
        </div>

        {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

        <button
          className="btn btn-primary"
          onClick={createClicked}
          disabled={busy}
        >
          {busy ? 'Створюємо...' : 'Створити лінк'}
        </button>
      </div>
    </div>
  );
}
