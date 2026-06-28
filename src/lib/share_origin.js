/**
 * share_origin.js — базовий URL для share-посилань (запрошення, бернери,
 * профіль). Повертає origin БЕЗ кінцевого слеша, напр. "https://relay1.morok.app".
 *
 * Посилання потім формуються як `${shareOrigin()}/web/#join?t=...`.
 *
 * Логіка:
 *   1. У браузері — поточний window.location.origin (те, з якого відкрито
 *      веб-клієнт). Так посилання завжди веде на той самий хост, де юзер.
 *   2. Фолбек (SSR / нестандартне середовище) — продакшн-хост relay1.
 */

const FALLBACK_ORIGIN = 'https://relay1.morok.app';

export function shareOrigin() {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      return window.location.origin.replace(/\/+$/, '');
    }
  } catch {
    /* ignore */
  }
  return FALLBACK_ORIGIN;
}

export default shareOrigin;
