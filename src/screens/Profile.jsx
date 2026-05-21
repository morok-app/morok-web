import { useState } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';

export default function Profile({ onNavigate }) {
  const profile = store.loadProfile();
  const identity = store.loadIdentity();
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareLink = profile?.username
    ? `${window.location.origin}/web/#newchat?u=${profile.username}`
    : null;

  async function copyShareLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function logoutClicked() {
    if (!confirm('Вийти з акаунта? Локальні дані видаляться.')) return;
    await api.logout();
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
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 12, paddingBottom: 24, borderBottom: '1px solid var(--border)',
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
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {profile?.tier} · {profile?.home_relay}
          </div>
        </div>

        {/* Share section */}
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Поділитись чатом
          </div>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 14,
            fontSize: 12, fontFamily: 'var(--mono)',
            color: 'var(--text-dim)', wordBreak: 'break-all',
            marginBottom: 10,
          }}>
            {shareLink}
          </div>
          <button className="btn btn-secondary" onClick={copyShareLink}>
            {copied ? '✓ Скопійовано' : 'Скопіювати посилання'}
          </button>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.5 }}>
            Хто перейде за цим лінком — одразу зможе вам написати.
          </p>
        </div>

        {/* Mnemonic backup */}
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Ключ відновлення
          </div>
          {!showMnemonic ? (
            <button className="btn btn-secondary" onClick={() => setShowMnemonic(true)}>
              Показати 24-слівну фразу
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
        <div style={{ marginTop: 36 }}>
          <button className="btn btn-danger" onClick={logoutClicked}>
            Вийти і видалити локальні дані
          </button>
        </div>
      </div>
    </div>
  );
}
