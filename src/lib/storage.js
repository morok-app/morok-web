/**
 * localStorage persistence.
 *
 * Day 1: seed stored in plaintext. PIN-encrypted in Day 4.
 */

const K_IDENTITY = 'morok.identity.v1';
const K_SESSION = 'morok.session.v1';
const K_PROFILE = 'morok.profile.v1';

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('localStorage write failed:', e); }
}

export function loadIdentity() { return readJSON(K_IDENTITY); }
export function saveIdentity({ seedHex, pubkeyHex, mnemonic }) {
  writeJSON(K_IDENTITY, {
    seed_hex: seedHex,
    pubkey_hex: pubkeyHex,
    mnemonic,
    created_at: Math.floor(Date.now() / 1000),
  });
}
export function clearIdentity() { localStorage.removeItem(K_IDENTITY); }

export function loadSession() { return readJSON(K_SESSION); }
export function saveSession({ token, pubkeyHex, expiresAt, relayUrl }) {
  writeJSON(K_SESSION, {
    token,
    pubkey_hex: pubkeyHex,
    expires_at: expiresAt,
    relay_url: relayUrl,
  });
}
export function clearSession() { localStorage.removeItem(K_SESSION); }

export function loadProfile() { return readJSON(K_PROFILE); }
export function saveProfile({ username, tier, homeRelay }) {
  writeJSON(K_PROFILE, { username, tier, home_relay: homeRelay });
}
export function clearProfile() { localStorage.removeItem(K_PROFILE); }

export function wipeAll() {
  clearIdentity();
  clearSession();
  clearProfile();
  localStorage.removeItem('morok.conv.v1');
}
