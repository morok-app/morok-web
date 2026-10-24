/**
 * invites.js — одноразові запрошення.
 *
 * Звичайне посилання «напиши мені» працює для всіх і назавжди. Одноразове —
 * для ОДНІЄЇ людини:
 *   • перший, хто ним скористався, одразу потрапляє у ваші контакти (не в
 *     «Запити») — з підписом, який ви дали запрошенню («Оля з курсів»);
 *   • після цього посилання мертве НА РЕЛЕЇ: у ньому окремий delivery-токен,
 *     і щойно запрошення використане (скасоване, протерміноване) — його хеш
 *     знімається з релею, тож надіслати за ним більше нічого не можна.
 *
 * Посилання: <релей>/web/#newchat?p=<мій ключ>&r=<мій релей>&i=<id>&t=<токен>[&u=<нік>]
 *   p — кому писати; r — куди (sealed-конверт іде прямо на мій релей);
 *   i — id запрошення (одержувач передає його в кадрі invite_claim);
 *   t — одноразовий delivery-токен для sealed-конверта;
 *   u — мій нік (лише підказка — одержувач звіряє його з релеєм).
 *
 * Кадр одержувача (sealed, невидимий): {kind:'invite_claim', nonce, token, relay, u}
 *   token/relay — уже токен ОДЕРЖУВАЧА для мене і його релей: щоб я міг
 *   відповісти йому sealed одразу, навіть якщо ми на різних серверах.
 * Моя відповідь: {kind:'sealed_token', token} — мій постійний токен для нього.
 *
 * Надійність:
 *   • токен запрошення знімаємо з релею лише ПІСЛЯ того, як відповідь пішла
 *     (до того одержувач пише за ним); невдалу відповідь повторюємо;
 *   • одержувач повторює кадр (при кожному старті), доки не прийде відповідь —
 *     конверт живе на релеї лише добу, а я можу бути офлайн довше;
 *   • запрошення живе на тому пристрої, де його створили.
 * Безпека:
 *   • посилання на ключ, який уже є у ваших контактах, нічого не змінює —
 *     просто відкриває чат (інакше чуже посилання могло б підмінити релей
 *     чи токен справжнього контакта);
 *   • адреса релею — лише доменне ім'я (без IP, localhost, дивних портів).
 *
 * Однаковий файл у morok-rn/lib і morok-web/src/lib.
 */

import * as crypto from './crypto.js';
import * as api from './api.js';
import * as contacts from './contacts.js';
import * as sealedTokens from './sealed_tokens.js';
import * as convs from './conversations.js';

const K = 'morok.invites.v1';               // мої запрошення (я — запрошую)
const K_PENDING = 'morok.invites.pending.v1'; // мої кадри invite_claim, що чекають відповіді
export const MAX_ACTIVE = 5;
export const TTL_CHOICES = [1, 7];          // доби
const KEEP_DONE_S = 30 * 86400;             // використані/протерміновані — показуємо ще 30 діб
const REPLY_GRACE_S = 7 * 86400;            // скільки чекаємо на успішну відповідь, перш ніж зняти токен
const PENDING_S = 8 * 86400;                // скільки одержувач повторює кадр
const isHex64 = (s) => /^[0-9a-f]{64}$/.test(String(s || ''));
const isNonce = (s) => /^[0-9a-f]{32}$/.test(String(s || ''));
const nowS = () => Math.floor(Date.now() / 1000);

function readMap(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function writeMap(key, map) {
  try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* ignore */ }
}
const load = () => readMap(K);
const save = (m) => writeMap(K, m);
const tokenHash = (t) => crypto.bytesToHex(crypto.sha256Bytes(crypto.hexToBytes(t)));

export function statusOf(inv, now = nowS()) {
  if (inv.used_by) return 'used';
  if (inv.revoked) return 'revoked';
  if (inv.exp <= now) return 'expired';
  return 'active';
}

/** Список для екрана: активні зверху, далі новіші. */
export function listInvites() {
  const now = nowS();
  const order = { active: 0, used: 1, expired: 2, revoked: 3 };
  return Object.values(load())
    .map((inv) => ({ ...inv, status: statusOf(inv, now) }))
    .sort((a, b) => (order[a.status] - order[b.status]) || (b.created_at - a.created_at));
}

export function activeCount() {
  const now = nowS();
  return Object.values(load()).filter((i) => statusOf(i, now) === 'active').length;
}

/**
 * Хост релею з https-адреси або голого хоста. Лише доменне ім'я з крапкою
 * (можна з портом 1–65535); IP-адреси, localhost, одно-словні імена — ні.
 */
export function relayHost(urlOrHost) {
  const s = String(urlOrHost || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  const m = s.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::(\d{1,5}))?$/);
  if (!m) return null;
  const host = m[1];
  if (m[2] && (Number(m[2]) < 1 || Number(m[2]) > 65535)) return null;
  if (/^[0-9.]+$/.test(host)) return null;                       // IPv4
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
  if (!/[a-z]/.test(host.split('.').pop())) return null;         // TLD — не цифри
  return s;
}

/**
 * Створити запрошення. Реєструє одноразовий токен на моєму релеї.
 * Повертає { nonce, link, exp } або кидає помилку ('limit' | 'relay').
 */
export async function createInvite({ label = '', days = 1, myPubkeyHex, myUsername = null }) {
  if (activeCount() >= MAX_ACTIVE) throw Object.assign(new Error('limit'), { code: 'limit' });
  const base = String(api.getRelayUrl() || '').replace(/\/+$/, '');
  const host = relayHost(base);
  if (!host || !isHex64(myPubkeyHex)) throw Object.assign(new Error('relay'), { code: 'relay' });
  const nonce = crypto.bytesToHex(crypto.randomBytesSafe(16));
  const token = crypto.bytesToHex(crypto.randomBytesSafe(32));
  try {
    await api.registerInboxToken({ token_hash: tokenHash(token) });
  } catch (e) {
    throw Object.assign(new Error('relay'), { code: 'relay', cause: e });
  }
  const d = TTL_CHOICES.includes(Number(days)) ? Number(days) : 1;
  const inv = {
    nonce, token,
    label: String(label || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    created_at: nowS(),
    exp: nowS() + d * 86400,
    used_by: null, used_at: null, used_existing: false, reply_done: false,
    tries: 0, last_try_by: null,
    revoked: false, token_off: false,
  };
  const map = load();
  map[nonce] = inv;
  save(map);
  return { nonce, exp: inv.exp, link: inviteLink({ base, host, myPubkeyHex, nonce, token, myUsername }) };
}

export function inviteLink({ base, host, myPubkeyHex, nonce, token, myUsername }) {
  const u = myUsername && /^[a-z0-9_]{1,32}$/i.test(myUsername) ? `&u=${encodeURIComponent(myUsername)}` : '';
  return `${base}/web/#newchat?p=${myPubkeyHex}&r=${encodeURIComponent(host)}&i=${nonce}&t=${token}${u}`;
}

/** Посилання для вже створеного (активного) запрошення. */
export function linkFor(nonce, { myPubkeyHex, myUsername = null }) {
  const inv = load()[nonce];
  if (!inv) return null;
  const base = String(api.getRelayUrl() || '').replace(/\/+$/, '');
  return inviteLink({ base, host: relayHost(base), myPubkeyHex, nonce, token: inv.token, myUsername });
}

async function turnTokenOff(nonce) {
  const inv = load()[nonce];
  if (!inv || inv.token_off || !isHex64(inv.token)) return;
  try {
    await api.revokeInboxToken({ token_hash: tokenHash(inv.token) });
    const map = load();
    if (map[nonce]) { map[nonce].token_off = true; save(map); }
  } catch { /* спробуємо при наступному prune */ }
}

/** Скасувати активне запрошення: посилання перестає працювати на релеї. */
export async function revokeInvite(nonce) {
  const map = load();
  const inv = map[nonce];
  if (!inv) return;
  if (!inv.used_by) inv.revoked = true;
  save(map);
  if (!inv.used_by || inv.reply_done) await turnTokenOff(nonce);
}

/**
 * Відповісти тому, хто скористався запрошенням: мій постійний токен для
 * нього (sealed). Лише після успіху знімаємо токен запрошення з релею.
 */
export async function replyToClaim({ seed, myPubkeyHex, nonce }) {
  const inv = load()[nonce];
  if (!inv || !inv.used_by || inv.reply_done || !seed) return false;
  try {
    const tok = await sealedTokens.ensureMyTokenFor(inv.used_by);
    if (!tok) return false;
    const msgs = await import('./messages.js');
    await msgs.sendSealedControl({
      seed, myPubkeyHex, peerPubkeyHex: inv.used_by,
      payload: { kind: 'sealed_token', token: tok },
    });
    const map = load();
    if (map[nonce]) { map[nonce].reply_done = true; save(map); }
    await turnTokenOff(nonce);
    return true;
  } catch {
    return false;
  }
}

/**
 * Прибирання (при старті, на екрані запрошень):
 *   • повторити невдалі відповіді (якщо є seed);
 *   • зняти з релею токени скасованих / протермінованих / використаних
 *     (після відповіді або після тижня очікування);
 *   • повторити мої власні кадри invite_claim, що ще не отримали відповіді;
 *   • забути старі записи.
 */
export async function pruneInvites({ seed = null, myPubkeyHex = null } = {}) {
  const now = nowS();
  for (const inv of Object.values(load())) {
    const st = statusOf(inv, now);
    if (st === 'used' && !inv.reply_done && seed && myPubkeyHex) await replyToClaim({ seed, myPubkeyHex, nonce: inv.nonce });
  }
  for (const inv of Object.values(load())) {
    const st = statusOf(inv, now);
    const due = st === 'expired' || st === 'revoked'
      || (st === 'used' && (inv.reply_done || now - (inv.used_at || 0) > REPLY_GRACE_S));
    if (due && !inv.token_off) await turnTokenOff(inv.nonce);
  }
  const map = load();
  let changed = false;
  for (const [n, inv] of Object.entries(map)) {
    const doneAt = inv.used_at || inv.exp || inv.created_at || 0;
    if (statusOf(inv, now) !== 'active' && inv.token_off && now - doneAt > KEEP_DONE_S) { delete map[n]; changed = true; }
  }
  if (changed) save(map);
  if (seed && myPubkeyHex) await resendPendingClaims({ seed, myPubkeyHex });
}

/**
 * Вхідний кадр invite_claim (sealed — особа відправника вже перевірена
 * підписом усередині конверта). Повертає { status, nonce }:
 *   'accepted'  — перший валідний: відправника додано в контакти;
 *   'duplicate' — той самий відправник повторив кадр (відповідь ще не дійшла?);
 *   'used' | 'expired' | 'revoked' | 'blocked' | 'unknown' — нічого не робимо.
 */
export function handleClaim({ peer, nonce, token, relay }) {
  if (!isHex64(peer) || !isNonce(nonce)) return { status: 'unknown' };
  const map = load();
  const inv = map[nonce];
  if (!inv) return { status: 'unknown' };
  if (inv.used_by === peer) return { status: 'duplicate', nonce, replied: !!inv.reply_done };
  const st = statusOf(inv);
  if (st !== 'active') {
    inv.tries = (inv.tries || 0) + 1;
    inv.last_try_by = peer;
    inv.last_try_at = nowS();
    save(map);
    return { status: st, nonce };
  }
  if (contacts.isBlocked(peer)) return { status: 'blocked', nonce };
  const existing = contacts.isInContacts(peer);
  inv.used_by = peer;
  inv.used_at = nowS();
  inv.used_existing = existing;
  save(map);
  const host = relayHost(relay);
  const row = contacts.getByPubkey(peer);
  contacts.addToContacts({
    pubkey_hex: peer,
    // релей контакта, який уже знаємо, не переписуємо
    ...(host && !row?.home_relay ? { home_relay: host } : {}),
    // давньому контакту підпис запрошення не нав'язуємо
    ...(inv.label && !existing ? { nickname: inv.label } : {}),
  });
  if (isHex64(token)) sealedTokens.setPeerToken(peer, token);
  return { status: 'accepted', nonce };
}

/** Розібрати параметри посилання (рядок після «newchat?»). null — не запрошення. */
export function parseInviteParams(qs) {
  try {
    // без URLSearchParams: у React Native він неповний
    const q = {};
    for (const part of String(qs || '').replace(/^.*?newchat\?/, '').split('&')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const k = part.slice(0, eq);
      if (!(k in q)) q[k] = decodeURIComponent(part.slice(eq + 1));
    }
    const get = (k) => (k in q ? q[k] : null);
    const pk = String(get('p') || '').toLowerCase();
    const nonce = String(get('i') || '').toLowerCase();
    const token = String(get('t') || '').toLowerCase();
    const relay = relayHost(get('r'));
    if (!isHex64(pk) || !isNonce(nonce) || !isHex64(token) || !relay) return null;
    const u = get('u');
    return { pubkey: pk, nonce, token, relay, username: u && /^[a-z0-9_]{1,32}$/i.test(u) ? u.toLowerCase() : null };
  } catch { return null; }
}

/**
 * Нік із посилання / кадру — лише підказка. Беремо його, тільки якщо
 * релей за цим ніком повертає ТОЙ САМИЙ ключ. Інакше null.
 */
export async function verifiedNick(username, pubkey, relay) {
  if (!username || !/^[a-z0-9_]{1,32}$/i.test(username) || !isHex64(pubkey)) return null;
  try {
    const u = await api.lookupUsername(username, relay || undefined);
    const pk = String(u?.pubkey_hex || '').toLowerCase();
    return pk === pubkey ? String(u.username || username).toLowerCase() : null;
  } catch { return null; }
}

// ── Сторона одержувача ─────────────────────────────────────────────

const loadPending = () => readMap(K_PENDING);
const savePending = (m) => writeMap(K_PENDING, m);

async function sendClaim({ seed, myPubkeyHex, peer, rec, token = null, relay = null }) {
  const msgs = await import('./messages.js');
  return msgs.sendSealedControl({
    seed, myPubkeyHex, peerPubkeyHex: peer,
    ...(token && relay ? { token, relayBase: `https://${relay}` } : {}),
    payload: {
      kind: 'invite_claim',
      nonce: rec.nonce,
      token: rec.my_token || null,
      relay: rec.my_relay || null,
      ...(rec.u ? { u: rec.u } : {}),
    },
  });
}

const isDead = (e) => e?.status === 403 || /invalid_delivery_token/.test(e?.message || '');

/**
 * Скористатися чужим запрошенням. Повертає { pubkey, username, existing }.
 *   existing:true — це вже мій контакт: нічого не міняємо, просто відкрити чат.
 * Кидає помилку з code: 'self' | 'dead' (використане / скасоване /
 * протерміноване) | 'network' | 'failed'.
 */
export async function acceptInvite({ seed, myPubkeyHex, myUsername = null, invite }) {
  if (!invite || !isHex64(invite.pubkey) || !relayHost(invite.relay)) throw Object.assign(new Error('bad'), { code: 'failed' });
  if (invite.pubkey === myPubkeyHex) throw Object.assign(new Error('self'), { code: 'self' });
  if (contacts.isInContacts(invite.pubkey)) {
    convs.ensureConversation({ peerPubkey: invite.pubkey });
    return { pubkey: invite.pubkey, username: contacts.getByPubkey(invite.pubkey)?.username || null, existing: true };
  }
  const username = await verifiedNick(invite.username, invite.pubkey, invite.relay);
  const myTok = await sealedTokens.ensureMyTokenFor(invite.pubkey);
  const rec = {
    nonce: invite.nonce,
    my_token: myTok || null,
    my_relay: relayHost(api.getRelayUrl()),
    u: myUsername && /^[a-z0-9_]{1,32}$/i.test(myUsername) ? myUsername : null,
    until: nowS() + PENDING_S,
  };
  try {
    // токен і релей із посилання — лише для цього кадру; збережемо їх,
    // тільки коли релей прийняв конверт
    await sendClaim({ seed, myPubkeyHex, peer: invite.pubkey, rec, token: invite.token, relay: invite.relay });
  } catch (e) {
    if (isDead(e)) throw Object.assign(new Error('dead'), { code: 'dead' });
    throw Object.assign(new Error(e?.message || 'failed'), { code: e?.code === 'network' ? 'network' : 'failed' });
  }
  const row = contacts.getByPubkey(invite.pubkey);
  contacts.addToContacts({
    pubkey_hex: invite.pubkey,
    ...(username ? { username } : {}),
    ...(!row?.home_relay ? { home_relay: invite.relay } : {}),
  });
  // поки не прийде постійний токен — пишемо за токеном із посилання
  if (!sealedTokens.getPeerToken(invite.pubkey)) sealedTokens.setPeerToken(invite.pubkey, invite.token);
  convs.ensureConversation({ peerPubkey: invite.pubkey, peerUsername: username, peerHomeRelay: row?.home_relay || invite.relay });
  const pend = loadPending();
  pend[invite.pubkey] = rec;
  savePending(pend);
  return { pubkey: invite.pubkey, username, existing: false };
}

/** Прийшла відповідь (sealed_token) — кадр більше не повторюємо. */
export function clearPendingClaim(peer) {
  const pend = loadPending();
  if (pend[peer]) { delete pend[peer]; savePending(pend); }
}

/** Повторити мої кадри invite_claim, на які ще не прийшла відповідь. */
export async function resendPendingClaims({ seed, myPubkeyHex }) {
  const pend = loadPending();
  const now = nowS();
  let changed = false;
  for (const [peer, rec] of Object.entries(pend)) {
    if (!rec || rec.until < now) { delete pend[peer]; changed = true; continue; }
    try {
      await sendClaim({ seed, myPubkeyHex, peer, rec });
    } catch (e) {
      // токен уже знято: відповідь мала піти — чекати далі нема чого
      if (isDead(e)) { delete pend[peer]; changed = true; }
    }
  }
  if (changed) savePending(pend);
}
