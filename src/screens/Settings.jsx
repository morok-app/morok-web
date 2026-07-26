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
  const [soundEnabled, setSoundEnabled] = useState(notif.isSoundEnabled());

  function toggleSound() {
    const next = !soundEnabled;
    notif.setSoundEnabled(next);
    setSoundEnabled(next);
    if (next) notif.playMessageSound();     // одразу продемонструвати звук
    showToast(next ? 'Звук повідомлень увімкнено.' : 'Звук вимкнено.');
  }

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
  // Нативний застосунок (Capacitor): браузерного Notification API в
  // WebView нема — рядок "Сповіщення" там не має сенсу, фонові
  // сповіщення в нативі = "Push сповіщення" (FCM).
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
  const READBURN_LABEL = { 0: 'Вимкнено', 30: '30 секунд', 300: '5 хвилин' };
  function cycleReadBurn() {
    const i = READBURN_ORDER.indexOf(readBurn);
    const next = READBURN_ORDER[(i + 1) % READBURN_ORDER.length] ?? 0;
    convs.setReadBurnSeconds(next);
    setReadBurn(next);
    showToast(next === 0 ? 'Зникнення після прочитання вимкнено' : `Зникає через ${READBURN_LABEL[next]} після прочитання`, 'ok');
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

  const [duressOn, setDuressOn] = useState(vault.hasDuressPin());
  const [relayUrl, setRelayUrlState] = useState(() => api.getRelayUrl());
  const isDefaultRelay = relayUrl === api.getDefaultRelayUrl();
  const relayShort = isDefaultRelay
    ? 'Стандартний'
    : relayUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  async function switchRelayClicked() {
    if (!isDefaultRelay) {
      const back = window.confirm(
        `Зараз використовується ваш релей:\n${relayUrl}\n\n` +
        'Повернутися на стандартний relay1.morok.app?\n' +
        '(ваші 24 слова працюють на будь-якому релеї)');
      if (!back) return;
      api.setRelayUrl(api.getDefaultRelayUrl());
      setRelayUrlState(api.getDefaultRelayUrl());
      showToast('Повертаємось на стандартний релей…', 'ok');
      setTimeout(() => window.location.reload(), 800);
      return;
    }
    const url = window.prompt(
      'Адреса вашого релея (див. morok.app/selfhost):\n\n' +
      'Напр. https://relay.mydomain.com', 'https://');
    if (!url) return;
    showToast('Перевіряю релей…', 'ok');
    let info;
    try {
      info = await api.checkRelayHealth(url);
    } catch (e) {
      showToast(e?.message || 'Релей недоступний', 'warn');
      return;
    }
    const okGo = window.confirm(
      `Знайдено релей:\n${info.name}\nверсія ${info.version}` +
      (info.onion ? '\nTor: підтримується' : '') +
      '\n\nПереключитись на нього?\n\n' +
      'Що зміниться: застосунок працюватиме через ваш сервер. ' +
      'Ваш ключ (24 слова) той самий, але нікнейм резервується окремо на ' +
      'кожному релеї, а старі повідомлення лишаються на попередньому. ' +
      'Повернутись назад можна будь-коли тут же.');
    if (!okGo) return;
    api.setRelayUrl(info.url);
    setRelayUrlState(info.url);
    showToast('Переключаємось на ваш релей…', 'ok');
    setTimeout(() => window.location.reload(), 800);
  }

  function trySetDuress(pin) {
    // duress НЕ МОЖЕ збігатися з основним PIN
    try {
      const id = store.loadIdentity();
      if (id?.blob_b64) {
        try {
          decryptWithSecret(id.blob_b64, pin);
          showToast('Цей код збігається з основним PIN — оберіть інший.', 'warn');
          return;
        } catch { /* не розшифрувався = не основний = добре */ }
      }
    } catch { /* ignore */ }
    const p2 = window.prompt('Повторіть duress-PIN:');
    if (p2 === null) return;
    if (p2.trim() !== pin) { showToast('Коди не збігаються.', 'warn'); return; }
    vault.setDuressPin(pin);
    setDuressOn(true);
    showToast('Duress-PIN увімкнено. Перевірте його ДО реальної потреби.', 'ok');
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
      showToast('Серверний бекап буде доступний пізніше. А поки — «Бекап пристрою» нижче: файл .morok зберігає все.', 'warn');
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
            fontSize: 27, fontWeight: 800, letterSpacing: '-0.03em',
            color: '#F5F5F7', lineHeight: 1,
          }}>
            Налаштування
          </div>
          <div style={{
            fontSize: 13, color: '#A4A6B2',
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
        padding: '0 14px',
      }}>

        {/* Group 1: Security */}
        <div className="lin-group-label">Бекап пристрою</div>
        <div className="lin-section">
          <LinRow
            label="Зберегти все у файл (.morok)"
            value="чати · пошта · контакти"
            onClick={async () => {
              const seed = vault.getUnlockedSeed();
              if (!seed) { showToast('Спершу розблокуйте PIN.', 'warn'); return; }
              try {
                const b = await devBackup.exportToFile(seed);
                showToast(`Бекап збережено: ${b.chats} чатів, ${b.mails} листів.`, 'ok');
              } catch (e) {
                showToast(e?.message || 'Не вдалося створити бекап', 'warn');
              }
            }}
            chevron
          />
          <LinRow
            label="Відновити з файлу"
            value="злиття, нічого не стирає"
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
              if (!seed) { showToast('Спершу розблокуйте PIN.', 'warn'); return; }
              try {
                const obj = await devBackup.readBackupFile(file);
                const r = await devBackup.importBackup(seed, obj);
                showToast(
                  `Відновлено: +${r.msgsAdded} повідомлень, +${r.mailsAdded} листів.`, 'ok');
                setTimeout(() => window.location.reload(), 900);
              } catch (e) {
                showToast(e?.message || 'Не вдалося відновити', 'warn');
              }
            }}
          />
        </div>

        <div className="lin-group-label">Захист</div>
        <div className="lin-section">
          <LinRow
            label="PIN-код"
            value={hasPin ? 'Встановлено' : 'Не встановлено'}
            valueColor={hasPin ? '#4ADE80' : '#FF6B7A'}
            onClick={hasPin ? removePinClicked : setupPinClicked}
          />
          <LinRow
            label="Duress-PIN"
            value={duressOn ? 'Увімкнено' : 'Вимкнено'}
            valueColor={duressOn ? '#4ADE80' : '#A8A8B0'}
            onClick={() => {
              if (!hasPin) {
                showToast('Спершу встановіть основний PIN.', 'warn');
                return;
              }
              if (duressOn) {
                const a = window.prompt(
                  'Duress-PIN увімкнено.\n\nВведіть НОВИЙ 6-значний PIN, щоб змінити,\nабо слово OFF — щоб вимкнути.');
                if (a === null) return;
                if (a.trim().toUpperCase() === 'OFF') {
                  vault.clearDuressPin(); setDuressOn(false);
                  showToast('Duress-PIN вимкнено.', 'ok'); return;
                }
                if (!/^\d{6}$/.test(a.trim())) {
                  showToast('PIN — рівно 6 цифр.', 'warn'); return;
                }
                trySetDuress(a.trim());
                return;
              }
              const p1 = window.prompt(
                'Duress-PIN: другий код на екрані входу.\nЙого введення МИТТЄВО і НЕПОМІТНО стирає все з цього пристрою (акаунт відновлюється 24 словами, історія — з бекапу .morok).\n\nВведіть 6 цифр:');
              if (p1 === null) return;
              if (!/^\d{6}$/.test(p1.trim())) {
                showToast('PIN — рівно 6 цифр.', 'warn'); return;
              }
              trySetDuress(p1.trim());
            }}
            chevron
          />
          <LinRow
            label="Бекап на сервері"
            value={
              serverBackup === null ? 'перевіряємо…' :
              serverBackup.exists ? 'Активний' :
              profile?.tier === 'free' ? 'Скоро' : 'Не створено'
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
          <LinRow
            label="Тільки контакти можуть писати"
            value={contactsOnly ? 'Увімкнено' : 'Вимкнено'}
            valueColor={contactsOnly ? '#4ADE80' : '#A8A8B0'}
            onClick={toggleContactsOnly}
          />
          <LinRow
            label="Зникати після прочитання"
            value={READBURN_LABEL[readBurn] || 'Вимкнено'}
            valueColor={readBurn === 0 ? '#A8A8B0' : '#4ADE80'}
            onClick={cycleReadBurn}
          />
        </div>

        {/* Group 2: App */}
        {api.canSwitchRelay() && (
          <>
            <div className="lin-group-label">Мережа</div>
            <div className="lin-section">
              <LinRow
                label="Свій релей"
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
              Свій сервер = ваші повідомлення проходять лише через нього.
              Інструкція: <span style={{ color: '#7B96FF' }}>morok.app/selfhost</span>
            </div>
          </>
        )}

        <div className="lin-group-label">Додаток</div>
        <div className="lin-section">
          {!isNativeApp && <LinRow
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
          />}
          <LinRow
            label="Звук повідомлень"
            value={soundEnabled ? 'Увімкнено' : 'Вимкнено'}
            valueColor={soundEnabled ? '#4ADE80' : '#6B6B72'}
            onClick={toggleSound}
          />
          <LinRow
            label="Підтвердження прочитання"
            value={readReceiptsEnabled ? 'Увімкнено' : 'Вимкнено'}
            valueColor={readReceiptsEnabled ? '#4ADE80' : '#6B6B72'}
            onClick={toggleReadReceipts}
          />
          <LinRow
            label="Push сповіщення"
            value={
              !pushSupported ? 'Недоступно' :
              pushPermission === 'denied' ? 'Заблоковано' :
              pushBusy ? '…' :
              pushEnabled ? 'Увімкнено' : 'Вимкнено'
            }
            valueColor={
              !pushSupported || pushPermission === 'denied' ? '#FF6B7A' :
              pushEnabled ? '#4ADE80' : '#6B6B72'
            }
            onClick={(pushSupported && pushPermission !== 'denied' && !pushBusy) ? togglePush : null}
            chevron={pushSupported && pushPermission !== 'denied'}
          />
          <LinRow
            label="Заглушені чати"
            value="перегляд"
            onClick={() => onNavigate('muted')}
          />
        </div>

        {/* Group 3: Account */}
        <div className="lin-group-label">Акаунт</div>
        <div className="lin-section">
          <LinRow
            label="Профіль"
            value={profile?.username ? `@${profile.username}` : 'без імені'}
            onClick={() => onNavigate('profile')}
          />
          <LinRow
            label="Ключ відновлення"
            value="24 слова"
            onClick={() => onNavigate('recovery-key')}
          />
          <LinRow
            label="Історія входів"
            value="останні 30"
            onClick={() => onNavigate('sessions')}
          />
          <LinRow
            label="Аварійний вихід"
            labelColor="#FF6B7A"
            onClick={emergencyLogoutClicked}
            chevron={false}
          />
        </div>

        {/* Danger zone */}
        <div className="lin-group-label">Зона ризику</div>
        <div className="lin-section">
          <LinRow
            label="Видалити акаунт"
            labelColor="#FF6B7A"
            value="незворотно"
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
