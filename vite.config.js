import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` controls the public path prefix Vite stamps into index.html.
//
//   Web build (default):       base: '/web/'
//     Web is served at https://relay1.morok.app/web/ so assets live at
//     /web/assets/...
//
//   Mobile build (Capacitor):  base: './'
//     The APK serves index.html from https://localhost/index.html and
//     the assets sit at ./assets/... — using '/web/' would 404 inside
//     the WebView. Trigger with: `npm run build -- --mode mobile`.
//
//   Desktop build (Tauri):     base: './'
//     Tauri serves from tauri.localhost root, so absolute '/web/...'
//     paths 404 (black screen). Tauri CLI sets TAURI_ENV_PLATFORM
//     automatically during `tauri dev` / `tauri build`.
// CSP для ВЕБ-збірки (віддається з того ж origin, що й API релею, тож будь-яка
// XSS мала б доступ до localStorage). Лише в `vite build` для вебу: у dev
// Vite вставляє inline-скрипти (HMR), а Tauri має власну CSP у tauri.conf.json.
// frame-ancestors у meta не працює — його треба віддавати заголовком у nginx.
const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss: http://*.onion ws://*.onion",
  "frame-src 'self' data: blob:",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function webSecurityMeta(enabled) {
  return {
    name: 'morok-web-security-meta',
    apply: 'build',
    transformIndexHtml(html) {
      if (!enabled) return html;
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${WEB_CSP}" />\n    <meta name="referrer" content="no-referrer" />`,
      );
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), webSecurityMeta(mode !== 'mobile' && !process.env.TAURI_ENV_PLATFORM)],
  base: (mode === 'mobile' || process.env.TAURI_ENV_PLATFORM) ? './' : '/web/',
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
  // Morok: у production прибираємо console.* і debugger — у консоль
  // браузера/Tauri не мають потрапляти службові дані (id конвертів,
  // фрагменти помилок розшифровки). У dev логи лишаються.
  esbuild: mode === 'production' ? { drop: ['console', 'debugger'] } : {},
}));
