/**
 * localStorage persistence.
 *
 * As of Day 4, identity can be stored in two modes:
 *
 *   1. UNLOCKED (legacy, pre-PIN users):
 *      { seed_hex, pubkey_hex, mnemonic, created_at }
 *      Anyone with DevTools can read the seed. Pre-PIN flow stays this
 *      way until the user explicitly sets up a PIN.
 *
 *   2. PIN-LOCKED:
 *      { encrypted: true, blob_b64, pubkey_hex, mnemonic_b64,
 *        created_at }
 *      Seed is XChaCha20-Poly1305 encrypted with PIN-derived key.
 *      Mnemonic is also encrypted (so it doesn't leak the recovery
 *      phrase). pubkey_hex is plaintext — needed for auto-login flow.
 */

const K_IDENTITY = 'morok.identity.v1';
const K_SESSION = 'morok.session.v1';
const K_PROFILE = 'morok.profile.v1';
const K_BACKUP_HAS = 'morok.backup_has.v1';
const K_PREFS = 'morok.prefs.v1';

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

// ── Identity ─────────────────────────────────────────────────

export function loadIdentity() { return readJSON(K_IDENTITY); }

export function saveIdentityUnlocked({ seedHex, pubkeyHex, mnemonic }) {
  writeJSON(K_IDENTITY, {
    encrypted: false,
    seed_hex: seedHex,
    pubkey_hex: pubkeyHex,
    mnemonic,
    created_at: Math.floor(Date.now() / 1000),
  });
}

export function saveIdentityLocked({ blobB64, mnemonicBlobB64, pubkeyHex }) {
  const existing = loadIdentity();
  writeJSON(K_IDENTITY, {
    encrypted: true,
    blob_b64: blobB64,
    mnemonic_b64: mnemonicBlobB64,
    pubkey_hex: pubkeyHex,
    created_at: existing?.created_at || Math.floor(Date.now() / 1000),
  });
}

export function isIdentityEncrypted() {
  const id = loadIdentity();
  return !!(id && id.encrypted === true);
}

export function clearIdentity() { localStorage.removeItem(K_IDENTITY); }

// ── Session ──────────────────────────────────────────────────

export function loadSession() { return readJSON(K_SESSION); }
// ПРИВАТНІСТЬ: bearer-токен сесії НЕ зберігаємо на диск. Застосунок на
// кожному старті логіниться заново з сіда (challenge-response у
// loginAndRoute → api.login), тож постійний токен у localStorage не
// потрібен ЖОДНОМУ шляху коду (loadSession ніде не викликається), а
// відкритий 7-денний токен на диску — зайвий вектор (розширення,
// фізичний доступ). Лишаємо тільки нечутливі метадані.
// token приймаємо в аргументах заради сумісності сигнатури, але не пишемо.
export function saveSession({ token, pubkeyHex, expiresAt, relayUrl }) {
  void token;
  writeJSON(K_SESSION, {
    pubkey_hex: pubkeyHex,
    expires_at: expiresAt,
    relay_url: relayUrl,
  });
}
export function clearSession() { localStorage.removeItem(K_SESSION); }

// ── Profile ──────────────────────────────────────────────────

export function loadProfile() { return readJSON(K_PROFILE); }
export function saveProfile({ username, tier, homeRelay, pubkeyHex }) {
  writeJSON(K_PROFILE, {
    username,
    tier,
    home_relay: homeRelay,
    pubkey_hex: pubkeyHex,
  });
}
export function clearProfile() { localStorage.removeItem(K_PROFILE); }

// ── Backup status (just a flag — actual blob is on server) ───

export function loadBackupHas() { return readJSON(K_BACKUP_HAS); }
export function saveBackupHas({ has, updatedAt }) {
  writeJSON(K_BACKUP_HAS, { has, updated_at: updatedAt });
}
export function clearBackupHas() { localStorage.removeItem(K_BACKUP_HAS); }

// ── Preferences (toggles in Settings) ─────────────────────────

export function getPreference(key, defaultValue) {
  const prefs = readJSON(K_PREFS) || {};
  return key in prefs ? prefs[key] : defaultValue;
}

export function setPreference(key, value) {
  const prefs = readJSON(K_PREFS) || {};
  prefs[key] = value;
  writeJSON(K_PREFS, prefs);
}

export function clearPreferences() { localStorage.removeItem(K_PREFS); }

// ── Wipe ─────────────────────────────────────────────────────

export function wipeAll() {
  clearIdentity();
  clearSession();
  clearProfile();
  clearBackupHas();
  clearPreferences();
  localStorage.removeItem('morok.conv.v1');
  localStorage.removeItem('morok.contacts.v1');
  localStorage.removeItem('morok.blocked.v1');
  localStorage.removeItem('morok.pin_lockout.v1');
  localStorage.removeItem('morok.pin_session.v1');
  // muted chats live in IndexedDB (so the SW can read them) — best-effort drop.
  try {
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('morok_muted');
  if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('morok_mail');
  } catch { /* ignore */ }
}
