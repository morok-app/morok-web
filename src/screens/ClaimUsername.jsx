import { useState } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import { validateUsername, minLengthForTier } from '../lib/username.js';
import { t } from '../lib/i18n.js';

/**
 * ClaimUsername — Linear-style, optional step.
 *
 * Pricing hint: 3-char = 1000 LAC, 7+ chars = 10 LAC (in future).
 * For now everyone is free.
 */
export default function ClaimUsername({ onNavigate }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Правила беремо з спільного модуля — дзеркала серверних. Раніше тут
  // стояв /^[a-z0-9_]{3,20}$/, який пропускав імена, що сервер відхиляє
  // (free-tier потребує 5+ символів і початку з літери), тож людина
  // бачила «підходить» і одразу ловила 400.
  const tier = store.loadProfile()?.tier || 'free';
  const check = validateUsername(username, tier);
  const valid = check.ok;
  const hint = username.trim() && !valid ? check.error : null;

  async function claimClicked() {
    if (!valid) return;
    setError(null);
    setBusy(true);
    try {
      const result = await api.claimUsername(check.normalized);
      const profile = store.loadProfile() || {};
      store.saveProfile({ ...profile, username: result.username });
      onNavigate('chats');
    } catch (e) {
      const code = e.message || '';
      const friendly =
        code.includes('username_taken') ? t('Username already taken') :
        code.includes('reserved') ? t('This username is reserved by the system') :
        code.includes('invalid') ? t('Invalid format') :
        code || t('Error');
      setError(friendly);
      setBusy(false);
    }
  }

  function skipClicked() {
    onNavigate('chats');
  }

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      {/* Header */}
      <div style={{ padding: '20px 20px 24px' }}>
        <div style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
          color: '#F5F5F7', lineHeight: 1.1,
        }}>
          {t('Pick a username')}
        </div>
        <div style={{ fontSize: 13, color: '#A4A6B2', marginTop: 6 }}>
          {t('So people can find you by name')}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px' }}>

        {/* Info card */}
        <div style={{
          background: '#13131A',
          border: '1px solid #232329',
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 24,
          fontSize: 12.5, color: '#ABADB8',
          lineHeight: 1.55,
        }}>
          {t('The username is optional. Skip it and you get an anonymous account, reachable only via link or QR.')}
        </div>

        <div style={{
          fontSize: 12, color: '#9EA0AC',
          marginBottom: 8,
          fontFamily: 'var(--mono, monospace)',
          letterSpacing: '0.05em',
        }}>
          {t('USERNAME')}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center',
          background: '#13131A',
          border: '1px solid ' + (error ? '#FF6B7A' : '#232329'),
          borderRadius: 12,
          paddingLeft: 14,
          transition: 'border-color 0.15s',
        }}>
          <span style={{ color: '#9EA0AC', fontSize: 16, marginRight: 4 }}>@</span>
          <input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20));
              setError(null);
            }}
            placeholder={t("your_name")}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            style={{
              flex: 1, boxSizing: 'border-box',
              padding: '14px 14px 14px 0',
              background: 'transparent',
              border: 'none',
              color: '#F5F5F7',
              fontSize: 15, fontFamily: 'var(--mono, monospace)',
              outline: 'none',
            }}
          />
          {username && (
            <div style={{
              padding: '6px 12px',
              fontSize: 12,
              color: valid ? '#4ADE80' : '#FF6B7A',
              fontFamily: 'var(--mono, monospace)',
            }}>
              {valid ? '✓' : '✕'}
            </div>
          )}
        </div>

        <p style={{ fontSize: 12.5, color: '#9EA0AC', marginTop: 8, lineHeight: 1.5 }}>
          {minLengthForTier(tier)}–20 characters, starts with a letter.
          Only lowercase latin letters, digits and _
        </p>

        {hint && (
          <div style={{ color: '#8A8A94', fontSize: 12.5, marginTop: 10, lineHeight: 1.45 }}>
            {hint}
          </div>
        )}

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

        <button
          onClick={claimClicked}
          disabled={!valid || busy}
          style={{
            width: '100%', marginTop: 24,
            padding: '16px 22px',
            borderRadius: 14,
            background: (!valid || busy) ? '#2A2A33' : '#F5F5F7',
            color: (!valid || busy) ? '#5A5A65' : '#0A0A0B',
            border: 'none',
            fontSize: 15, fontWeight: 600,
            cursor: (!valid || busy) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {busy ? t('Claiming...') : t('Claim a username')}
        </button>

        <button
          onClick={skipClicked}
          style={{
            width: '100%', marginTop: 10,
            padding: '14px',
            background: 'transparent',
            border: 'none',
            color: '#A4A6B2', fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {t('Skip — I\'ll stay anonymous')}
        </button>
      </div>
    </div>
  );
}
