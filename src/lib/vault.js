/**
 * Vault — PIN/passphrase-based encryption of the seed.
 *
 * KDF:
 *   v1 (current): Argon2id, 16 MB memory, t=3, parallelism=1, 16-byte salt
 *   v0 (legacy):  PBKDF2-SHA256, 200K iterations, 16-byte salt
 * Cipher: XChaCha20-Poly1305 (same as our message encryption).
 *
 * Blob layout (base64-encoded):
 *   v1: 0x01 ‖ salt(16) ‖ nonce(24) ‖ ciphertext+tag
 *   v0: salt(16) ‖ nonce(24) ‖ ciphertext+tag        (no version byte)
 *
 * Encryption always produces v1. Decryption detects the magic byte and
 * tries Argon2id first; on failure (or if the magic byte is absent) we
 * fall back to PBKDF2 for existing users. After a successful v0 unlock,
 * callers SHOULD re-encrypt (rotate to v1) to migrate gradually.
 *
 * For the LOCAL PIN (6 digits) we accept the weakness — 6 digits is fast
 * to brute force offline. Compensating measures:
 *   - Argon2id KDF makes each guess ~50× slower than PBKDF2 200K at
 *     16 MB cost, plus is memory-hard so GPUs barely help (vs PBKDF2
 *     which GPUs eat for breakfast). Combined, a 6-digit PIN goes from
 *     "hours on a 4090" to "weeks on rented cloud GPUs".
 *   - Hard rate-limit on PIN entry attempts: 5 wrong → 30s lockout, then
 *     5 wrong → 5min, then 5 wrong → 1h. Persistent across reloads.
 *   - User explicitly informed that 24-word mnemonic remains the only
 *     trustworthy recovery path.
 *
 * For the OPTIONAL PASSPHRASE (server backup) we require 12+ chars. The
 * passphrase strength is the entire backup security model — there's
 * nothing else protecting that ciphertext on the relay.
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { argon2id } from '@noble/hashes/argon2';
import { randomBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { utf8, bytesToBase64, base64ToBytes } from './crypto.js';

// ── Legacy PBKDF2 (kept only for decrypting existing user blobs) ──
const PBKDF2_ITERATIONS = 200_000;

// ── Current Argon2id parameters ──
// Memory in KiB. 16 MiB chosen as the sweet spot: GPU brute force is
// effectively defeated (each guess needs random RAM access, not just
// compute), unlock takes <150 ms on modern phones and <50 ms on a PC.
const ARGON2_MEM_KIB = 16 * 1024;
const ARGON2_TIME_COST = 3;
const ARGON2_PARALLELISM = 1;

const SALT_BYTES = 16;
const NONCE_BYTES = 24;
const KDF_VERSION_ARGON2 = 0x01;

/**
 * Derive a 32-byte key using Argon2id (v1 format, current).
 */
function deriveKeyArgon2(secret, salt) {
  return argon2id(utf8(secret), salt, {
    t: ARGON2_TIME_COST,
    m: ARGON2_MEM_KIB,
    p: ARGON2_PARALLELISM,
    dkLen: 32,
  });
}

/**
 * Derive a 32-byte key using PBKDF2-SHA256 (v0, legacy — kept only for
 * decrypting existing user blobs).
 */
function deriveKeyPbkdf2(secret, salt) {
  return pbkdf2(sha256, utf8(secret), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  });
}

/**
 * Encrypt arbitrary bytes (e.g. the seed) with a PIN/passphrase.
 *
 * Always produces a v1 blob (Argon2id). Returns base64 string with
 * embedded magic-byte ‖ salt ‖ nonce ‖ ciphertext+tag.
 */
export function encryptWithSecret(plaintextBytes, secret) {
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = deriveKeyArgon2(secret, salt);
  const cipher = xchacha20poly1305(key, nonce);
  const ct = cipher.encrypt(plaintextBytes);

  const out = new Uint8Array(1 + SALT_BYTES + NONCE_BYTES + ct.length);
  out[0] = KDF_VERSION_ARGON2;
  out.set(salt, 1);
  out.set(nonce, 1 + SALT_BYTES);
  out.set(ct, 1 + SALT_BYTES + NONCE_BYTES);
  return bytesToBase64(out);
}

/**
 * Decrypt bytes that were encrypted with encryptWithSecret().
 *
 * Detects the blob format and dispatches to Argon2id (v1) or PBKDF2 (v0).
 * If the magic byte matches but auth tag verification fails we fall
 * through to the legacy decoder — the false-detection rate for legacy
 * blobs is ~1/256 (first byte of a random salt happens to be 0x01),
 * which costs an extra ~150 ms on those rare unlocks.
 *
 * Returns the plaintext bytes, or throws "bad PIN" if neither succeeds.
 */
export function decryptWithSecret(blobB64, secret) {
  const raw = base64ToBytes(blobB64);
  const minV0 = SALT_BYTES + NONCE_BYTES + 16;       // ChaCha20-Poly1305 tag is 16
  const minV1 = 1 + minV0;

  // ── Try v1 (Argon2id) if the magic byte and length look right ──
  if (raw[0] === KDF_VERSION_ARGON2 && raw.length >= minV1) {
    try {
      const salt  = raw.slice(1, 1 + SALT_BYTES);
      const nonce = raw.slice(1 + SALT_BYTES, 1 + SALT_BYTES + NONCE_BYTES);
      const ct    = raw.slice(1 + SALT_BYTES + NONCE_BYTES);
      const key = deriveKeyArgon2(secret, salt);
      const cipher = xchacha20poly1305(key, nonce);
      return cipher.decrypt(ct);
    } catch {
      // Fall through to legacy attempt — this happens either when the
      // PIN is wrong (we should still try v0 to keep the error
      // consistent), or when a legacy v0 blob coincidentally starts
      // with 0x01.
    }
  }

  // ── Legacy v0 (PBKDF2) ──
  if (raw.length < minV0) {
    throw new Error('blob too short');
  }
  const salt  = raw.slice(0, SALT_BYTES);
  const nonce = raw.slice(SALT_BYTES, SALT_BYTES + NONCE_BYTES);
  const ct    = raw.slice(SALT_BYTES + NONCE_BYTES);
  const key = deriveKeyPbkdf2(secret, salt);
  const cipher = xchacha20poly1305(key, nonce);
  return cipher.decrypt(ct);  // throws if tag invalid → "bad PIN"
}

/**
 * Returns true if the blob is in the legacy v0 (PBKDF2) format and
 * should ideally be re-encrypted on next successful unlock.
 *
 * Callers (PinUnlock) can use this to trigger a silent migration:
 * after the user enters their PIN correctly, re-encrypt with the same
 * PIN to bump them to v1.
 */
export function isLegacyBlob(blobB64) {
  try {
    const raw = base64ToBytes(blobB64);
    if (raw.length < SALT_BYTES + NONCE_BYTES + 16) return false;
    return raw[0] !== KDF_VERSION_ARGON2;
  } catch {
    return false;
  }
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

// ── Duress-PIN ───────────────────────────────────────────────
// Другий PIN: його введення на екрані розблокування = МИТТЄВЕ тихе
// стирання всього локального (storage.wipeAll) і вигляд свіжої інсталяції.
// Верифікатор — той самий Argon2id-блоб (encryptWithSecret над фіксованим
// маркером), тобто перебір duress-PIN коштує стільки ж, скільки основного.
// ЧЕСНО ПРО МЕЖІ: ключ названо нейтрально (pin_meta), але криміналіст із
// доступом до localStorage все одно ПОБАЧИТЬ другий блоб. Duress захищає
// від примусу «розблокуй при мені», не від глибокої форензики.
const K_DURESS = 'morok.pin_meta.v1';
const DURESS_MAGIC = 'MOROK-DURESS-v1';

export function hasDuressPin() {
  try { return !!localStorage.getItem(K_DURESS); } catch { return false; }
}

export function setDuressPin(pin) {
  const blob = encryptWithSecret(utf8(DURESS_MAGIC), pin);
  localStorage.setItem(K_DURESS, blob);
}

export function clearDuressPin() {
  try { localStorage.removeItem(K_DURESS); } catch { /* ignore */ }
}

export function checkDuressPin(pin) {
  try {
    const blob = localStorage.getItem(K_DURESS);
    if (!blob) return false;
    const out = decryptWithSecret(blob, pin);
    const want = utf8(DURESS_MAGIC);
    if (out.length !== want.length) return false;
    for (let i = 0; i < want.length; i++) if (out[i] !== want[i]) return false;
    return true;
  } catch { return false; }
}

export function refreshSession() {
  if (!_unlockedSeed) return;
  const until = Math.floor(Date.now() / 1000) + PIN_SESSION_DURATION_SECONDS;
  try { localStorage.setItem(PIN_SESSION_KEY, String(until)); } catch {}
}
