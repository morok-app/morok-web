/**
 * Local contacts + blocklist.
 *
 * Everything here is client-side only — the relay never sees your
 * contact graph or blocklist. That's intentional: knowing "Alice marked
 * Bob as a contact" is a real privacy leak we refuse to give the server.
 *
 * Contacts schema (localStorage 'morok.contacts.v1'):
 *   [
 *     {
 *       pubkey_hex: "abc...",        // canonical identifier
 *       username: "satoshi",         // last known (may go stale)
 *       home_relay: "relay1.morok.app",
 *       added_at: 1234567890,        // unix seconds
 *       nickname: "Сатоші сусід"     // optional local label
 *     },
 *     ...
 *   ]
 *
 * Blocked schema (localStorage 'morok.blocked.v1'):
 *   { [pubkey_hex]: { added_at: int } }
 *
 * Stored as a map so isBlocked() is O(1). Order doesn't matter for a
 * blocklist.
 *
 * The split between Sets in code and JSON in storage is on purpose —
 * JSON.parse gives us plain objects, and we only convert to Set when we
 * need fast existence checks (Block screen rebuilds them on each render).
 */

const K_CONTACTS = 'morok.contacts.v1';
const K_BLOCKED = 'morok.blocked.v1';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('contacts save failed:', e); }
}

// ─── Contacts ───────────────────────────────────────────────

/**
 * Return contacts sorted by added_at desc (newest first).
 * Stale entries (no pubkey_hex) are filtered.
 */
export function listContacts() {
  const arr = readJSON(K_CONTACTS, []);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c) => c && typeof c.pubkey_hex === 'string')
    .sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
}

export function getContact(pubkeyHex) {
  if (!pubkeyHex) return null;
  const arr = readJSON(K_CONTACTS, []);
  if (!Array.isArray(arr)) return null;
  return arr.find((c) => c.pubkey_hex === pubkeyHex) || null;
}

export function isContact(pubkeyHex) {
  return getContact(pubkeyHex) !== null;
}

/**
 * Add a contact, or update an existing one.
 *
 * If the pubkey already exists, fields are merged: any non-empty value
 * in the call overwrites the stored one. That way calling addContact
 * after a fresh /users/lookup naturally refreshes username + home_relay
 * without losing the user's local nickname.
 */
export function addContact({ pubkey_hex, username, home_relay, nickname }) {
  if (!pubkey_hex) return null;
  const arr = readJSON(K_CONTACTS, []);
  const list = Array.isArray(arr) ? arr : [];

  const idx = list.findIndex((c) => c.pubkey_hex === pubkey_hex);
  if (idx >= 0) {
    const existing = list[idx];
    list[idx] = {
      ...existing,
      username:    username    || existing.username    || null,
      home_relay:  home_relay  || existing.home_relay  || null,
      nickname:    nickname !== undefined ? nickname : existing.nickname,
    };
  } else {
    list.push({
      pubkey_hex,
      username:   username   || null,
      home_relay: home_relay || null,
      added_at:   Math.floor(Date.now() / 1000),
      nickname:   nickname || null,
    });
  }
  writeJSON(K_CONTACTS, list);
  return list[idx >= 0 ? idx : list.length - 1];
}

export function removeContact(pubkeyHex) {
  if (!pubkeyHex) return false;
  const arr = readJSON(K_CONTACTS, []);
  if (!Array.isArray(arr)) return false;
  const next = arr.filter((c) => c.pubkey_hex !== pubkeyHex);
  if (next.length === arr.length) return false;
  writeJSON(K_CONTACTS, next);
  return true;
}

export function updateContact(pubkeyHex, fields) {
  if (!pubkeyHex || !fields) return null;
  const arr = readJSON(K_CONTACTS, []);
  if (!Array.isArray(arr)) return null;
  const idx = arr.findIndex((c) => c.pubkey_hex === pubkeyHex);
  if (idx < 0) return null;
  arr[idx] = { ...arr[idx], ...fields };
  writeJSON(K_CONTACTS, arr);
  return arr[idx];
}

/**
 * Filter contacts by query (case-insensitive substring over username
 * and nickname). Empty query returns the full list.
 */
export function searchContacts(query) {
  const q = (query || '').trim().toLowerCase();
  const all = listContacts();
  if (!q) return all;
  return all.filter((c) => {
    if (c.username && c.username.toLowerCase().includes(q)) return true;
    if (c.nickname && c.nickname.toLowerCase().includes(q)) return true;
    return false;
  });
}

// ─── Blocked ────────────────────────────────────────────────

export function listBlocked() {
  const obj = readJSON(K_BLOCKED, {});
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj)
    .map(([pubkey_hex, meta]) => ({
      pubkey_hex,
      added_at: meta?.added_at || 0,
    }))
    .sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
}

export function isBlocked(pubkeyHex) {
  if (!pubkeyHex) return false;
  const obj = readJSON(K_BLOCKED, {});
  return !!(obj && typeof obj === 'object' && obj[pubkeyHex]);
}

/**
 * Block a peer. Also removes them from contacts if present — being
 * a contact and being blocked are mutually exclusive.
 */
export function blockPeer(pubkeyHex) {
  if (!pubkeyHex) return;
  const obj = readJSON(K_BLOCKED, {}) || {};
  obj[pubkeyHex] = { added_at: Math.floor(Date.now() / 1000) };
  writeJSON(K_BLOCKED, obj);
  // Cascade: remove from contacts list if present
  removeContact(pubkeyHex);
}

export function unblockPeer(pubkeyHex) {
  if (!pubkeyHex) return false;
  const obj = readJSON(K_BLOCKED, {});
  if (!obj || typeof obj !== 'object' || !obj[pubkeyHex]) return false;
  delete obj[pubkeyHex];
  writeJSON(K_BLOCKED, obj);
  return true;
}

// ─── Wipe (called from storage.wipeAll) ─────────────────────

export function wipeContactsAndBlocked() {
  try { localStorage.removeItem(K_CONTACTS); } catch {}
  try { localStorage.removeItem(K_BLOCKED); } catch {}
}
