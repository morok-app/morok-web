import { t, tp } from './i18n.js';
/**
 * Per-chat mute state.
 *
 * Stored in IndexedDB (not localStorage) so the Service Worker can read
 * it before showing a push notification — localStorage isn't accessible
 * from the SW context.
 *
 * Schema:
 *   db:     morok_muted, version 1
 *   store:  muted, keyPath 'key'
 *   record: { key: string, until: number | 'forever' }
 *
 * Key format:
 *   "dm:<username>"  — a DM. We key by username because that's what
 *                      arrives in the push payload from the relay; the
 *                      trade-off is that if the peer changes their
 *                      username, the mute drops. Acceptable.
 *   "group:<uuid>"   — a group, keyed by group_id which is stable.
 *
 * The Service Worker imports a subset of this (the `isChatMuted` logic)
 * inline as plain IDB code — don't break the schema without updating
 * sw.js too.
 */

const DB_NAME = 'morok_muted';
const DB_VERSION = 1;
const STORE = 'muted';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function dmKey(username) {
  return username ? `dm:${username}` : null;
}

export function groupKey(groupId) {
  return groupId ? `group:${groupId}` : null;
}

/**
 * Returns the current mute entry, or null. Auto-prunes expired entries
 * (calls unmute() in the background so list views are tidy).
 */
export async function getMute(chatKey) {
  if (!chatKey) return null;
  let db;
  try { db = await openDB(); } catch { return null; }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(chatKey);
    req.onsuccess = () => {
      const e = req.result;
      if (!e) { resolve(null); return; }
      // міграція: старі записи зберігали українське 'назавжди'
      if (e.until === 'forever' || e.until === 'назавжди') { resolve(e); return; }
      if (typeof e.until === 'number' && e.until > Date.now()) {
        resolve(e);
      } else {
        // Expired — fire-and-forget cleanup
        unmute(chatKey).catch(() => {});
        resolve(null);
      }
    };
    req.onerror = () => resolve(null);
  });
}

/**
 * True if chat is currently muted (helper for UI).
 */
export async function isMuted(chatKey) {
  const e = await getMute(chatKey);
  return e !== null;
}

/**
 * Mute a chat for `durationMs` (e.g. 60*60*1000 = 1h), or pass 'forever'
 * to mute indefinitely. Overwrites any existing entry.
 */
export async function setMute(chatKey, durationMs) {
  if (!chatKey) return;
  let db;
  try { db = await openDB(); } catch { return; }
  const until = durationMs === 'forever' ? 'forever' : (Date.now() + durationMs);
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.put({ key: chatKey, until });
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

export async function unmute(chatKey) {
  if (!chatKey) return;
  let db;
  try { db = await openDB(); } catch { return; }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.delete(chatKey);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

/**
 * List all muted entries (returns array of { key, until }).
 * Filters out expired entries and prunes them in the background.
 */
export async function listMuted() {
  let db;
  try { db = await openDB(); } catch { return []; }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      const now = Date.now();
      const valid = [];
      const expired = [];
      for (const e of all) {
        if (e.until === 'forever' || e.until === 'назавжди' || (typeof e.until === 'number' && e.until > now)) {
          valid.push(e);
        } else {
          expired.push(e.key);
        }
      }
      for (const k of expired) unmute(k).catch(() => {});
      resolve(valid);
    };
    req.onerror = () => resolve([]);
  });
}

export async function clearAllMuted() {
  let db;
  try { db = await openDB(); } catch { return; }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

// Common preset durations for UI dropdowns
export const MUTE_DURATIONS = [
  { label: t('1 hour'),   ms: 60 * 60 * 1000 },
  { label: t('8 hours'),    ms: 8 * 60 * 60 * 1000 },
  { label: t('1 day'),     ms: 24 * 60 * 60 * 1000 },
  { label: t('1 week'),  ms: 7 * 24 * 60 * 60 * 1000 },
  { label: t('Forever'),   ms: 'forever' },
];

/**
 * Human-readable time-left string.
 */
export function formatMuteUntil(until) {
  if (until === 'forever') return t('forever');
  const ms = until - Date.now();
  if (ms <= 0) return t('elapsed');
  const mins = Math.round(ms / 60000);
  if (mins < 60) return tp("{0} min", [mins]);
  const hours = Math.round(mins / 60);
  if (hours < 48) return tp("{0} h", [hours]);
  const days = Math.round(hours / 24);
  return tp("{0} d", [days]);
}
