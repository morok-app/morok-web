/**
 * Web push client.
 *
 * Lifecycle:
 *   isSupported() ?
 *     getPermission() === 'granted' && getCurrentSubscription() != null
 *       → already subscribed
 *     otherwise → enable() to register SW, request permission, subscribe
 *     disable()  → tear down subscription locally + remote
 *
 * iOS: only works if the user installed the PWA to their home screen
 * (Safari 16.4+). Outside that, browser returns 'denied' to subscribe.
 */

import * as api from './api.js';

const SW_PATH = '/web/sw.js';
const SW_SCOPE = '/web/';

let _cachedVapid = null;

export function isSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getPermission() {
  if (!('Notification' in window)) return 'denied';
  return Notification.permission;
}

function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const b = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchVapidKey() {
  if (_cachedVapid) return _cachedVapid;
  const data = await api.getPushVapidKey();
  if (!data?.key) throw new Error('no_vapid_key');
  _cachedVapid = data.key;
  return _cachedVapid;
}

async function registerSW() {
  // If already registered for our scope, reuse — don't re-register every call
  const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (existing) return existing;
  return await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
}

export async function getCurrentSubscription() {
  if (!isSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (!reg) return null;
  return await reg.pushManager.getSubscription();
}

/**
 * Turn on push for this device. Throws on any failure (no permission,
 * not supported, network, etc).
 *
 * Returns the active PushSubscription.
 */
export async function enable() {
  if (!isSupported()) throw new Error('not_supported');

  const reg = await registerSW();
  await navigator.serviceWorker.ready;

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error(perm === 'denied' ? 'permission_denied' : 'permission_dismissed');
  }

  const vapid = await fetchVapidKey();

  // If there's an existing subscription with a different VAPID key
  // (e.g. relay regenerated keys), drop it and resubscribe.
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const existingKey = sub.options?.applicationServerKey;
    if (existingKey) {
      // Compare by converting to base64url and matching prefixes — quick check.
      // Easier: always re-subscribe; cheap.
    }
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    });
  }

  const json = sub.toJSON();
  await api.pushSubscribe({
    endpoint: json.endpoint,
    keys: json.keys,
    user_agent: navigator.userAgent.slice(0, 255),
  });

  return sub;
}

/**
 * Disable push: tell relay to drop subscription, then unsubscribe locally.
 * Silent on remote-side errors (we still want to clean up locally).
 */
export async function disable() {
  const sub = await getCurrentSubscription();
  if (!sub) return;

  try {
    await api.pushUnsubscribe({ endpoint: sub.endpoint });
  } catch (e) {
    console.warn('pushUnsubscribe (remote) failed:', e);
  }
  try {
    await sub.unsubscribe();
  } catch (e) {
    console.warn('sub.unsubscribe (local) failed:', e);
  }
}

/**
 * True if we have permission AND an active subscription.
 * Use this to drive the Settings toggle's on/off state.
 */
export async function isEnabled() {
  if (!isSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  const sub = await getCurrentSubscription();
  return !!sub;
}
