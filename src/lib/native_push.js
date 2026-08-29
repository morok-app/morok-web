/**
 * Нативні push-сповіщення (FCM) для Capacitor APK.
 *
 * Web Push API не існує в Android WebView — тому в нативі працює FCM
 * через @capacitor/push-notifications. Релей зберігає FCM-токен поряд
 * з web push підписками (platform='fcm') і шле через Firebase HTTP v1.
 *
 * ПРИВАТНІСТЬ: FCM-payload читається Google, тому релей кладе туди
 * ТІЛЬКИ generic "New message" — без відправника, без group_id,
 * без жодних метаданих. (Web push інакший: там payload шифрується
 * end-to-end до браузера, RFC 8291.)
 */
import * as api from './api.js';
import { t } from './i18n.js';

const TOKEN_KEY = 'morok.push.fcm_token.v1';

export function isNativePlatform() {
  return !!window.Capacitor?.isNativePlatform?.();
}

async function plugin() {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  // НЕ повертати проксі плагіна напряму з async-функції! await робить
  // thenable-перевірку (.then) на значенні, а Capacitor-проксі
  // перетворює це на виклик нативного метода "then", якого не існує
  // ("PushNotifications.then() is not implemented on android").
  // Тому загортаємо в звичайний об'єкт.
  return { P: PushNotifications };
}

/**
 * Android 8+: сповіщення без існуючого каналу може просто не
 * показатись. Релей шле з channel_id="messages" — створюємо його
 * (ідемпотентно) перед будь-якою реєстрацією.
 */
async function ensureChannel(P) {
  try {
    // id v2: налаштування каналу Android фіксує ПРИ ПЕРШОМУ створенні
    // і далі ігнорує зміни. Якщо 'messages' встиг створитися з тихими
    // дефолтами (система creates канал сама при першій доставці),
    // врятувати його не можна — тільки новий id.
    await P.createChannel({
      id: 'messages_v2',
      name: t('Message'),
      description: t('New Morok messages'),
      importance: 4,          // HIGH: звук + heads-up банер
      visibility: 0,          // PRIVATE: без тексту на лок-скріні
      vibration: true,
      lights: true,
    });
    // Прибираємо старий канал, щоб не висів дублем у налаштуваннях.
    try { await P.deleteChannel({ id: 'messages' }); } catch { /* не було — ок */ }
  } catch { /* iOS/старі версії — каналів нема, ок */ }
}

/** Дозвіл уже надано? ('granted' | 'denied' | 'prompt') */
export async function permissionState() {
  try {
    const { P } = await plugin();
    const st = await P.checkPermissions();
    return st.receive || 'prompt';
  } catch {
    return 'prompt';
  }
}

export function storedToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

function storeToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

/** Чи увімкнено push на цьому пристрої (токен є + дозвіл granted). */
export async function isEnabled() {
  if (!storedToken()) return false;
  return (await permissionState()) === 'granted';
}

/**
 * Увімкнути нативні пуші: дозвіл -> реєстрація в FCM -> токен -> релей.
 * Кидає 'permission_denied' якщо користувач відмовив.
 */
export async function enable() {
  const { P } = await plugin();
  await ensureChannel(P);

  const perm = await P.requestPermissions();
  if (perm.receive !== 'granted') {
    throw new Error('permission_denied');
  }

  const token = await new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error('fcm_timeout')); }
    }, 20000);
    P.addListener('registration', (t) => {
      if (!done) { done = true; clearTimeout(timer); resolve(t.value); }
    });
    P.addListener('registrationError', (e) => {
      if (!done) {
        done = true; clearTimeout(timer);
        reject(new Error(e?.error || 'fcm_registration_failed'));
      }
    });
    P.register().catch((e) => {
      if (!done) { done = true; clearTimeout(timer); reject(e); }
    });
  });

  await api.pushSubscribeNative({
    token,
    user_agent: (navigator.userAgent || '').slice(0, 255),
  });
  storeToken(token);
  return token;
}

/** Вимкнути: зняти токен з релея і забути локально. */
export async function disable() {
  const token = storedToken();
  if (token) {
    try { await api.pushUnsubscribeNative({ token }); }
    catch (e) { console.warn('unsubscribe-native failed:', e); }
  }
  storeToken(null);
  try {
    const { P } = await plugin();
    await P.unregister?.();
  } catch { /* старі версії плагіна без unregister — ок */ }
}

/**
 * Виклик при старті застосунку (після розблокування, коли є сесія):
 * якщо пуші були увімкнені — пере-реєструємось, бо FCM іноді ротує
 * токени. Якщо токен змінився, релей отримує новий, старий помре
 * сам (UNREGISTERED при першій відправці -> релей видалить рядок).
 */
export async function refreshIfEnabled() {
  if (!isNativePlatform()) return;
  if (!storedToken()) return;
  if ((await permissionState()) !== 'granted') return;
  try {
    const { P } = await plugin();
    await ensureChannel(P);
    P.addListener('registration', async (t) => {
      if (t.value && t.value !== storedToken()) {
        try {
          await api.pushSubscribeNative({
            token: t.value,
            user_agent: (navigator.userAgent || '').slice(0, 255),
          });
          storeToken(t.value);
        } catch (e) { console.warn('token refresh re-subscribe failed:', e); }
      }
    });
    await P.register();
  } catch (e) {
    console.warn('push refresh failed (non-fatal):', e);
  }
}
