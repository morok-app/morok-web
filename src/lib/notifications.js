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
const SOUND_KEY = 'morok.notif_sound.v1';

// ── Звук нового повідомлення ──
// Синтезований делікатний "пік" через Web Audio (без аудіофайлів).
// Окремий тумблер від браузерних нотифікацій; за замовчуванням вимкнено.
// Троттл 2с, щоб пачка повідомлень не перетворювалась на кулемет.

export function isSoundEnabled() {
  try { return localStorage.getItem(SOUND_KEY) === 'true'; } catch { return false; }
}

export function setSoundEnabled(enabled) {
  try { localStorage.setItem(SOUND_KEY, enabled ? 'true' : 'false'); } catch {}
}

let _audioCtx = null;
let _lastBeepAt = 0;

export function playMessageSound() {
  if (!isSoundEnabled()) return;
  const now = Date.now();
  if (now - _lastBeepAt < 2000) return;      // троттл
  _lastBeepAt = now;
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    const t0 = ctx.currentTime;
    // Два коротких м'які тони (мажорна терція) — делікатно, не "дзинь-базар".
    for (const [freq, start] of [[740, 0], [932, 0.09]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + start);
      gain.gain.linearRampToValueAtTime(0.08, t0 + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + 0.25);
    }
  } catch { /* звук — не критично */ }
}

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
  // Звук — незалежно від видимості вкладки (нове повідомлення може
  // прийти в ІНШИЙ чат, поки ти дивишся на цей). Троттл усередині.
  playMessageSound();

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
