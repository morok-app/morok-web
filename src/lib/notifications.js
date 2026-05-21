/**
 * Notifications helper.
 *
 * Browser Notification API wrapper. User must opt-in via Settings.
 * Permission state cached so we don't spam permission prompts.
 *
 * Stored preference:
 *   morok.notif_enabled.v1 → "true" | "false"
 *
 * Permission is held by the browser separately — we only show
 * notifications if BOTH (a) user toggled on in Settings AND
 * (b) browser permission is "granted".
 */

const PREF_KEY = 'morok.notif_enabled.v1';

export function isPreferenceEnabled() {
  try {
    return localStorage.getItem(PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPreferenceEnabled(enabled) {
  try {
    localStorage.setItem(PREF_KEY, enabled ? 'true' : 'false');
  } catch {}
}

export function isSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getPermission() {
  if (!isSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

/**
 * Request permission from the browser. Returns final permission state.
 */
export async function requestPermission() {
  if (!isSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/**
 * Show a notification, only if:
 *  - browser supports
 *  - permission granted
 *  - user preference enabled
 *  - tab is not focused (don't notify while user is looking)
 */
export function notify({ title, body, onClick, peerPubkey }) {
  if (!isSupported()) return;
  if (Notification.permission !== 'granted') return;
  if (!isPreferenceEnabled()) return;
  // Suppress when tab is focused — user already sees it
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;

  try {
    const n = new Notification(title, {
      body,
      icon: '/web/icon-192.png',  // optional, if we ship one
      tag: peerPubkey ? `morok-${peerPubkey.slice(0, 16)}` : undefined,
      silent: true,
    });
    n.onclick = () => {
      window.focus();
      try { n.close(); } catch {}
      onClick?.();
    };
  } catch (e) {
    console.warn('Notification failed:', e);
  }
}
