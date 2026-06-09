/**
 * Native-platform bootstrap.
 *
 * Ставить прапорець `body.is-native` (вмикає styles/native.css) і
 * налаштовує системні бари під темну тему Morok.
 *
 * ВАЖЛИВО (Android 15+ / targetSdk 36 / Capacitor 8):
 *  - edge-to-edge примусовий: StatusBar.setOverlaysWebView(false) і
 *    setBackgroundColor() — БІЛЬШЕ НЕ ПРАЦЮЮТЬ (no-op). Старий плагін
 *    @capacitor/status-bar тут не використовуємо.
 *  - Замість нього — вбудований у @capacitor/core плагін SystemBars.
 *    Він (разом із "insetsHandling": "css" у capacitor.config.json)
 *    інжектить --safe-area-inset-* CSS-змінні, на які спирається CSS.
 *
 * No-op у вебі — безпечно викликати з main.jsx завжди.
 */

function isNative() {
  if (typeof window === 'undefined') return false;
  return !!(
    window.Capacitor?.isNativePlatform?.() ||
    window.Capacitor?.isNative
  );
}

export async function initNative() {
  if (!isNative()) return;

  try {
    document.body.classList.add('is-native');
  } catch { /* DOM not ready — caller already deferred this */ }

  try {
    const { SystemBars, SystemBarsStyle } = await import('@capacitor/core');
    // Style.Dark = бари для ТЕМНОГО фону => світлі іконки/текст.
    await SystemBars.setStyle({ style: SystemBarsStyle.Dark }).catch(() => {});
  } catch (e) {
    console.warn('SystemBars init failed (non-fatal):', e);
  }
}
