/**
 * Анти-повтор вхідних конвертів за підписом відправника.
 *
 * envelope_id видає релей, тож дедуп лише по ньому не захищає від
 * повторної доставки старого конверта під новим id. Підпис ставить
 * відправник; той самий підпис = той самий конверт.
 *
 * У пам'яті — Set (швидкий пошук), на диск — пакетно, не частіше ніж раз
 * на ~1 с: catch-up на сотні конвертів не має переписувати список щоразу.
 */

const SEEN_SIGS_KEY = 'morok.seen_sigs.v1';
const SEEN_SIGS_MAX = 5000;
let _list = null;
let _set = null;
let _flushTimer = null;

function load() {
  if (_set) return;
  let arr = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_SIGS_KEY) || '[]');
    if (Array.isArray(parsed)) arr = parsed;
  } catch { /* ignore */ }
  _list = arr.slice(-SEEN_SIGS_MAX);
  _set = new Set(_list);
}

function flush() {
  _flushTimer = null;
  try { localStorage.setItem(SEEN_SIGS_KEY, JSON.stringify(_list || [])); } catch { /* ignore */ }
}

function idOf(sigHex) { return String(sigHex || '').slice(0, 32); }

export function seen(sigHex) {
  load();
  return _set.has(idOf(sigHex));
}

export function remember(sigHex) {
  load();
  const id = idOf(sigHex);
  if (_set.has(id)) return;
  _list.push(id);
  _set.add(id);
  if (_list.length > SEEN_SIGS_MAX) {
    const drop = _list.splice(0, _list.length - SEEN_SIGS_MAX);
    for (const d of drop) _set.delete(d);
  }
  if (!_flushTimer) _flushTimer = setTimeout(flush, 1000);
}

/** Забути підпис — коли обробку відкладено (__retry) і конверт прийде знову. */
export function forget(sigHex) {
  load();
  const id = idOf(sigHex);
  if (!_set.has(id)) return;
  _set.delete(id);
  const i = _list.lastIndexOf(id);
  if (i >= 0) _list.splice(i, 1);
  if (!_flushTimer) _flushTimer = setTimeout(flush, 1000);
}

/** Скинути кеш у пам'яті (після wipe сховища). */
export function reset() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  _list = null; _set = null;
}

// Годинник телефона може відставати/поспішати відносно релею. Релей
// сам не приймає конверти з ts поза ±5 хв, тож тут лише відсікаємо
// явно протухлі (повтор старого) з великим запасом на розбіжність часу.
const CLOCK_SKEW_TOLERANCE_S = 6 * 3600;

/** Чи конверт ще не протух за ПІДПИСАНИМИ ts/ttl (із запасом на годинник). */
export function isFresh(ts, ttl, nowS = Math.floor(Date.now() / 1000)) {
  if (!Number.isInteger(ts) || !Number.isInteger(ttl) || ttl <= 0) return false;
  return ts + ttl + CLOCK_SKEW_TOLERANCE_S >= nowS;
}
