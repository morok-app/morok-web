/**
 * inflight.js — облік операцій, що зараз пишуть у сховище (надсилання,
 * обробка вхідних). Перед перемиканням акаунта на пристрої («друге дно»)
 * чекаємо, поки вони завершаться: інакше повідомлення, що надсилалося з
 * основного акаунта, могло б дописатися вже в сховище другого дна.
 */

let _busy = 0;
let _waiters = [];

export function track(fn) {
  _busy += 1;
  let p;
  try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
  return p.finally(() => {
    _busy -= 1;
    if (_busy === 0) { const w = _waiters; _waiters = []; w.forEach((r) => r()); }
  });
}

/** Дочекатися, поки все в польоті завершиться (не довше timeoutMs). */
export function whenIdle(timeoutMs = 8000) {
  if (_busy === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    _waiters.push(() => { clearTimeout(t); resolve(true); });
  });
}

export function busyCount() { return _busy; }
