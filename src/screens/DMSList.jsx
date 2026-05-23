import { useEffect, useState } from 'react';
import * as dms from '../lib/dms.js';
import * as contacts from '../lib/contacts.js';
import { formatPeerName } from '../lib/display.js';

export default function DMSList({ onNavigate }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  async function refresh() {
    try {
      const list = await dms.listAll();
      setItems(list);
      setError(null);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Помилка завантаження');
      setItems([]);
    }
  }

  useEffect(() => { refresh(); }, []);

  function renderRecipient(d) {
    const pk = d.recipients?.[0]?.recipient_pubkey_hex;
    if (!pk) return '—';
    const c = contacts.getByPubkey(pk);
    return formatPeerName({ username: c?.username, pubkey: pk });
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div className="back" onClick={() => onNavigate('settings')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        <div className="title">Цифровий заповіт</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 80px' }}>
        <p className="hint" style={{ marginBottom: 16 }}>
          Якщо ви не зайдете в Morok N днів — обране повідомлення автоматично
          доставиться отримувачу. Зашифровано end-to-end: сервер бачить тільки шифротекст.
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
            Поки немає жодного заповіту.
          </div>
        ) : (
          items.map((d) => (
            <div
              key={d.dms_id}
              onClick={() => onNavigate(`dms-detail/${d.dms_id}`)}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 12, padding: 14, marginBottom: 10, cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
                  {d.label || 'Без назви'}
                </div>
                <div style={{ fontSize: 11, color: dms.statusColor(d.status), fontWeight: 600 }}>
                  {dms.statusLabel(d.status)}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                Отримувач: @{renderRecipient(d)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
                Період: {dms.formatTriggerLabel(d.trigger_seconds)}
                {d.status === 'armed' && (
                  <> · Спрацює за {dms.formatRemainingTime(d.fires_at)}</>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <button
        onClick={() => onNavigate('dms-create')}
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
