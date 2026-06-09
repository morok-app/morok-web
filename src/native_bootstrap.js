/**
 * Native-platform bootstrap.
 *
 * Sets a `body.is-native` flag so the native-only CSS rules in
 * styles/native.css kick in, and configures Android status bar to
 * match Morok's dark theme (light icons on near-black background).
 *
 * No-ops on the web — safe to call unconditionally from main.jsx.
 */

const NATIVE_BACKGROUND = '#0A0A0B'; // matches every `.screen` background

function isNative() {
  if (typeof window === 'undefined') return false;
  return !!(
    window.Capacitor?.isNativePlatform?.() ||
    window.Capacitor?.isNative
  );
}

export async function initNative() {
  if (!isNative()) return;

  // Tag <body> so native.css rules apply (safe-area padding, system fonts,
  // disabled tap highlight, etc).
  try {
    document.body.classList.add('is-native');
  } catch { /* DOM not ready — caller already deferred this */ }

  // Status bar styling (Android). The plugin is imported lazily so the
  // web bundle stays unaffected — Vite tree-shakes the dynamic branch.
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // Light text+icons (because our app is dark).
    await StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    // Solid background colour matching the screen — no translucent overlay.
    await StatusBar.setBackgroundColor({ color: NATIVE_BACKGROUND }).catch(() => {});
    // Don't overlay the WebView — give us real space below the status bar.
    await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  } catch (e) {
    // Plugin missing or call failed — UI still works, just looks slightly
    // worse on the top edge.
    console.warn('StatusBar init failed (non-fatal):', e);
  }
}
