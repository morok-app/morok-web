/**
 * attention.js — чи людина справді дивиться на застосунок.
 *
 * Навіщо: відкритий чат у фоновій вкладці або у вікні Windows-версії,
 * схованому в трей, позначав нові повідомлення прочитаними. Через це
 * співрозмовник бачив «прочитано», а таймер «зникнення після прочитання»
 * запускався, хоча ніхто нічого не бачив.
 *
 *   Браузер: вкладка видима (вікно поруч з іншим — теж «дивиться»).
 *   Windows (Tauri): ще й вікно у фокусі — WebView2 не завжди повідомляє
 *   про сховане в трей вікно через visibilitychange.
 *   Застосунок заблокований (екран PIN) — теж «не дивиться».
 */

import { getUnlockedSeed } from './vault.js';
import { loadIdentity } from './storage.js';

export const isTauri = typeof window !== 'undefined' && !!(
  window.__TAURI__ || window.__TAURI_INTERNALS__ ||
  /^tauri:/.test(window.location?.protocol || '') ||
  (window.location?.protocol === 'http:' && window.location?.hostname === 'tauri.localhost')
);

function isLocked() {
  try { return !!loadIdentity()?.encrypted && !getUnlockedSeed(); } catch { return false; }
}

/** Вікно застосунку на екрані (без огляду на блокування). */
export function isWindowActive() {
  if (typeof document === 'undefined') return true;
  if (document.visibilityState === 'hidden') return false;
  if (isTauri && typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
  return true;
}

/** Людина бачить чати: вікно на екрані і застосунок не на екрані PIN. */
export function isUserLooking() {
  return isWindowActive() && !isLocked();
}

/**
 * Викликати fn, коли людина повернулась до застосунку. Повертає відписку.
 * Відкладено на наступний тік: на тій самій події App може заблокувати
 * застосунок (автоблокування) — тоді нічого не позначаємо прочитаним.
 */
export function onAttention(fn) {
  const h = () => { setTimeout(() => { if (isUserLooking()) fn(); }, 0); };
  document.addEventListener('visibilitychange', h);
  window.addEventListener('focus', h);
  return () => {
    document.removeEventListener('visibilitychange', h);
    window.removeEventListener('focus', h);
  };
}
