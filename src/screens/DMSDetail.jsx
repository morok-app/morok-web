import { useEffect, useState } from 'react';
import * as dms from '../lib/dms.js';
import * as contacts from '../lib/contacts.js';
import { formatPeerName } from '../lib/display.js';
import { t } from '../lib/i18n.js';

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
      setError(e.message || t('Loading failed'));
    }
  }

  useEffect(() => { refresh(); }, [dmsId]);

  async function checkInClicked() {
    setBusy(true);
    setMessage(null);
    try {
      await dms.checkIn(dmsId);
      setMessage(t('Checked in. Timer reset.'));
      await refresh();
    } catch (e) {
      setError(e.message || t('Error'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelClicked() {
    if (!confirm('Cancel this last message? This can\'t be undone — you\'ll have to create a new one.')) return;
    setBusy(true);
    try {
      await dms.cancel(dmsId);
      setMessage(t('Last message cancelled.'));
      await refresh();
    } catch (e) {
      setError(e.message || t('Error'));
    } finally {
      setBusy(false);
    }
  }

  if (!info) {
    return (
      <div className="screen" style={{ background: '#0A0A0B' }}>
        <Header title={t("Last message")} onClose={() => onNavigate('dms')} />
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {error ? (
            <div style={{
              background: 'rgba(255, 107, 122, 0.08)',
              border: '1px solid rgba(255, 107, 122, 0.25)',
              color: '#FF6B7A',
              padding: '10px 14px', borderRadius: 10,
              fontSize: 13, margin: '0 20px',
            }}>{error}</div>
          ) : (
            <div style={{
              width: 24, height: 24,
              border: '2px solid #232329',
              borderTopColor: '#7B96FF',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
          )}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const recipient = info.recipients?.[0];
  const recipientPubkey = recipient?.recipient_pubkey_hex;
  const contact = recipientPubkey ? contacts.getByPubkey(recipientPubkey) : null;
  const isArmed = info.status === 'armed';

  const statusColor =
    info.status === 'armed' ? '#4ADE80' :
    info.status === 'triggered' ? '#FF6B7A' :
    '#6B6B72';
  const statusBg =
    info.status === 'armed' ? 'rgba(74, 222, 128, 0.1)' :
    info.status === 'triggered' ? 'rgba(255, 107, 122, 0.1)' :
    'rgba(143, 143, 153, 0.08)';

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      <Header title={info.label || t('Last message')} onClose={() => onNavigate('dms')} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px' }}>

        {/* Status banner */}
        {message && (
          <div style={{
            background: 'rgba(74, 222, 128, 0.08)',
            border: '1px solid rgba(74, 222, 128, 0.25)',
            color: '#4ADE80',
            padding: '10px 14px', borderRadius: 10,
            fontSize: 13, marginBottom: 16,
          }}>{message}</div>
        )}
        {error && (
          <div style={{
            background: 'rgba(255, 107, 122, 0.08)',
            border: '1px solid rgba(255, 107, 122, 0.25)',
            color: '#FF6B7A',
            padding: '10px 14px', borderRadius: 10,
            fontSize: 13, marginBottom: 16,
          }}>{error}</div>
        )}

        {/* Status hero */}
        <div style={{
          background: '#13131A',
          border: '1px solid #232329',
          borderRadius: 14,
          padding: 20,
          marginBottom: 14,
          textAlign: 'center',
        }}>
          <div style={{
            display: 'inline-block',
            fontSize: 12.5, fontWeight: 700,
            color: statusColor, background: statusBg,
            padding: '4px 10px', borderRadius: 6,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 14,
          }}>
            {dms.statusLabel(info.status)}
          </div>
          {isArmed && (
            <>
              <div style={{
                fontSize: 32, fontWeight: 700,
                color: '#F5F5F7',
                letterSpacing: '-0.02em', lineHeight: 1,
                fontFamily: 'var(--mono, monospace)',
              }}>
                {dms.formatRemainingTime(info.fires_at)}
              </div>
              <div style={{ fontSize: 12, color: '#A4A6B2', marginTop: 8 }}>
                {t('until it triggers')}
              </div>
            </>
          )}
          {info.status === 'triggered' && (
            <div style={{ fontSize: 13, color: '#ABADB8' }}>
              Triggered {formatDate(info.triggered_at)}
            </div>
          )}
          {info.status === 'cancelled' && (
            <div style={{ fontSize: 13, color: '#ABADB8' }}>
              Cancelled {formatDate(info.cancelled_at)}
            </div>
          )}
        </div>

        {/* Details */}
        <SectionLabel>{t('Details')}</SectionLabel>
        <div style={{
          background: '#13131A',
          border: '1px solid #232329',
          borderRadius: 14,
        }}>
          <Row label={t("Recipient")} value={
            <>
              <span style={{ fontFamily: 'var(--mono, monospace)' }}>
                @{formatPeerName({ username: contact?.username, pubkey: recipientPubkey })}
              </span>
              {recipient?.delivered_at && (
                <div style={{ fontSize: 12, color: '#4ADE80', marginTop: 4 }}>
                  ✓ delivered {formatDate(recipient.delivered_at)}
                </div>
              )}
            </>
          } />
          <Row label={t("Period")} value={dms.formatTriggerLabel(info.trigger_seconds)} />
          <Row label={t("Last check-in")} value={formatDate(info.last_check_in_at)} />
          {isArmed && (
            <Row label={t("Triggers")} value={formatDate(info.fires_at)} />
          )}
          <Row label={t("Created")} value={formatDate(info.created_at)} last />
        </div>

        {/* Actions */}
        {isArmed && (
          <>
            <div style={{ height: 20 }} />
            <button
              onClick={checkInClicked}
              disabled={busy}
              style={{
                width: '100%',
                padding: '14px 22px',
                borderRadius: 14,
                background: busy ? '#2A2A33' : '#F5F5F7',
                color: busy ? '#5A5A65' : '#0A0A0B',
                border: 'none',
                fontSize: 14.5, fontWeight: 600,
                letterSpacing: '-0.005em',
                cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                marginBottom: 8,
              }}
            >
              {busy ? '...' : t('Check in · reset the timer')}
            </button>
            <p style={{
              fontSize: 12.5, color: '#9EA0AC',
              marginBottom: 16, lineHeight: 1.5, textAlign: 'center',
            }}>
              {t('Usually unnecessary — the timer resets automatically every time you sign in.')}
            </p>

            <button
              onClick={cancelClicked}
              disabled={busy}
              style={{
                width: '100%',
                padding: '14px 22px',
                borderRadius: 14,
                background: 'transparent',
                color: '#FF6B7A',
                border: '1px solid rgba(255, 107, 122, 0.3)',
                fontSize: 14.5, fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('Cancel the last message')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Header({ title, onClose }) {
  return (
    <div style={{
      padding: '20px 20px 24px',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
          color: '#F5F5F7', lineHeight: 1.1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {title}
        </div>
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

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 12, color: '#8B8D99',
      textTransform: 'uppercase', letterSpacing: '0.1em',
      fontWeight: 600,
      padding: '4px 0 10px',
    }}>
      {children}
    </div>
  );
}

function Row({ label, value, last }) {
  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: last ? 'none' : '1px solid #1E1E27',
    }}>
      <div style={{
        fontSize: 12.5, color: '#9EA0AC',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        marginBottom: 4,
        fontFamily: 'var(--mono, monospace)',
      }}>{label}</div>
      <div style={{ fontSize: 13.5, color: '#F5F5F7', lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}
