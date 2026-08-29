import { useState, useEffect } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';
import * as convs from '../lib/conversations.js';
import * as vault from '../lib/vault.js';
import * as notif from '../lib/notifications.js';
import * as devBackup from '../lib/backup.js';
import * as push from '../lib/push.js';
import { encryptWithSecret, decryptWithSecret } from '../lib/vault.js';
import { utf8, utf8Decode, bytesToBase64, base64ToBytes } from '../lib/crypto.js';
import { t, tp } from '../lib/i18n.js';

/**
 * Settings — Linear-style redesign.
 *
 * Visual direction:
 *   - Pure-black background (#0a0a0b), no decorative blobs
 *   - Title block at top-left ("Settings" large + subtle subtitle)
 *   - X close button at top-right in a circular pill
 *   - Flat rows separated by thin dividers (no boxed sections)
 *   - Each row: icon + label on left, status/value on right, > arrow if tappable
 *   - Red "Emergency exit" at the bottom, isolated
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
  const [soundEnabled, setSoundEnabled] = useState(notif.isSoundEnabled());

  function toggleSound() {
    const next = !soundEnabled;
    notif.setSoundEnabled(next);
    setSoundEnabled(next);
    if (next) notif.playMessageSound();     // одразу продемонструвати звук
    showToast(next ? t('Message sounds on.') : t('Sound off.'));
  }

  // Read receipts toggle
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(
    () => store.getPreference('read_receipts', true),
  );

  function toggleReadReceipts() {
    const next = !readReceiptsEnabled;
    store.setPreference('read_receipts', next);
    setReadReceiptsEnabled(next);
    showToast(next ? t('Read receipts on') : t('Read receipts off'), 'ok');
  }

  // Web push state — driven by both browser permission and server subscription
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  // Нативний застосунок (Capacitor): браузерного Notification API в
  // WebView нема — рядок "Notifications" там не має сенсу, фонові
  // сповіщення в нативі = "Push notifications" (FCM).
  const isNativeApp = !!window.Capacitor?.isNativePlatform?.();
  const pushSupported = push.isSupported();
  const pushPermission = push.getPermission();

  // Contacts-only mode: requests from non-contacts get folded into the
  // "Запити повідомлень" tab in ChatsList and don't surface in the main
  // chat list. The toggle lives in storage's preference store; ChatsList
  // polls it every 2s so flipping it here updates the chat list without
  // requiring navigation.
  const [contactsOnly, setContactsOnly] = useState(
    () => !!store.getPreference('contacts_only_mode', false)
  );

  const [readBurn, setReadBurn] = useState(() => convs.getReadBurnSeconds());
  const READBURN_ORDER = [0, 30, 300];
  const READBURN_LABEL = { 0: t('Off'), 30: t('30 seconds'), 300: t('5 minutes') };
  function cycleReadBurn() {
    const i = READBURN_ORDER.indexOf(readBurn);
    const next = READBURN_ORDER[(i + 1) % READBURN_ORDER.length] ?? 0;
    convs.setReadBurnSeconds(next);
    setReadBurn(next);
    showToast(next === 0 ? t('Disappear-after-reading disabled') : tp("Disappears {0} after reading", [READBURN_LABEL[next]]), 'ok');
  }

  function toggleContactsOnly() {
    const next = !contactsOnly;
    store.setPreference('contacts_only_mode', next);
    setContactsOnly(next);
  }

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
        showToast(t('Push notifications disabled'), 'ok');
      } else {
        await push.enable();
        setPushEnabled(true);
        showToast(t('Push notifications enabled'), 'ok');
      }
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg === 'permission_denied') {
        showToast(t('Notification permission is blocked in the browser'), 'err');
      } else if (msg === 'not_supported') {
        showToast('This browser doesn\'t support push', 'err');
      } else {
        showToast(tp("Failed: {0}", [msg]), 'err');
      }
    } finally {
      setPushBusy(false);
    }
  }

  // Опитування серверного бекапу вимкнено разом із самою фічею: рядка в UI
  // більше нема, а запит на кожне відкриття Налаштувань був марним
  // (сервер однаково відповідає 403/404 усім). Лишаємо блок закоментованим,
  // щоб фічу можна було повернути одним рухом, якщо колись зʼявиться.
  useEffect(() => {
    (async () => {
      /* try {
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
      } */
    })();
  }, []);

  function showToast(text, kind = 'info') {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 2200);
  }

  async function toggleNotifications() {
    if (!notif.isSupported()) {
      showToast('This browser doesn\'t support notifications.', 'warn');
      return;
    }
    if (notifEnabled) {
      notif.setPreferenceEnabled(false);
      setNotifEnabled(false);
      showToast('Notifications off.');
      return;
    }
    const perm = await notif.requestPermission();
    setNotifPermission(perm);
    if (perm === 'granted') {
      notif.setPreferenceEnabled(true);
      setNotifEnabled(true);
      showToast(t('Notifications on.'), 'ok');
    } else if (perm === 'denied') {
      showToast(t('Blocked in browser settings.'), 'warn');
    }
  }

  const [duressOn, setDuressOn] = useState(vault.hasDuressPin());
  const [relayUrl, setRelayUrlState] = useState(() => api.getRelayUrl());
  const isDefaultRelay = relayUrl === api.getDefaultRelayUrl();
  const relayShort = isDefaultRelay
    ? t('Default')
    : relayUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  async function switchRelayClicked() {
    if (!isDefaultRelay) {
      const back = window.confirm(
        `Currently using your relay:\n${relayUrl}\n\n` +
        t('Switch back to the default relay1.morok.app?\n') +
        t('(your 24 words work on any relay)'));
      if (!back) return;
      api.setRelayUrl(api.getDefaultRelayUrl());
      setRelayUrlState(api.getDefaultRelayUrl());
      showToast(t('Switching back to the default relay…'), 'ok');
      setTimeout(() => window.location.reload(), 800);
      return;
    }
    const url = window.prompt(
      'Your relay address (see morok.app/selfhost.html):\n\n' +
      t('E.g. https://relay.mydomain.com'), 'https://');
    if (!url) return;
    showToast(t('Checking the relay…'), 'ok');
    let info;
    try {
      info = await api.checkRelayHealth(url);
    } catch (e) {
      showToast(e?.message || t('Relay unavailable'), 'warn');
      return;
    }
    const okGo = window.confirm(
      tp("Relay found:\\n{0}\\nversion {1}", [info.name, info.version]) +
      (info.onion ? t('\nTor: supported') : '') +
      '\n\nSwitch to it?\n\n' +
      'What changes: the app will run through your server. ' +
      'Your key (24 words) stays the same, but the username is reserved separately on ' +
      'each relay, while old messages stay on the previous one. ' +
      t('You can switch back any time right here.'));
    if (!okGo) return;
    api.setRelayUrl(info.url);
    setRelayUrlState(info.url);
    showToast(t('Switching to your relay…'), 'ok');
    setTimeout(() => window.location.reload(), 800);
  }

  function trySetDuress(pin) {
    // duress НЕ МОЖЕ збігатися з основним PIN
    try {
      const id = store.loadIdentity();
      if (id?.blob_b64) {
        try {
          decryptWithSecret(id.blob_b64, pin);
          showToast(t('This code matches your main PIN — pick a different one.'), 'warn');
          return;
        } catch { /* не розшифрувався = не основний = добре */ }
      }
    } catch { /* ignore */ }
    const p2 = window.prompt('Repeat the duress PIN:');
    if (p2 === null) return;
    if (p2.trim() !== pin) { showToast('The codes don\'t match.', 'warn'); return; }
    vault.setDuressPin(pin);
    setDuressOn(true);
    showToast(t('Duress PIN enabled. Test it BEFORE you actually need it.'), 'ok');
  }

  function setupPinClicked() { onNavigate('pin-setup-existing'); }

  async function removePinClicked() {
    if (!confirm('Remove the PIN? You\'ll need to protect the account again after a reload.')) return;
    const seed = vault.getUnlockedSeed();
    if (!seed) {
      showToast(t('Session expired. Reload the page.'), 'warn');
      return;
    }
    setBusy(true);
    try {
      const pin = prompt('Enter the PIN again to remove protection:');
      if (!pin || pin.length !== 6) { setBusy(false); return; }
      let mnemonicBytes;
      try {
        mnemonicBytes = decryptWithSecret(identity.mnemonic_b64, pin);
      } catch {
        showToast(t('Wrong PIN'), 'warn');
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
      showToast(t('PIN removed. Reload the page.'), 'ok');
    } catch (e) {
      showToast('Error: ' + e.message, 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function createServerBackupClicked() {
    if (profile?.tier === 'free') {
      showToast(t('Server backup is coming later. Meanwhile use \u201cDevice backup\u201d below: a .morok file stores everything.'), 'warn');
      return;
    }
    const passphrase = prompt(
      t('Create a backup passphrase (at least 12 characters).\n') +
      'You\'ll need it when restoring from another device.'
    );
    if (!passphrase) return;
    if (passphrase.length < 12) {
      showToast(t('At least 12 characters.'), 'warn');
      return;
    }
    const confirm2 = prompt('Enter the passphrase again:');
    if (confirm2 !== passphrase) {
      showToast('Doesn\'t match.', 'warn');
      return;
    }
    let seed = vault.getUnlockedSeed();
    if (!seed && identity?.encrypted === false && identity?.seed_hex) {
      seed = new Uint8Array(identity.seed_hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
    }
    if (!seed) {
      showToast(t('Session expired.'), 'warn');
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
      showToast(t('Backup created.'), 'ok');
      setServerBackup({ exists: true });
      store.saveBackupHas({ has: true, updatedAt: Math.floor(Date.now() / 1000) });
    } catch (e) {
      showToast(e.message || t('Error'), 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function deleteServerBackupClicked() {
    if (!confirm(t('Delete the backup? Recovery will only be possible with the 24 words.'))) return;
    setBusy(true);
    try {
      await api.deleteMyBackup();
      showToast('Backup deleted.');
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
            fontSize: 27, fontWeight: 800, letterSpacing: '-0.03em',
            color: '#F5F5F7', lineHeight: 1,
          }}>
            {t('Settings')}
          </div>
          <div style={{
            fontSize: 13, color: '#A4A6B2',
            marginTop: 8, fontWeight: 500,
          }}>
            {t('Profile · Security · Notifications')}
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
        padding: '0 14px',
      }}>

        {/* Group 1: Security */}
        <div className="lin-group-label">{t('Device backup')}</div>
        <div className="lin-section">
          <LinRow
            label={t("Save everything to a file (.morok)")}
            value={t("chats · mail · contacts")}
            onClick={async () => {
              const seed = vault.getUnlockedSeed();
              if (!seed) { showToast(t('Unlock with your PIN first.'), 'warn'); return; }
              try {
                const b = await devBackup.exportToFile(seed);
                showToast(tp("Backup saved: {0} chats, {1} emails.", [b.chats, b.mails]), 'ok');
              } catch (e) {
                showToast(e?.message || 'Couldn\'t create the backup', 'warn');
              }
            }}
            chevron
          />
          <LinRow
            label={t("Restore from file")}
            value={t("merges, erases nothing")}
            onClick={() => document.getElementById('morok-dev-backup-file')?.click()}
            chevron
          />
          <input
            id="morok-dev-backup-file"
            type="file"
            accept=".morok,application/octet-stream,application/json"
            style={{ display: 'none' }}
            onChange={async (ev) => {
              const file = ev.target.files?.[0];
              ev.target.value = '';
              if (!file) return;
              const seed = vault.getUnlockedSeed();
              if (!seed) { showToast(t('Unlock with your PIN first.'), 'warn'); return; }
              try {
                const obj = await devBackup.readBackupFile(file);
                const r = await devBackup.importBackup(seed, obj);
                showToast(
                  tp("Restored: +{0} messages, +{1} emails.", [r.msgsAdded, r.mailsAdded]), 'ok');
                setTimeout(() => window.location.reload(), 900);
              } catch (e) {
                showToast(e?.message || 'Couldn\'t restore', 'warn');
              }
            }}
          />
        </div>

        <div className="lin-group-label">{t('Security')}</div>
        <div className="lin-section">
          <LinRow
            label={t("PIN code")}
            value={hasPin ? t('Installed') : t('Not installed')}
            valueColor={hasPin ? '#4ADE80' : '#FF6B7A'}
            onClick={hasPin ? removePinClicked : setupPinClicked}
          />
          <LinRow
            label="Duress-PIN"
            value={duressOn ? t('On') : t('Off')}
            valueColor={duressOn ? '#4ADE80' : '#A8A8B0'}
            onClick={() => {
              if (!hasPin) {
                showToast(t('Set up the main PIN first.'), 'warn');
                return;
              }
              if (duressOn) {
                const a = window.prompt('Duress PIN is enabled.\n\nEnter a NEW 6-digit PIN to change it,\nor type OFF to disable.');
                if (a === null) return;
                if (a.trim().toUpperCase() === 'OFF') {
                  vault.clearDuressPin(); setDuressOn(false);
                  showToast(t('Duress PIN disabled.'), 'ok'); return;
                }
                if (!/^\d{6}$/.test(a.trim())) {
                  showToast(t('PIN must be exactly 6 digits.'), 'warn'); return;
                }
                trySetDuress(a.trim());
                return;
              }
              const p1 = window.prompt('Duress PIN: a second code on the unlock screen.\nEntering it INSTANTLY and SILENTLY wipes everything from this device (the account is recoverable with the 24 words, history — from a .morok backup).\n\nEnter 6 digits:');
              if (p1 === null) return;
              if (!/^\d{6}$/.test(p1.trim())) {
                showToast(t('PIN must be exactly 6 digits.'), 'warn'); return;
              }
              trySetDuress(p1.trim());
            }}
            chevron
          />
          {/* «Бекап на сервері» прибрано: сервер віддає 403 усім
              free-акаунтам, тобто створити його не міг НІХТО — рядок був
              глухим кутом. Робочий шлях — «Бекап пристрою» (файл .morok)
              у секції вище. Хендлери лишені в коді: якщо фіча колись
              зʼявиться, достатньо повернути цей блок. */}
          <LinRow
            label={t("Only contacts can message you")}
            value={contactsOnly ? t('On') : t('Off')}
            valueColor={contactsOnly ? '#4ADE80' : '#A8A8B0'}
            onClick={toggleContactsOnly}
          />
          <LinRow
            label={t("Disappear after reading")}
            value={READBURN_LABEL[readBurn] || t('Off')}
            valueColor={readBurn === 0 ? '#A8A8B0' : '#4ADE80'}
            onClick={cycleReadBurn}
          />
        </div>

        {/* Group 2: App */}
        {api.canSwitchRelay() && (
          <>
            <div className="lin-group-label">{t('Network')}</div>
            <div className="lin-section">
              <LinRow
                label={t("Own relay")}
                value={relayShort}
                valueColor={isDefaultRelay ? '#A8A8B0' : '#4ADE80'}
                onClick={switchRelayClicked}
                chevron
              />
            </div>
            <div style={{
              color: '#A8AAB5', fontSize: 12.5, lineHeight: 1.5,
              padding: '8px 16px 4px',
            }}>
              {t('Your own server = your messages pass only through it. Guide:')} <span style={{ color: '#7B96FF' }}>morok.app/selfhost.html</span>
            </div>
          </>
        )}

        <div className="lin-group-label">{t('App')}</div>
        <div className="lin-section">
          <LinRow
            label={t("Language")}
            value={getLang() === 'uk' ? 'Українська' : 'English'}
            onClick={() => setLang(getLang() === 'uk' ? 'en' : 'uk')}
            chevron
          />
          {!isNativeApp && <LinRow
            label={t("Notifications")}
            value={
              !notif.isSupported() ? t('Unavailable') :
              notifPermission === 'denied' ? t('Blocked') :
              notifEnabled ? t('On') : t('Off')
            }
            valueColor={
              !notif.isSupported() || notifPermission === 'denied' ? '#FF6B7A' :
              notifEnabled ? '#4ADE80' : '#6B6B72'
            }
            onClick={(notif.isSupported() && notifPermission !== 'denied') ? toggleNotifications : null}
            chevron={notif.isSupported() && notifPermission !== 'denied'}
          />}
          <LinRow
            label={t("Message sounds")}
            value={soundEnabled ? t('On') : t('Off')}
            valueColor={soundEnabled ? '#4ADE80' : '#6B6B72'}
            onClick={toggleSound}
          />
          <LinRow
            label={t("Read receipts")}
            value={readReceiptsEnabled ? t('On') : t('Off')}
            valueColor={readReceiptsEnabled ? '#4ADE80' : '#6B6B72'}
            onClick={toggleReadReceipts}
          />
          <LinRow
            label={t("Push notifications")}
            value={
              !pushSupported ? t('Unavailable') :
              pushPermission === 'denied' ? t('Blocked') :
              pushBusy ? '…' :
              pushEnabled ? t('On') : t('Off')
            }
            valueColor={
              !pushSupported || pushPermission === 'denied' ? '#FF6B7A' :
              pushEnabled ? '#4ADE80' : '#6B6B72'
            }
            onClick={(pushSupported && pushPermission !== 'denied' && !pushBusy) ? togglePush : null}
            chevron={pushSupported && pushPermission !== 'denied'}
          />
          <LinRow
            label={t("Muted chats")}
            value={t("preview")}
            onClick={() => onNavigate('muted')}
          />
        </div>

        {/* Group 3: Account */}
        <div className="lin-group-label">{t('Account')}</div>
        <div className="lin-section">
          <LinRow
            label={t("Profile")}
            value={profile?.username ? `@${profile.username}` : t('unnamed')}
            onClick={() => onNavigate('profile')}
          />
          <LinRow
            label={t("Recovery key")}
            value={t("24 words")}
            onClick={() => onNavigate('recovery-key')}
          />
          <LinRow
            label={t("Login history")}
            value={t("last 30")}
            onClick={() => onNavigate('sessions')}
          />
          <LinRow
            label={t("Emergency exit")}
            labelColor="#FF6B7A"
            onClick={emergencyLogoutClicked}
            chevron={false}
          />
        </div>

        {/* Danger zone */}
        <div className="lin-group-label">{t('Danger zone')}</div>
        <div className="lin-section">
          <LinRow
            label={t("Delete account")}
            labelColor="#FF6B7A"
            value={t("irreversible")}
            valueColor="#FF6B7A"
            onClick={() => onNavigate('delete-account')}
          />
        </div>

        {/* Footer */}
        <div style={{
          padding: '32px 20px 24px',
          textAlign: 'center',
          fontSize: 12,
          color: '#8B8D99',
          letterSpacing: '0.04em',
          fontWeight: 500,
        }}>
          Morok · v0.4.1 · beta
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

function LinRow({
  label, labelColor = '#ECECF0',
  value, valueColor = '#A8AAB5',
  onClick, chevron = true, disabled = false,
}) {
  const isClickable = !!onClick && !disabled;
  return (
    <div
      className="lin-section-row"
      onClick={isClickable ? onClick : undefined}
      style={{
        cursor: isClickable ? 'pointer' : 'default',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span className="row-label" style={{ color: labelColor }}>{label}</span>
      <span className="row-value">
        {value ? <span style={{ color: valueColor }}>{value}</span> : null}
        {chevron && isClickable && (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3F3F45" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
      </span>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 12, color: '#8B8D99',
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
