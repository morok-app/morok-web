import { useState, useEffect } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import * as notif from '../lib/notifications.js';
import * as push from '../lib/push.js';
import { encryptWithSecret, decryptWithSecret } from '../lib/vault.js';
import { utf8, utf8Decode, bytesToBase64, base64ToBytes } from '../lib/crypto.js';

/**
 * Settings — Linear-style redesign.
 *
 * Visual direction:
 *   - Pure-black background (#0a0a0b), no decorative blobs
 *   - Title block at top-left ("Налаштування" large + subtle subtitle)
 *   - X close button at top-right in a circular pill
 *   - Flat rows separated by thin dividers (no boxed sections)
 *   - Each row: icon + label on left, status/value on right, > arrow if tappable
 *   - Red "Аварійний вихід" at the bottom, isolated
 *   - Footer with version at the very bottom, monospace, dim
 */
export default function Settings({ onNavigate }) {
  const profile = store.loadProfile();
  const identity = store.loadIdentity();
  const hasPin = identity?.encrypted === true;
  const [serverBackup, setServerBackup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // Notifications state
  const [notifEnabled, setNotifEnabled] = useState(notif.isPreferenceEnabled());
  const [notifPermission, setNotifPermission] = useState(notif.getPermission());

  // Read receipts toggle
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(
    () => store.getPreference('read_receipts', true),
  );

  function toggleReadReceipts() {
    const next = !readReceiptsEnabled;
    store.setPreference('read_receipts', next);
    setReadReceiptsEnabled(next);
    showToast(next ? 'Підтвердження прочитання увімкнено' : 'Підтвердження прочитання вимкнено', 'ok');
  }

  // Web push state — driven by both browser permission and server subscription
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const pushSupported = push.isSupported();
  const pushPermission = push.getPermission();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported) return;
      try {
        const on = await push.isEnabled();
        if (!cancelled) setPushEnabled(on);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [pushSupported]);

  async function togglePush() {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (pushEnabled) {
        await push.disable();
        setPushEnabled(false);
        showToast('Push сповіщення вимкнено', 'ok');
      } else {
        await push.enable();
        setPushEnabled(true);
        showToast('Push сповіщення увімкнено', 'ok');
      }
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg === 'permission_denied') {
        showToast('Дозвіл на сповіщення заблоковано в браузері', 'err');
      } else if (msg === 'not_supported') {
        showToast('Браузер не підтримує push', 'err');
      } else {
        showToast(`Не вдалось: ${msg}`, 'err');
      }
    } finally {
      setPushBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const info = await api.getMyBackup();
        setServerBackup({ exists: true, info });
        store.saveBackupHas({ has: true, updatedAt: info.updated_at });
      } catch (e) {
        if (e.status === 404) {
          setServerBackup({ exists: false });
          store.saveBackupHas({ has: false, updatedAt: 0 });
        } else {
          setServerBackup({ exists: false, error: e.message });
        }
      }
    })();
  }, []);

  function showToast(text, kind = 'info') {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 2200);
  }

  async function toggleNotifications() {
    if (!notif.isSupported()) {
      showToast('Браузер не підтримує сповіщення.', 'warn');
      return;
    }
    if (notifEnabled) {
      notif.setPreferenceEnabled(false);
      setNotifEnabled(false);
      showToast('Сповіщення вимкнено.');
      return;
    }
    const perm = await notif.requestPermission();
    setNotifPermission(perm);
    if (perm === 'granted') {
      notif.setPreferenceEnabled(true);
      setNotifEnabled(true);
      showToast('Сповіщення увімкнено.', 'ok');
    } else if (perm === 'denied') {
      showToast('Заблоковано в налаштуваннях браузера.', 'warn');
    }
  }

  function setupPinClicked() { onNavigate('pin-setup-existing'); }

  async function removePinClicked() {
    if (!confirm('Видалити PIN? Доведеться знову захищати акаунт після перезавантаження.')) return;
    const seed = vault.getUnlockedSeed();
    if (!seed) {
      showToast('Сеанс закінчився. Перезавантажте сторінку.', 'warn');
      return;
    }
    setBusy(true);
    try {
      const pin = prompt('Введіть PIN ще раз щоб видалити захист:');
      if (!pin || pin.length !== 6) { setBusy(false); return; }
      let mnemonicBytes;
      try {
        mnemonicBytes = decryptWithSecret(identity.mnemonic_b64, pin);
      } catch {
        showToast('Неправильний PIN', 'warn');
        setBusy(false);
        return;
      }
      const mnemonic = utf8Decode(mnemonicBytes);
      store.saveIdentityUnlocked({
        seedHex: Array.from(seed).map((b) => b.toString(16).padStart(2, '0')).join(''),
        pubkeyHex: identity.pubkey_hex,
        mnemonic,
      });
      vault.clearLockout();
      vault.lockNow();
      showToast('PIN видалено. Перезавантажте сторінку.', 'ok');
    } catch (e) {
      showToast('Помилка: ' + e.message, 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function createServerBackupClicked() {
    if (profile?.tier === 'free') {
      showToast('Бекап доступний у преміумі.', 'warn');
      return;
    }
    const passphrase = prompt(
      'Створіть passphrase для бекапу (мінімум 12 символів).\n' +
      'Її потрібно ввести при відновленні з іншого пристрою.'
    );
    if (!passphrase) return;
    if (passphrase.length < 12) {
      showToast('Мінімум 12 символів.', 'warn');
      return;
    }
    const confirm2 = prompt('Введіть passphrase ще раз:');
    if (confirm2 !== passphrase) {
      showToast('Не співпадає.', 'warn');
      return;
    }
    let seed = vault.getUnlockedSeed();
    if (!seed && identity?.encrypted === false && identity?.seed_hex) {
      seed = new Uint8Array(identity.seed_hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
    }
    if (!seed) {
      showToast('Сеанс закінчився.', 'warn');
      return;
    }
    setBusy(true);
    try {
      const encryptedBlob = encryptWithSecret(seed, passphrase);
      const blobBytes = base64ToBytes(encryptedBlob);
      const saltB64 = bytesToBase64(blobBytes.slice(0, 16));
      await api.uploadBackup({
        encryptedSeedB64: encryptedBlob,
        kdfSaltB64: saltB64,
        kdfParams: { alg: 'pbkdf2', hash: 'sha256', iter: 200000 },
      });
      showToast('Бекап створено.', 'ok');
      setServerBackup({ exists: true });
      store.saveBackupHas({ has: true, updatedAt: Math.floor(Date.now() / 1000) });
    } catch (e) {
      showToast(e.message || 'Помилка', 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function deleteServerBackupClicked() {
    if (!confirm('Видалити бекап? Відновлення можливо буде тільки через 24 слова.')) return;
    setBusy(true);
    try {
      await api.deleteMyBackup();
      showToast('Бекап видалено.');
      setServerBackup({ exists: false });
      store.saveBackupHas({ has: false, updatedAt: 0 });
    } catch (e) {
      showToast(e.message, 'warn');
    } finally {
      setBusy(false);
    }
  }

  function emergencyLogoutClicked() {
    try {
      store.wipeAll();
      vault.lockNow();
    } catch (e) { console.warn('wipe failed:', e); }
    window.location.href = '/web/#welcome';
    window.location.reload();
  }

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      {/* ── HEADER ────────────────────────────────────────────── */}
      <div style={{
        padding: '20px 20px 32px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 32, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#F5F5F7', lineHeight: 1,
          }}>
            Налаштування
          </div>
          <div style={{
            fontSize: 13, color: '#6B6B72',
            marginTop: 8, fontWeight: 500,
          }}>
            Профіль · Захист · Сповіщення
          </div>
        </div>

        <button
          onClick={() => onNavigate('chats')}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: '#16161B', border: '1px solid #232329',
            color: '#A8A8B0',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* ── ROWS ──────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '0 4px',
      }}>

        {/* Group 1: Security */}
        <SectionLabel>Захист</SectionLabel>

        <Row
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
          label="PIN-код"
          value={hasPin ? 'Встановлено' : 'Не встановлено'}
          valueColor={hasPin ? '#4ADE80' : '#FF6B7A'}
          onClick={hasPin ? removePinClicked : setupPinClicked}
          chevron
        />

        <Row
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>}
          label="Бекап на сервері"
          value={
            serverBackup === null ? 'перевіряємо...' :
            serverBackup.exists ? 'Активний' :
            profile?.tier === 'free' ? 'Преміум' : 'Не створено'
          }
          valueColor={
            serverBackup === null ? '#6B6B72' :
            serverBackup?.exists ? '#4ADE80' :
            profile?.tier === 'free' ? '#F59E0B' : '#A8A8B0'
          }
          onClick={
            !serverBackup ? null :
            serverBackup.exists ? deleteServerBackupClicked :
            profile?.tier === 'free' ? null : createServerBackupClicked
          }
          chevron={!!serverBackup && profile?.tier !== 'free'}
          disabled={busy}
        />

        {/* Group 2: App */}
        <SectionLabel>Додаток</SectionLabel>

        <Row
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>}
          label="Сповіщення"
          value={
            !notif.isSupported() ? 'Недоступно' :
            notifPermission === 'denied' ? 'Заблоковано' :
            notifEnabled ? 'Увімкнено' : 'Вимкнено'
          }
          valueColor={
            !notif.isSupported() || notifPermission === 'denied' ? '#FF6B7A' :
            notifEnabled ? '#4ADE80' : '#6B6B72'
          }
          onClick={(notif.isSupported() && notifPermission !== 'denied') ? toggleNotifications : null}
          chevron={notif.isSupported() && notifPermission !== 'denied'}
        />

        <Row
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/><polyline points="22 10 11 21 6 16"/></svg>}
          label="Підтвердження прочитання"
          value={readReceiptsEnabled ? 'Увімкнено' : 'Вимкнено'}
          valueColor={readReceiptsEnabled ? '#4ADE80' : '#6B6B72'}
          onClick={toggleReadReceipts}
          chevron
        />

        <Row
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>}
          label="Push сповіщення"
          value={
            !pushSupported ? 'Недоступно' :
            pushPermission === 'denied' ? 'Заблоковано' :
            pushBusy ? '...' :
            pushEnabled ? 'Увімкнено' : 'Вимкнено'
          }
          valueColor={
            !pushSupported || pushPermission === 'denied' ? '#FF6B7A' :
            pushEnabled ? '#4ADE80' : '#6B6B72'
          }
          onClick={(pushSupported && pushPermission !== 'denied' && !pushBusy) ? togglePush : null}
          chevron={pushSupported && pushPermission !== 'denied'}
        />

        <Row
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>}
          label="Заглушені чати"
          value="перегляд"
          valueColor="#A8A8B0"
          onClick={() => onNavigate('muted')}
          chevron
        />

        {/* Group 3: Account */}
        <SectionLabel>Акаунт</SectionLabel>

        <Row
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
          label="Профіль"
          value={profile?.username ? `@${profile.username}` : 'без імені'}
          valueColor="#A8A8B0"
          valueMono
          onClick={() => onNavigate('profile')}
          chevron
        />

        <Row
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>}
          label="Ключ відновлення"
          value="24 слова"
          valueColor="#A8A8B0"
          onClick={() => onNavigate('profile')}
          chevron
        />

        <Row
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          }
          label="Історія входів"
          value="останні 30"
          valueColor="#A8A8B0"
          onClick={() => onNavigate('sessions')}
          chevron
        />

        <Row
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          }
          label="Аварійний вихід"
          labelColor="#FF6B7A"
          iconColor="#FF6B7A"
          value=""
          onClick={emergencyLogoutClicked}
          warn
        />

        <SectionLabel>Зона ризику</SectionLabel>

        <Row
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
            </svg>
          }
          label="Видалити акаунт"
          labelColor="#FF6B7A"
          iconColor="#FF6B7A"
          value="незворотно"
          valueColor="#FF6B7A"
          valueMono
          onClick={() => onNavigate('delete-account')}
          chevron
          warn
        />

        {/* Footer */}
        <div style={{
          padding: '40px 20px 24px',
          textAlign: 'center',
          fontFamily: 'var(--mono, monospace)',
          fontSize: 11,
          color: '#3F3F45',
          letterSpacing: '0.05em',
        }}>
          MOROK · v0.4 · BETA
        </div>
      </div>

      {/* ── TOAST ─────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 18px',
          background: '#16161B',
          border: '1px solid #2A2A33',
          borderRadius: 100,
          fontSize: 13, color: '#F5F5F7', fontWeight: 500,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', gap: 10,
          animation: 'toastIn 0.2s ease-out',
          zIndex: 200,
        }}>
          {toast.kind === 'ok' && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
          {toast.kind === 'warn' && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF6B7A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          )}
          <span>{toast.text}</span>
        </div>
      )}

      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translate(-50%, 12px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        .lin-row { transition: background .15s; }
        .lin-row:hover:not(.lin-row-disabled) { background: #111116; }
      `}</style>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────── */

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, color: '#3F3F45',
      textTransform: 'uppercase', letterSpacing: '0.1em',
      fontWeight: 600,
      padding: '20px 20px 8px',
    }}>
      {children}
    </div>
  );
}

function Row({
  icon, label, labelColor = '#F5F5F7', iconColor = '#A8A8B0',
  value, valueColor = '#6B6B72', valueMono = false,
  onClick, chevron = false, disabled = false, warn = false,
}) {
  const isClickable = !!onClick && !disabled;
  return (
    <div
      className={`lin-row ${disabled ? 'lin-row-disabled' : ''}`}
      onClick={isClickable ? onClick : undefined}
      style={{
        padding: '14px 20px',
        display: 'grid',
        gridTemplateColumns: '20px 1fr auto 14px',
        alignItems: 'center',
        columnGap: 14,
        cursor: isClickable ? 'pointer' : 'default',
        opacity: disabled ? 0.5 : 1,
        borderBottom: '1px solid #15151A',
      }}
    >
      <div style={{
        width: 20, height: 20,
        color: iconColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div style={{
        fontSize: 14.5,
        color: labelColor,
        fontWeight: warn ? 600 : 500,
        letterSpacing: '-0.005em',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 13,
        color: valueColor,
        fontFamily: valueMono ? 'var(--mono, monospace)' : 'inherit',
        fontWeight: 500,
        letterSpacing: valueMono ? '0.01em' : 0,
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
      <div style={{
        width: 14, height: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {chevron && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3F3F45" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
      </div>
    </div>
  );
}
