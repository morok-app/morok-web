/**
 * Per-contact delivery-токени Sealed Sender.
 *
 * МОДЕЛЬ (максимальна приватність — релей "тупий"):
 *   - Для КОЖНОГО контакта я генерую ОКРЕМИЙ свій токен і реєструю його
 *     sha256 на своєму релеї. Релей зберігає лише НАБІР валідних хешів —
 *     він НЕ знає, який хеш якому контакту належить. Прив'язка
 *     контакт↔токен живе ТІЛЬКИ тут, локально.
 *   - Відкликання одного контакта = unregister його хеша на релеї +
 *     забути локально. Решта контактів недоторкані (на відміну від
 *     старої моделі "один токен на всіх", де ротація била по всіх).
 *   - Релей бачить "пред'явлено валідний хеш", ніколи "контакт X шле".
 *
 * MIGRATION: старий єдиний токен (my_token.v1) лишається валідним як
 * legacy — поки конкретний контакт не отримає персональний. Нічого не
 * ламається: існуючі sealed-розмови продовжують працювати.
 *
 * ТОКЕНИ КОНТАКТІВ (щоб слати sealed ЇМ) — без змін: мапа peer→token.
 */
import * as crypto from './crypto.js';
import * as api from './api.js';

const LEGACY_MY_TOKEN_KEY = 'morok.sealed.my_token.v1';   // старий єдиний (міграція)
const MY_TOKENS_KEY = 'morok.sealed.my_tokens.v2';        // { peerHex: tokenHex } — мій токен ДЛЯ контакта
const PEER_TOKENS_KEY = 'morok.sealed.peer_tokens.v1';    // { peerHex: tokenHex } — токен контакта ДЛЯ МЕНЕ

function tokenHash(tokenHex) {
  return crypto.bytesToHex(crypto.sha256Bytes(crypto.hexToBytes(tokenHex)));
}

// ── Мої токени (per-contact) ───────────────────────────────

function loadMyTokens() {
  try { return JSON.parse(localStorage.getItem(MY_TOKENS_KEY) || '{}'); }
  catch { return {}; }
}
function saveMyTokens(map) {
  try { localStorage.setItem(MY_TOKENS_KEY, JSON.stringify(map)); }
  catch { /* ignore */ }
}

function getLegacyMyToken() {
  try { return localStorage.getItem(LEGACY_MY_TOKEN_KEY) || null; } catch { return null; }
}

/**
 * Мій персональний токен ДЛЯ конкретного контакта. Генерує і реєструє
 * хеш на релеї, якщо ще нема. Це той токен, який я віддам контакту, щоб
 * ВІН міг слати sealed МЕНІ.
 *
 * Повертає токен (hex) або null, якщо релей не підтримує sealed
 * (старий relay -> тихо вимикаємось у v1).
 */
export async function ensureMyTokenFor(peerPubkeyHex) {
  if (!peerPubkeyHex) return null;
  const map = loadMyTokens();
  let token = map[peerPubkeyHex];
  if (!token) {
    token = crypto.bytesToHex(crypto.randomBytesSafe(32));
    map[peerPubkeyHex] = token;
    saveMyTokens(map);
  }
  try {
    await api.registerInboxToken({ token_hash: tokenHash(token) });
    return token;
  } catch (e) {
    if (e?.status === 404) return null; // старий релей без sealed
    console.warn('registerInboxToken (per-contact) failed:', e);
    return null;
  }
}

/**
 * Відкликати мій токен, виданий конкретному контакту: знести його хеш
 * на релеї (контакт більше не зможе слати мені sealed) і забути
 * локально. Інші контакти не зачеплені.
 */
export async function revokeMyTokenFor(peerPubkeyHex) {
  const map = loadMyTokens();
  const token = map[peerPubkeyHex];
  if (token) {
    try { await api.revokeInboxToken({ token_hash: tokenHash(token) }); }
    catch (e) { console.warn('revokeInboxToken failed:', e); }
    delete map[peerPubkeyHex];
    saveMyTokens(map);
  }
}

/**
 * Міграція + сумісність зі старим кодом: при логіні гарантуємо, що
 * legacy-токен (якщо був) лишається зареєстрованим, щоб діючі sealed-
 * розмови не обірвались, поки контакти переходять на персональні токени.
 * No-op, якщо legacy-токена нема.
 */
export async function ensureLegacyToken() {
  const legacy = getLegacyMyToken();
  if (!legacy) return null;
  try {
    await api.registerInboxToken({ token_hash: tokenHash(legacy) });
    return legacy;
  } catch (e) {
    if (e?.status === 404) return null;
    return null;
  }
}

// ── Токени контактів (щоб слати sealed їм) — без змін ──────

function loadPeerTokens() {
  try { return JSON.parse(localStorage.getItem(PEER_TOKENS_KEY) || '{}'); }
  catch { return {}; }
}
function savePeerTokens(map) {
  try { localStorage.setItem(PEER_TOKENS_KEY, JSON.stringify(map)); }
  catch { /* ignore */ }
}

export function getPeerToken(peerPubkeyHex) {
  return loadPeerTokens()[peerPubkeyHex] || null;
}

export function setPeerToken(peerPubkeyHex, tokenHex) {
  if (!peerPubkeyHex || !tokenHex) return;
  const map = loadPeerTokens();
  map[peerPubkeyHex] = tokenHex;
  savePeerTokens(map);
}

export function canSealTo(peerPubkeyHex) {
  return !!getPeerToken(peerPubkeyHex);
}

export function forgetPeerToken(peerPubkeyHex) {
  const map = loadPeerTokens();
  if (map[peerPubkeyHex]) { delete map[peerPubkeyHex]; savePeerTokens(map); }
}
