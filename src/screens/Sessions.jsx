import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';

/**
 * Sessions — login audit log screen.
 *
 * Shows up to 30 most-recent successful authentications for the
 * current user: when they happened, a hashed IP fingerprint that's
 * stable within a UTC day but can't be reversed to a raw address,
 * and the user-agent string.
 *
 * Has a "Clear history" button that wipes the entire log via DELETE
 * /api/v1/me/sessions. Wrapped in a 2-step confirmation (one click
 * arms, second click clears) to prevent accidental wipes.
 */
export default function Sessions({ onNavigate }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const resp = await api.getLoginHistory();
      setItems(resp?.sessions || []);
    } catch (e) {
      setError(e.message || 'Не вдалось отримати історію');
      setItems([]);
    }
  }

  useEffect(() => { load(); }, []);

  // Auto-disarm "confirm clear" after 5s without action.
  useEffect(() => {
    if (!confirmClear) return undefined;
    const t = setTimeout(() => setConfirmClear(false), 5000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  async function clearClicked() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setBusy(true);
    try {
      await api.clearLoginHistory();
      setItems([]);
      setConfirmClear(false);
    } catch (e) {
      setError(e.message || 'Не вдалось стерти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      <div style={{
        padding: '20px 20px 24px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#F5F5F7', lineHeight: 1.1,
          }}>
            Історія входів
          </div>
          <div style={{ fontSize: 12.5, color: '#6B6B72', marginTop: 6 }}>
            Останні 30 успішних авторизацій
          </div>
        </div>
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
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px' }}>

        <div style={{
          background: 'rgba(123, 150, 255, 0.05)',
          border: '1px solid rgba(123, 150, 255, 0.18)',
          borderRadius: 12,
          padding: '12px 14px',
          fontSize: 12, color: '#A8A8B0',
          lineHeight: 1.55,
          marginBottom: 20,
        }}>
          IP-адресу ми не зберігаємо. Замість неї рядок-фінгерпринт, який
          змінюється щодоби, тож пов'язати з конкретною адресою через
          день неможливо. Якщо помітили незнайомий запис — змініть PIN
          або повністю видаліть акаунт.
        </div>

        {error && (
          <div style={{
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            color: '#FF6B7A',
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 13, marginBottom: 14,
          }}>
            {error}
          </div>
        )}

        {items === null && (
          <div style={{ color: '#5A5A65', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Завантаження…
          </div>
        )}

        {items !== null && items.length === 0 && (
          <div style={{
            padding: 24, textAlign: 'center',
            color: '#6B6B72', fontSize: 13,
          }}>
            Історія порожня
          </div>
        )}

        {items !== null && items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it, i) => (
              <SessionRow key={`${it.created_at}-${i}`} item={it} isFirst={i === 0} />
            ))}
          </div>
        )}

        {items !== null && items.length > 0 && (
          <button
            onClick={clearClicked}
            disabled={busy}
            style={{
              width: '100%',
              marginTop: 28,
              padding: '14px 18px',
              borderRadius: 12,
              background: confirmClear ? '#FF4A5C' : '#13131A',
              border: `1px solid ${confirmClear ? '#FF4A5C' : '#232329'}`,
              color: confirmClear ? '#FFFFFF' : '#FF6B7A',
              fontSize: 13.5, fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              transition: 'background 0.15s',
            }}
          >
            {busy ? 'Стираю…'
              : confirmClear ? '🔥 Натисніть ще раз — стерти'
              : 'Стерти всю історію'}
          </button>
        )}
      </div>
    </div>
  );
}

function SessionRow({ item, isFirst }) {
  const date = new Date(item.created_at * 1000);
  const dateStr = date.toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const fp = (item.ip_hash || '').slice(0, 8);
  const ua = item.user_agent || '—';

  return (
    <div style={{
      background: '#13131A',
      border: '1px solid #232329',
      borderRadius: 10,
      padding: '11px 13px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 6,
      }}>
        <div style={{
          fontSize: 13, color: '#F5F5F7', fontWeight: 500,
        }}>
          {dateStr}
        </div>
        {isFirst && (
          <span style={{
            fontSize: 10, color: '#4ADE80',
            background: 'rgba(74, 222, 128, 0.1)',
            padding: '2px 6px', borderRadius: 4,
            fontFamily: 'var(--mono, monospace)',
            letterSpacing: '0.05em',
          }}>
            ОСТАННІЙ
          </span>
        )}
      </div>
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center',
        fontSize: 11, color: '#6B6B72',
        fontFamily: 'var(--mono, monospace)',
      }}>
        <span title="Фінгерпринт IP (за сьогодні)">fp:{fp}</span>
      </div>
      <div style={{
        fontSize: 11, color: '#5A5A65',
        marginTop: 4,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }} title={ua}>
        {ua}
      </div>
    </div>
  );
}
