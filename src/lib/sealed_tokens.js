/**
 * Керування delivery-токенами Sealed Sender.
 *
 * МІЙ токен: секрет, який я генерую, реєструю на СВОЄМУ релеї (лише
 * sha256) і роздаю контактам по E2EE. Контакт, маючи його, зможе
 * слати мені sealed-конверти (релей перевіряє хеш, не знаючи хто шле).
 *
 * ТОКЕНИ КОНТАКТІВ: секрети, які мені дали інші — щоб слати sealed ЇМ.
 * Зберігаються локально, прив'язані до pubkey контакта.
 *
 * Усе локально + один POST хеша на релей. Нічого не ламає: поки токенів
 * нема, клієнт просто шле звичайні v1-конверти.
 */
import * as crypto from './crypto.js';
import * as api from './api.js';

const MY_TOKEN_KEY = 'morok.sealed.my_token.v1';       // мій секрет (hex)
const PEER_TOKENS_KEY = 'morok.sealed.peer_tokens.v1'; // { pubkeyHex: tokenHex }

// ── Мій токен ──────────────────────────────────────────────

export function getMyToken() {
  try { return localStorage.getItem(MY_TOKEN_KEY) || null; } catch { return null; }
}

function setMyToken(hex) {
  try { localStorage.setItem(MY_TOKEN_KEY, hex); } catch { /* ignore */ }
}

/**
 * Переконатись, що мій токен існує і зареєстрований на релеї.
 * Ідемпотентно: якщо вже є — лише гарантує реєстрацію (дешевий POST).
 * Повертає токен (hex) або null, якщо релей не підтримує sealed
 * (старий relay -> тихо вимикаємось, v1 працює).
 */
export async function ensureMyToken() {
  let token = getMyToken();
  if (!token) {
    token = crypto.bytesToHex(crypto.randomBytesSafe(32));
    setMyToken(token);
  }
  const tokenHash = crypto.bytesToHex(
    crypto.sha256Bytes(crypto.hexToBytes(token)),
  );
  try {
    await api.registerInboxToken({ token_hash: tokenHash });
    return token;
  } catch (e) {
    // 404 = старий релей без sealed. Не помилка — просто немає фічі.
    if (e?.status === 404) return null;
    console.warn('registerInboxToken failed:', e);
    return null;
  }
}

/** Ротація мого токена (наприклад, при компрометації). */
export async function rotateMyToken() {
  const token = crypto.bytesToHex(crypto.randomBytesSafe(32));
  setMyToken(token);
  return ensureMyToken();
}

// ── Токени контактів ───────────────────────────────────────

function loadPeerTokens() {
  try { return JSON.parse(localStorage.getItem(PEER_TOKENS_KEY) || '{}'); }
  catch { return {}; }
}

function savePeerTokens(map) {
  try { localStorage.setItem(PEER_TOKENS_KEY, JSON.stringify(map)); }
  catch { /* ignore */ }
}

/** Токен конкретного контакта (для відправки sealed йому) або null. */
export function getPeerToken(peerPubkeyHex) {
  return loadPeerTokens()[peerPubkeyHex] || null;
}

/** Зберегти токен, який контакт надіслав мені. */
export function setPeerToken(peerPubkeyHex, tokenHex) {
  if (!peerPubkeyHex || !tokenHex) return;
  const map = loadPeerTokens();
  map[peerPubkeyHex] = tokenHex;
  savePeerTokens(map);
}

/** Чи можу я слати sealed цьому контакту (маю його токен). */
export function canSealTo(peerPubkeyHex) {
  return !!getPeerToken(peerPubkeyHex);
}

export function forgetPeerToken(peerPubkeyHex) {
  const map = loadPeerTokens();
  if (map[peerPubkeyHex]) { delete map[peerPubkeyHex]; savePeerTokens(map); }
}
