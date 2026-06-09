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

  // Кнопка "назад" Android. З власним слухачем поведінка передбачувана:
  // на кореневих екранах згортаємо застосунок (НЕ вбиваємо), на решті —
  // звичайний history.back() (працює, бо навігація hash-based).
  // Кореневі: чати (головний), онбордінг і PIN — з них "назад" нікуди.
  try {
    const { App: CapApp } = await import('@capacitor/app');
    const ROOT_SCREENS = new Set([
      '', 'splash', 'welcome', 'chats',
      'pin-unlock', 'pin-setup', 'pin-setup-existing',
    ]);
    CapApp.addListener('backButton', () => {
      const hash = (window.location.hash || '').replace(/^#/, '');
      const base = hash.split('/')[0].split('?')[0];
      if (ROOT_SCREENS.has(base)) {
        CapApp.minimizeApp().catch(() => {});
      } else if (window.history.length > 1) {
        window.history.back();
      } else {
        // Прямий deep-link без історії — йдемо в чати.
        window.location.hash = '#chats';
      }
    });
  } catch (e) {
    console.warn('App back-button init failed (non-fatal):', e);
  }

  // Сторожовий пес проти IME-скролу. Навіть з body{position:fixed}
  // деякі WebView вміють зсунути visual viewport при фокусі на input
  // і не повернути назад. Будь-який скрол документа = баг => відкат.
  const resetScroll = () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) {
      window.scrollTo(0, 0);
    }
    if (document.documentElement.scrollTop !== 0) {
      document.documentElement.scrollTop = 0;
    }
    if (document.body.scrollTop !== 0) {
      document.body.scrollTop = 0;
    }
  };
  window.addEventListener('scroll', resetScroll, { passive: true });
  // Після закриття клавіатури (blur будь-якого input) — теж відкат.
  document.addEventListener('focusout', () => setTimeout(resetScroll, 50), true);
}
