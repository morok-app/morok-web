/**
 * Vault — PIN/passphrase-based encryption of the seed.
 *
 * KDF: PBKDF2-SHA256, 200K iterations, 16-byte random salt.
 * Cipher: XChaCha20-Poly1305 (same as our message encryption).
 *
 * For the LOCAL PIN (6 digits) we accept the weakness — 6 digits is fast
 * to brute force offline. Compensating measures:
 *   - Hard rate-limit on PIN entry attempts: 5 wrong → 30s lockout, then
 *     5 wrong → 5min, then 5 wrong → 1h. Persistent across reloads.
 *   - User explicitly informed that 24-word mnemonic remains the only
 *     trustworthy recovery path.
 *
 * For the OPTIONAL PASSPHRASE (server backup) we require 12+ chars. The
 * passphrase strength is the entire backup security model — there's
 * nothing else protecting that ciphertext on the relay.
 *
 * Format of a vault blob (base64):
 *   salt(16) ‖ nonce(24) ‖ ciphertext+tag
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { utf8, bytesToBase64, base64ToBytes } from './crypto.js';

const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 24;

/**
 * Derive a 32-byte key from PIN/passphrase using PBKDF2-SHA256.
 */
function deriveKey(secret, salt) {
  return pbkdf2(sha256, utf8(secret), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  });
}

/**
 * Encrypt arbitrary bytes (e.g. the seed) with a PIN/passphrase.
 * Returns base64 string with embedded salt+nonce.
 */
export function encryptWithSecret(plaintextBytes, secret) {
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = deriveKey(secret, salt);
  const cipher = xchacha20poly1305(key, nonce);
  const ct = cipher.encrypt(plaintextBytes);

  const out = new Uint8Array(SALT_BYTES + NONCE_BYTES + ct.length);
  out.set(salt, 0);
  out.set(nonce, SALT_BYTES);
  out.set(ct, SALT_BYTES + NONCE_BYTES);
  return bytesToBase64(out);
}

/**
 * Decrypt bytes that were encrypted with encryptWithSecret().
 * Returns Uint8Array of plaintext, or throws on bad PIN/tampered ciphertext.
 */
export function decryptWithSecret(blobB64, secret) {
  const raw = base64ToBytes(blobB64);
  if (raw.length < SALT_BYTES + NONCE_BYTES + 16) {
    throw new Error('blob too short');
  }
  const salt = raw.slice(0, SALT_BYTES);
  const nonce = raw.slice(SALT_BYTES, SALT_BYTES + NONCE_BYTES);
  const ct = raw.slice(SALT_BYTES + NONCE_BYTES);
  const key = deriveKey(secret, salt);
  const cipher = xchacha20poly1305(key, nonce);
  return cipher.decrypt(ct);  // throws if tag invalid
}

// ─────────────────────────────────────────────────────────────
// PIN-specific helpers
// ─────────────────────────────────────────────────────────────

/**
 * Encrypt the Ed25519 seed with a 6-digit PIN. Returns base64 blob.
 */
export function lockSeedWithPin(seedBytes, pin) {
  return encryptWithSecret(seedBytes, pin);
}

/**
 * Decrypt a seed using the PIN. Returns Uint8Array of 32 bytes.
 * Throws on wrong PIN.
 */
export function unlockSeedWithPin(blobB64, pin) {
  return decryptWithSecret(blobB64, pin);
}

// ─────────────────────────────────────────────────────────────
// Lockout against brute-force on local PIN
// ─────────────────────────────────────────────────────────────

const LOCKOUT_KEY = 'morok.pin_lockout.v1';

// Number of attempts before each cooldown step. Steps in seconds.
const LOCKOUT_STEPS = [
  { wrong: 5, cooldown_s: 30 },
  { wrong: 5, cooldown_s: 5 * 60 },
  { wrong: 5, cooldown_s: 60 * 60 },
  { wrong: 5, cooldown_s: 24 * 60 * 60 },
];

function loadLockout() {
  try {
    const raw = localStorage.getItem(LOCKOUT_KEY);
    return raw ? JSON.parse(raw) : { wrong_count: 0, locked_until: 0, step: 0 };
  } catch {
    return { wrong_count: 0, locked_until: 0, step: 0 };
  }
}

function saveLockout(state) {
  try { localStorage.setItem(LOCKOUT_KEY, JSON.stringify(state)); } catch {}
}

export function getLockoutStatus() {
  const s = loadLockout();
  const now = Math.floor(Date.now() / 1000);
  if (s.locked_until > now) {
    return { locked: true, until: s.locked_until, remaining_s: s.locked_until - now };
  }
  return { locked: false, wrong_count: s.wrong_count };
}

export function recordWrongPin() {
  const s = loadLockout();
  s.wrong_count = (s.wrong_count || 0) + 1;
  const step = LOCKOUT_STEPS[Math.min(s.step, LOCKOUT_STEPS.length - 1)];
  if (s.wrong_count >= step.wrong) {
    s.locked_until = Math.floor(Date.now() / 1000) + step.cooldown_s;
    s.wrong_count = 0;
    s.step = Math.min(s.step + 1, LOCKOUT_STEPS.length - 1);
  }
  saveLockout(s);
  return getLockoutStatus();
}

export function clearLockout() {
  try { localStorage.removeItem(LOCKOUT_KEY); } catch {}
}

// ─────────────────────────────────────────────────────────────
// PIN session — "ne pitay protyahom hodyny"
// ─────────────────────────────────────────────────────────────

const PIN_SESSION_KEY = 'morok.pin_session.v1';
const PIN_SESSION_DURATION_SECONDS = 60 * 60; // 1 hour

/**
 * After successful unlock, remember the seed in memory + a "valid until"
 * timestamp in localStorage so reloads within 1h don't re-prompt PIN.
 *
 * Note: we store ONLY the timestamp in localStorage. The unlocked seed
 * lives in JavaScript memory (a module-level variable) — once the tab
 * is closed it's gone. On next reload PIN is required unless within the
 * 1h window AND the seed is still in localStorage in encrypted form.
 *
 * This is a usability/security trade-off: technically we'd need the seed
 * to verify the session is valid, which means caching the unlocked seed
 * itself somewhere. We do NOT cache it — instead, "session valid" means
 * "this tab has the seed in memory and unlocked recently".
 */
let _unlockedSeed = null;

export function markUnlocked(seedBytes) {
  _unlockedSeed = seedBytes;
  const until = Math.floor(Date.now() / 1000) + PIN_SESSION_DURATION_SECONDS;
  try { localStorage.setItem(PIN_SESSION_KEY, String(until)); } catch {}
}

export function isSessionValid() {
  if (!_unlockedSeed) return false;
  try {
    const until = parseInt(localStorage.getItem(PIN_SESSION_KEY) || '0', 10);
    return until > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function getUnlockedSeed() {
  return isSessionValid() ? _unlockedSeed : null;
}

export function lockNow() {
  _unlockedSeed = null;
  try { localStorage.removeItem(PIN_SESSION_KEY); } catch {}
}

export function refreshSession() {
  if (!_unlockedSeed) return;
  const until = Math.floor(Date.now() / 1000) + PIN_SESSION_DURATION_SECONDS;
  try { localStorage.setItem(PIN_SESSION_KEY, String(until)); } catch {}
}
