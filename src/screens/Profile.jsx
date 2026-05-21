import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import * as contacts from '../lib/contacts.js';

export default function Profile({ onNavigate }) {
  const profile = store.loadProfile();
  const identity = store.loadIdentity();
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);

  // Build full address: @username@relay
  const fullAddress = profile?.username && profile?.home_relay
    ? `@${profile.username}@${profile.home_relay}`
    : null;

  const shareLink = profile?.username
    ? `${window.location.origin}/web/#newchat?u=${profile.username}${profile.home_relay ? '@' + profile.home_relay : ''}`
    : null;

  // Render QR code to canvas on mount
  useEffect(() => {
    if (!shareLink || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, shareLink, {
      width: 200,
      margin: 1,
      color: {
        dark: '#ECECF0',
        light: '#1A1A20',
      },
      errorCorrectionLevel: 'M',
    }).catch((e) => console.warn('QR render failed:', e));
  }, [shareLink]);

  async function copyShareLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  function downloadQR() {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `morok-${profile.username}.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  }

  async function logoutClicked() {
    if (!confirm('Вийти з акаунта? Локальні дані видаляться.')) return;
    await api.logout();
    contacts.clear();
    store.wipeAll();
    onNavigate('welcome');
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div className="back" onClick={() => onNavigate('chats')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        <div className="title">Профіль</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px' }}>
        {/* Header */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 12, paddingBottom: 20, borderBottom: '1px solid var(--border)',
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent) 0%, #4A5FB0 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 36, fontWeight: 700, color: '#fff',
          }}>
            {(profile?.username?.[0] || '?').toUpperCase()}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>@{profile?.username}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
            {fullAddress}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            tier: {profile?.tier}
          </div>
        </div>

        {/* QR */}
        <div style={{ marginTop: 24 }}>
          <div style={{
            fontSize: 11, color: 'var(--text-faint)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            marginBottom: 10,
          }}>
            QR-код для контакта
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 14, padding: 20, gap: 12,
          }}>
            <canvas ref={canvasRef} style={{ borderRadius: 8 }} />
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={downloadQR}
              >
                Завантажити
              </button>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={copyShareLink}
              >
                {copied ? '✓ Готово' : 'Копіювати лінк'}
              </button>
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 10, lineHeight: 1.5 }}>
            Покажіть QR або скиньте лінк — людина зможе одразу вам написати.
          </p>
        </div>

        {/* Mnemonic backup */}
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Ключ відновлення
          </div>
          {!showMnemonic ? (
            <button className="btn btn-secondary" onClick={() => setShowMnemonic(true)}>
              Показати 24 слова
            </button>
          ) : (
            <>
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 12, padding: 14,
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
              }}>
                {identity?.mnemonic.split(' ').map((w, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 2px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-faint)', minWidth: 16 }}>{i + 1}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--mono)' }}>{w}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 8, lineHeight: 1.5 }}>
                Не показуйте нікому. Будь-хто з цією фразою може видавати себе за вас.
              </p>
            </>
          )}
        </div>

        {/* Logout */}
        <div style={{ marginTop: 36, paddingBottom: 32 }}>
          <button className="btn btn-danger" onClick={logoutClicked}>
            Вийти і видалити локальні дані
          </button>
        </div>
      </div>
    </div>
  );
}
