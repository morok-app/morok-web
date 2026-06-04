/**
 * Contacts — two distinct things in one module:
 *
 * 1. Address book (`morok.contacts.v1`):
 *    An automatic cache of every user we have ever looked up,
 *    encountered in a chat, or otherwise had a (pubkey, username,
 *    home_relay) tuple for. Used by NewChat for "recent users"
 *    suggestions and by DMS to render recipient names.
 *    upsert/getByPubkey/findByUsername/listContacts operate on this.
 *
 * 2. Explicit contacts (`morok.contacts_explicit.v1`):
 *    A user-curated list — "people I deliberately marked as a contact".
 *    Has nicknames. Shown on the ContactsList screen.
 *    addToContacts / removeFromContacts / isInContacts /
 *    listExplicitContacts operate on this.
 *
 * They share pubkeys (an explicit contact is by definition in the
 * address book too), but they are stored separately so the auto-cache
 * never silently grows the user's "Contacts" list.
 *
 * 3. Blocklist (`morok.blocked.v1`):
 *    Pubkeys the user has blocked. Adding to blocklist cascades a
 *    remove-from-explicit-contacts (mutually exclusive states).
 *
 * Everything here is client-side only — the relay never sees your
 * contact graph, your nicknames, or your blocklist.
 */

const K_CONTACTS = 'morok.contacts.v1';            // address book (auto-cache)
const K_EXPLICIT = 'morok.contacts_explicit.v1';   // user-curated contacts
const K_BLOCKED  = 'morok.blocked.v1';

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

// ════════════════════════════════════════════════════════════
// ADDRESS BOOK (auto-cached) — used by NewChat, DMSList, DMSDetail
// ════════════════════════════════════════════════════════════

/**
 * Insert or merge a contact into the address book.
 *
 * If a row with this pubkey already exists, its fields are merged: any
 * non-empty value in the call overwrites the stored one. So calling
 * upsert after a fresh /users/lookup naturally refreshes username and
 * home_relay without clobbering them with null.
 *
 * Returns the resulting row (with pubkey_hex, username, home_relay,
 * added_at).
 */
export function upsert({ pubkey_hex, username, home_relay } = {}) {
  if (!pubkey_hex) return null;
  const arr = readJSON(K_CONTACTS, []);
  const list = Array.isArray(arr) ? arr : [];

  const idx = list.findIndex((c) => c && c.pubkey_hex === pubkey_hex);
  if (idx >= 0) {
    const existing = list[idx];
    const merged = {
      ...existing,
      username:   username   || existing.username   || null,
      home_relay: home_relay || existing.home_relay || null,
    };
    list[idx] = merged;
    writeJSON(K_CONTACTS, list);
    return merged;
  }
  const row = {
    pubkey_hex,
    username:   username   || null,
    home_relay: home_relay || null,
    added_at:   Math.floor(Date.now() / 1000),
  };
  list.push(row);
  writeJSON(K_CONTACTS, list);
  return row;
}

/**
 * Return the address-book row for a pubkey, or null.
 */
export function getByPubkey(pubkeyHex) {
  if (!pubkeyHex) return null;
  const arr = readJSON(K_CONTACTS, []);
  if (!Array.isArray(arr)) return null;
  return arr.find((c) => c && c.pubkey_hex === pubkeyHex) || null;
}

/**
 * Find a row by username, optionally constrained to a specific
 * home_relay. Returns the row or null. Case-insensitive on username.
 */
export function findByUsername(username, relay) {
  if (!username) return null;
  const u = String(username).trim().toLowerCase();
  if (!u) return null;
  const arr = readJSON(K_CONTACTS, []);
  if (!Array.isArray(arr)) return null;
  return arr.find((c) => {
    if (!c || !c.username) return false;
    if (c.username.toLowerCase() !== u) return false;
    if (relay && c.home_relay && c.home_relay !== relay) return false;
    return true;
  }) || null;
}

/**
 * Return the entire address book, sorted newest-first.
 */
export function listContacts() {
  const arr = readJSON(K_CONTACTS, []);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c) => c && typeof c.pubkey_hex === 'string')
    .sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
}

// ════════════════════════════════════════════════════════════
// EXPLICIT CONTACTS (user-curated) — used by ContactsList, PeerProfile
// ════════════════════════════════════════════════════════════

/**
 * Storage shape:
 *   { [pubkey_hex]: { added_at: int, nickname: string|null } }
 *
 * A map rather than an array so existence/removal is O(1) and we don't
 * accidentally duplicate.
 */

function readExplicit() {
  const obj = readJSON(K_EXPLICIT, {});
  return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
}

/**
 * True if the pubkey is on the user's explicit contacts list.
 */
export function isInContacts(pubkeyHex) {
  if (!pubkeyHex) return false;
  return !!readExplicit()[pubkeyHex];
}

/**
 * Add (or refresh) a pubkey on the explicit contacts list.
 *
 * This also upserts the user into the address book — being an explicit
 * contact implies being known to the address book.
 *
 * If a nickname is passed, it overwrites any previous nickname. To
 * keep the existing nickname unchanged, omit the field.
 */
export function addToContacts({ pubkey_hex, username, home_relay, nickname } = {}) {
  if (!pubkey_hex) return null;
  // Cascade into address book so views relying on it (NewChat suggestions)
  // see the new contact even if we got here without going through lookup.
  upsert({ pubkey_hex, username, home_relay });

  const ex = readExplicit();
  const existing = ex[pubkey_hex] || {};
  ex[pubkey_hex] = {
    added_at: existing.added_at || Math.floor(Date.now() / 1000),
    nickname: nickname !== undefined ? (nickname || null) : (existing.nickname || null),
  };
  writeJSON(K_EXPLICIT, ex);
  return getExplicitView(pubkey_hex);
}

export function removeFromContacts(pubkeyHex) {
  if (!pubkeyHex) return false;
  const ex = readExplicit();
  if (!ex[pubkeyHex]) return false;
  delete ex[pubkeyHex];
  writeJSON(K_EXPLICIT, ex);
  return true;
}

/**
 * Set or clear a nickname for an explicit contact. Passing an empty
 * string or null clears it.
 */
export function updateContactNickname(pubkeyHex, nickname) {
  if (!pubkeyHex) return null;
  const ex = readExplicit();
  if (!ex[pubkeyHex]) return null;
  ex[pubkeyHex].nickname = nickname ? String(nickname).slice(0, 80) : null;
  writeJSON(K_EXPLICIT, ex);
  return getExplicitView(pubkeyHex);
}

/**
 * Internal: build the merged view (explicit metadata + address-book row)
 * for a single pubkey.
 */
function getExplicitView(pubkeyHex) {
  const meta = readExplicit()[pubkeyHex];
  if (!meta) return null;
  const book = getByPubkey(pubkeyHex);
  return {
    pubkey_hex: pubkeyHex,
    username:   book?.username   || null,
    home_relay: book?.home_relay || null,
    added_at:   meta.added_at,
    nickname:   meta.nickname || null,
  };
}

/**
 * Return all explicit contacts, newest-first, merged with address-book
 * data so the caller has username + home_relay alongside the nickname.
 */
export function listExplicitContacts() {
  const ex = readExplicit();
  return Object.keys(ex)
    .map((pk) => getExplicitView(pk))
    .filter((v) => v !== null)
    .sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
}

/**
 * Substring search over username and nickname (case-insensitive).
 * Empty query returns the full explicit list.
 */
export function searchExplicitContacts(query) {
  const q = (query || '').trim().toLowerCase();
  const all = listExplicitContacts();
  if (!q) return all;
  return all.filter((c) => {
    if (c.username && c.username.toLowerCase().includes(q)) return true;
    if (c.nickname && c.nickname.toLowerCase().includes(q)) return true;
    return false;
  });
}

// ════════════════════════════════════════════════════════════
// BLOCKLIST
// ════════════════════════════════════════════════════════════

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
 * Block a peer. Cascades: explicit contact (if any) is removed —
 * being blocked and being in contacts are mutually exclusive.
 */
export function blockPeer(pubkeyHex) {
  if (!pubkeyHex) return;
  const obj = readJSON(K_BLOCKED, {}) || {};
  obj[pubkeyHex] = { added_at: Math.floor(Date.now() / 1000) };
  writeJSON(K_BLOCKED, obj);
  removeFromContacts(pubkeyHex);
}

export function unblockPeer(pubkeyHex) {
  if (!pubkeyHex) return false;
  const obj = readJSON(K_BLOCKED, {});
  if (!obj || typeof obj !== 'object' || !obj[pubkeyHex]) return false;
  delete obj[pubkeyHex];
  writeJSON(K_BLOCKED, obj);
  return true;
}

// ════════════════════════════════════════════════════════════
// Wipe — invoked from storage.wipeAll()
// ════════════════════════════════════════════════════════════

export function wipeContactsAndBlocked() {
  try { localStorage.removeItem(K_CONTACTS); } catch {}
  try { localStorage.removeItem(K_EXPLICIT); } catch {}
  try { localStorage.removeItem(K_BLOCKED); } catch {}
}
