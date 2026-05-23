import { useEffect, useState } from 'react';
import * as dms from '../lib/dms.js';
import * as contacts from '../lib/contacts.js';
import { formatPeerName } from '../lib/display.js';

function formatDate(unix) {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  return d.toLocaleDateString() + ' ' + d.toTimeString().slice(0, 5);
}

export default function DMSDetail({ dmsId, onNavigate }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function refresh() {
    try {
      const data = await dms.getOne(dmsId);
      setInfo(data);
      setError(null);
    } catch (e) {
      setError(e.message || 'Помилка завантаження');
    }
  }

  useEffect(() => { refresh(); }, [dmsId]);

  async function checkInClicked() {
    setBusy(true);
    setMessage(null);
    try {
      await dms.checkIn(dmsId);
      setMessage('Check-in зроблено. Таймер скинуто.');
      await refresh();
    } catch (e) {
      setError(e.message || 'Помилка');
    } finally {
      setBusy(false);
    }
  }

  async function cancelClicked() {
    if (!confirm('Скасувати цей заповіт? Дія незворотна — щоб мати його знову треба буде створювати новий.')) return;
    setBusy(true);
    try {
      await dms.cancel(dmsId);
      setMessage('Заповіт скасовано.');
      await refresh();
    } catch (e) {
      setError(e.message || 'Помилка');
    } finally {
      setBusy(false);
    }
  }

  if (!info) {
    return (
      <div className="screen">
        <div className="topbar">
          <div className="back" onClick={() => onNavigate('dms')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </div>
          <div className="title">Заповіт</div>
        </div>
        <div className="center-spinner">
          {error ? <div className="error-text">{error}</div> : <div className="spinner" />}
        </div>
      </div>
    );
  }

  const recipient = info.recipients?.[0];
  const recipientPubkey = recipient?.recipient_pubkey_hex;
  const contact = recipientPubkey ? contacts.getByPubkey(recipientPubkey) : null;
  const isArmed = info.status === 'armed';

  return (
    <div className="screen">
      <div className="topbar">
        <div className="back" onClick={() => onNavigate('dms')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        <div className="title">{info.label || 'Заповіт'}</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 32px' }}>
        {message && (
          <div style={{
            background: 'rgba(74, 222, 128, 0.08)',
            border: '1px solid rgba(74, 222, 128, 0.25)',
            color: 'var(--success)',
            padding: '10px 12px', borderRadius: 10,
            fontSize: 13, marginBottom: 16,
          }}>{message}</div>
        )}
        {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

        {/* Status hero */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, padding: 18, marginBottom: 20,
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: 11, color: dms.statusColor(info.status),
            textTransform: 'uppercase', letterSpacing: '0.08em',
            fontWeight: 700, marginBottom: 8,
          }}>
            {dms.statusLabel(info.status)}
          </div>
          {isArmed && (
            <>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {dms.formatRemainingTime(info.fires_at)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
                до спрацювання
              </div>
            </>
          )}
          {info.status === 'triggered' && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              Спрацював {formatDate(info.triggered_at)}
            </div>
          )}
          {info.status === 'cancelled' && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              Скасований {formatDate(info.cancelled_at)}
            </div>
          )}
        </div>

        {/* Details */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 14, marginBottom: 16,
        }}>
          <Row label="Отримувач" value={
            <>
              @{formatPeerName({ username: contact?.username, pubkey: recipientPubkey })}
              {recipient?.delivered_at && (
                <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 2 }}>
                  доставлено {formatDate(recipient.delivered_at)}
                </div>
              )}
            </>
          } />
          <Row label="Період неактивності" value={dms.formatTriggerLabel(info.trigger_seconds)} />
          <Row label="Останній check-in" value={formatDate(info.last_check_in_at)} />
          {isArmed && (
            <Row label="Спрацює" value={formatDate(info.fires_at)} />
          )}
          <Row label="Створено" value={formatDate(info.created_at)} last />
        </div>

        {isArmed && (
          <>
            <button
              className="btn btn-primary"
              onClick={checkInClicked}
              disabled={busy}
              style={{ marginBottom: 10 }}
            >
              Check-in — скинути таймер
            </button>
            <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginBottom: 16, lineHeight: 1.5 }}>
              Зазвичай не треба — таймер скидається автоматично при кожному заході в Morok.
            </p>

            <button
              className="btn btn-danger"
              onClick={cancelClicked}
              disabled={busy}
            >
              Скасувати заповіт
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, last }) {
  return (
    <div style={{
      paddingBottom: last ? 0 : 12,
      marginBottom: last ? 0 : 12,
      borderBottom: last ? 'none' : '1px solid rgba(46,46,56,0.4)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}
