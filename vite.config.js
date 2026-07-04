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
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: (mode === 'mobile' || process.env.TAURI_ENV_PLATFORM) ? './' : '/web/',
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
}));
