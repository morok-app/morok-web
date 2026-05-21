/**
 * Local contacts cache.
 *
 * When we look up a user (locally or via federation), cache the result
 * so we don't re-query the relay each time. Persist in localStorage.
 *
 * Schema:
 *   morok.contacts.v1 → {
 *     [pubkey_hex]: {
 *       pubkey_hex, username, home_relay, added_at
 *     }
 *   }
 *
 * Also index by username (case-insensitive) for fast reverse lookup.
 */

const K = 'morok.contacts.v1';

function load() {
  try {
    const raw = localStorage.getItem(K);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function save(state) {
  try { localStorage.setItem(K, JSON.stringify(state)); }
  catch (e) { console.warn('contacts save failed', e); }
}

export function listContacts() {
  return Object.values(load())
    .sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
}

export function getByPubkey(pubkey_hex) {
  const state = load();
  return state[pubkey_hex] || null;
}

/**
 * Find a contact by username, optionally restricting to a specific relay.
 * Returns null if not found. Case-insensitive match.
 */
export function findByUsername(username, relayHostname) {
  const target = (username || '').toLowerCase();
  const state = load();
  for (const c of Object.values(state)) {
    if ((c.username || '').toLowerCase() !== target) continue;
    if (relayHostname && c.home_relay !== relayHostname) continue;
    return c;
  }
  return null;
}

export function upsert({ pubkey_hex, username, home_relay }) {
  const state = load();
  const existing = state[pubkey_hex];
  state[pubkey_hex] = {
    pubkey_hex,
    username: username || existing?.username || null,
    home_relay: home_relay || existing?.home_relay || null,
    added_at: existing?.added_at || Math.floor(Date.now() / 1000),
  };
  save(state);
  return state[pubkey_hex];
}

export function remove(pubkey_hex) {
  const state = load();
  delete state[pubkey_hex];
  save(state);
}

export function clear() {
  localStorage.removeItem(K);
}
