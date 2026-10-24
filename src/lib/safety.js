/**
 * safety.js — verifiable safety number (звірка ключів проти MITM), як у Signal.
 *
 * З пари публічних ключів (мій + співрозмовника) детерміновано рахуємо один
 * і той самий короткий «відбиток» у ОБОХ учасників. Якщо на екранах однакові
 * числа — між вами немає «людини посередині» (relay не підмінив ключі).
 *
 * Суто клієнтський, без сервера. Дзеркало RN-версії lib/safety.js.
 */

import { sha256Bytes, hexToBytes } from './crypto.js';

/** 5-значна група з 4 байтів (big-endian uint32 mod 100000). */
function chunkToDigits(bytes) {
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(n % 100000).padStart(5, '0');
}

/**
 * safety number як { groups: ['12345', ...6], flat: '12345 67890 ...' }
 * або null, якщо ключі некоректні.
 */
export function safetyNumber(myPubkeyHex, peerPubkeyHex) {
  try {
    const a = String(myPubkeyHex || '').toLowerCase().trim();
    const b = String(peerPubkeyHex || '').toLowerCase().trim();
    if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return null;

    // Сортуємо пару — однаковий результат у обох сторін.
    const [first, second] = a < b ? [a, b] : [b, a];
    const combined = hexToBytes(first + second);   // 64 байти
    const digest = sha256Bytes(sha256Bytes(combined));  // подвійний SHA-256, 32 байти

    const groups = [];
    for (let i = 0; i < 6; i++) {
      groups.push(chunkToDigits(digest.slice(i * 4, i * 4 + 4)));
    }
    return { groups, flat: groups.join(' ') };
  } catch {
    return null;
  }
}

/** Рядок для QR — обидва pubkey (відсортовані), префікс morok-sn:. */
export function safetyQrPayload(myPubkeyHex, peerPubkeyHex) {
  const a = String(myPubkeyHex || '').toLowerCase().trim();
  const b = String(peerPubkeyHex || '').toLowerCase().trim();
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return null;
  const [first, second] = a < b ? [a, b] : [b, a];
  return `morok-sn:${first}:${second}`;
}

/**
 * Спрямований QR: «показує <я>, для <співрозмовник>». На відміну від
 * симетричного morok-sn: (однаковий у обох — тож збігся б і власний екран
 * чи знімок, зроблений будь-ким із публічних ключів), сканер вимагає, щоб
 * QR показував саме співрозмовник і саме для мене.
 */
export function safetyQrPayloadFor(myPubkeyHex, peerPubkeyHex) {
  const a = String(myPubkeyHex || '').toLowerCase().trim();
  const b = String(peerPubkeyHex || '').toLowerCase().trim();
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return null;
  return `morok-sn2:${a}:${b}`;
}

/**
 * Перевірити відсканований QR.
 *   'match'   — QR співрозмовника для мене (morok-sn2);
 *   'legacy'  — старий симетричний QR зі збігом (старі версії застосунку);
 *   'self'    — це мій власний QR;
 *   'mismatch'— QR звірки, але ключі інші;
 *   'other'   — не QR звірки взагалі.
 */
export function checkSafetyScan(raw, myPubkeyHex, peerPubkeyHex) {
  const s = String(raw || '').trim().toLowerCase();
  const me = String(myPubkeyHex || '').toLowerCase();
  const peer = String(peerPubkeyHex || '').toLowerCase();
  const m2 = s.match(/^morok-sn2:([0-9a-f]{64}):([0-9a-f]{64})$/);
  if (m2) {
    if (m2[1] === me) return 'self';
    return m2[1] === peer && m2[2] === me ? 'match' : 'mismatch';
  }
  if (s.startsWith('morok-sn:')) return s === safetyQrPayload(me, peer) ? 'legacy' : 'mismatch';
  return 'other';
}

// ── Статус «підтверджено» (локальний, per-peer) ──
const K_VERIFIED = 'morok.verified.v1';

function readVerified() {
  try {
    const raw = localStorage.getItem(K_VERIFIED);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

export function isVerified(peerPubkeyHex) {
  if (!peerPubkeyHex) return false;
  return !!readVerified()[peerPubkeyHex];
}

export function setVerified(peerPubkeyHex, on) {
  if (!peerPubkeyHex) return;
  const obj = readVerified();
  if (on) obj[peerPubkeyHex] = Math.floor(Date.now() / 1000);
  else delete obj[peerPubkeyHex];
  try { localStorage.setItem(K_VERIFIED, JSON.stringify(obj)); } catch { /* ignore */ }
}
