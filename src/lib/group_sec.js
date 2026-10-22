/**
 * group_sec.js — хто має право отримати ключ групи.
 *
 * ПРОБЛЕМА, ЯКУ ЗАКРИВАЄМО. Ключ групи учасники видають один одному
 * («group_key_request» → «group_key»). Раніше єдиним критерієм було «релей
 * каже, що він учасник». Тобто релей (або чужий федеративний релей) міг
 * дописати в список учасників СВІЙ ключ, попросити ключ групи — і хтось із
 * учасників автоматично його віддав би.
 *
 * ТЕПЕР у «захищеної» групи є ПІДПИСАНИЙ адміном стан:
 *
 *   state = { v: 2, g: <group_id>, admin: <pubkey>, seq: <лічильник>,
 *             kh: sha256(ключ групи),
 *             vouched: [<pubkey>, …],            // кого адмін додав
 *             invites: [{ pk, exp }, …] }        // відкриті ключі запрошень
 *   signed = { state, sig }                      // sig — Ed25519 адміна
 *
 *   • Підпис + kh: підробити стан може лише той, хто знає ключ групи І
 *     ключ адміна. Релей не знає жодного.
 *   • seq: приймаємо лише новіший стан — затримка чи переставлення
 *     повідомлень релеєм не «воскресить» видаленого учасника.
 *   • Стан завжди ПОВНИЙ (не дельта) і їде в кожному ключі групи, тож
 *     хто пропустив оновлення, отримає його з наступним.
 *
 * ЗАПРОШЕННЯ. Посилання містить приватний ключ запрошення (s) і ключ адміна
 * (a) у #фрагменті — релей їх не бачить. Адмін оголошує публічний ключ
 * запрошення в підписаному стані. Хто приєднується, підписує ключем
 * запрошення доказ, прив'язаний до СЕБЕ й ДО ОДЕРЖУВАЧА:
 *     {g, from: я, to: учасник, ts}
 * Тож навіть підставний «учасник» від релею, отримавши свою копію доказу,
 * не може використати її в розмові з чесним учасником. А ключ групи, що
 * прийде у відповідь, приймаємо лише разом зі станом, підписаним саме тим
 * адміном, що в посиланні, і з правильним kh.
 *
 * Групи, створені старими клієнтами, лишаються «легасі» (старе правило),
 * доки творець не відкриє групу в новій версії (ensureProtected).
 *
 * ЧЕСНО ПРО МЕЖІ: учасники зі старими версіями застосунку й далі віддають
 * ключ за старим правилом, поки не оновляться. Для легасі-груп адміна
 * закріплюємо з того, що каже релей у момент першого знайомства (TOFU).
 * ПЕРЕВИПУСК КЛЮЧА. Коли адмін прибирає учасника, він генерує НОВИЙ ключ
 * групи, підписує стан з kh нового ключа (seq+1) і розсилає ключ решті
 * особистими E2EE-повідомленнями. Учасники приймають інший ключ лише зі
 * станом, підписаним закріпленим адміном, з новішим seq. Старі ключі
 * лишаються для розшифрування того, що вже в дорозі; нові повідомлення
 * видалений прочитати не може.
 *
 * Дзеркало: morok-rn/lib/group_sec.js — має збігатися.
 */

import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { bytesToHex, hexToBytes, base64ToBytes, utf8 } from './crypto.js';

const PK_RE = /^[0-9a-f]{64}$/;
const SIG_RE = /^[0-9a-f]{128}$/;
const MAX_VOUCHED = 1000;
const MAX_INVITES = 50;
const MAX_INVITE_TTL_S = 30 * 86400;
const PROOF_SKEW_S = 2 * 86400;
export const DEFAULT_INVITE_TTL_S = 7 * 86400;

const nowS = () => Math.floor(Date.now() / 1000);

function uniqPk(list) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const pk = typeof x === 'string' ? x.toLowerCase() : '';
    if (PK_RE.test(pk) && !seen.has(pk)) { seen.add(pk); out.push(pk); }
    if (out.length >= MAX_VOUCHED) break;
  }
  return out;
}

function cleanInvites(list, now = nowS()) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const pk = typeof x?.pk === 'string' ? x.pk.toLowerCase() : '';
    const exp = Number.isInteger(x?.exp) ? x.exp : 0;
    if (!PK_RE.test(pk) || exp <= now) continue;
    if (out.some((i) => i.pk === pk)) continue;
    out.push({ pk, exp: Math.min(exp, now + MAX_INVITE_TTL_S) });
  }
  return out.slice(-MAX_INVITES);
}

/** sha256(ключ групи) — прив'язка стану до САМЕ цього ключа. */
export function keyHash(groupKeyB64) {
  try { return bytesToHex(sha256(base64ToBytes(groupKeyB64))); } catch { return null; }
}

function normState(st) {
  if (!st || typeof st !== 'object' || st.v !== 2) return null;
  const admin = typeof st.admin === 'string' ? st.admin.toLowerCase() : '';
  if (!PK_RE.test(admin) || typeof st.g !== 'string' || !Number.isInteger(st.seq) || st.seq < 1) return null;
  if (typeof st.kh !== 'string' || !/^[0-9a-f]{64}$/.test(st.kh)) return null;
  return {
    v: 2, g: st.g, admin, seq: st.seq, kh: st.kh,
    vouched: uniqPk([admin, ...(st.vouched || [])]),
    // термін дії запрошень перевіряємо при використанні, а не тут — інакше
    // нормалізація міняла б підписаний стан і ламала підпис
    invites: (Array.isArray(st.invites) ? st.invites : [])
      .filter((i) => typeof i?.pk === 'string' && PK_RE.test(i.pk) && Number.isInteger(i.exp))
      .slice(-MAX_INVITES)
      .map((i) => ({ pk: i.pk, exp: i.exp })),
  };
}

// Детермінована серіалізація з ФІКСОВАНИМ порядком ключів на всіх рівнях.
// (crypto.canonicalJson тут не годиться: його replacer-масив діє і на
// вкладені об'єкти й мовчки викинув би pk/exp із запрошень — підпис би
// їх не покривав.)
function stateBytes(st) {
  return utf8(JSON.stringify({
    morok_group_sec: 'v2', g: st.g, admin: st.admin, seq: st.seq, kh: st.kh,
    vouched: st.vouched,
    invites: st.invites.map((i) => ({ pk: i.pk, exp: i.exp })),
  }));
}

/** Підписати стан ключем адміна. */
export function signState(state, adminSeed) {
  const st = normState(state);
  if (!st) throw new Error('bad state');
  return { state: st, sig: bytesToHex(ed25519.sign(stateBytes(st), adminSeed)) };
}

/**
 * Перевірити підписаний стан. Повертає нормалізований state або null.
 *   groupId, groupKeyB64 — мої; adminPin — закріплений адмін (якщо є).
 */
export function verifySigned(signed, { groupId, groupKeyB64, adminPin = null }) {
  if (!signed || typeof signed !== 'object') return null;
  const st = normState(signed.state);
  if (!st || st.g !== groupId) return null;
  if (adminPin && st.admin !== String(adminPin).toLowerCase()) return null;
  const kh = keyHash(groupKeyB64);
  if (!kh || st.kh !== kh) return null;
  const sig = typeof signed.sig === 'string' ? signed.sig.toLowerCase() : '';
  if (!SIG_RE.test(sig)) return null;
  try {
    if (!ed25519.verify(hexToBytes(sig), stateBytes(st), hexToBytes(st.admin))) return null;
  } catch { return null; }
  return st;
}

/** Перший стан нової (або щойно захищеної) групи. */
export function newState({ groupId, adminPk, groupKeyB64, vouched = [] }) {
  return normState({
    v: 2, g: groupId, admin: adminPk, seq: 1, kh: keyHash(groupKeyB64),
    vouched: [adminPk, ...vouched], invites: [],
  });
}

/**
 * Наступний стан після дії адміна.
 *   update = { add?: [pk], remove?: [pk], invite?: {pk, exp}, revoke?: [pk],
 *              kh?: sha256(НОВОГО ключа) — перевипуск ключа групи }
 */
export function nextState(cur, update) {
  const s = normState(cur);
  if (!s || !update || typeof update !== 'object') return null;
  let vouched = s.vouched;
  if (Array.isArray(update.add)) vouched = uniqPk([...vouched, ...update.add]);
  if (Array.isArray(update.remove)) {
    const rm = new Set(uniqPk(update.remove).filter((pk) => pk !== s.admin));
    vouched = vouched.filter((pk) => !rm.has(pk));
  }
  let invites = cleanInvites(s.invites);
  if (update.invite) invites = cleanInvites([...invites, update.invite]);
  if (Array.isArray(update.revoke)) {
    const rv = new Set(update.revoke.map((x) => String(x).toLowerCase()));
    invites = invites.filter((i) => !rv.has(i.pk));
  }
  const kh = typeof update.kh === 'string' && /^[0-9a-f]{64}$/.test(update.kh) ? update.kh : s.kh;
  return normState({ ...s, seq: s.seq + 1, kh, vouched, invites });
}

// ── Запрошення ─────────────────────────────────────────────

export function makeInvite() {
  const seed = ed25519.utils.randomPrivateKey();
  return { seedHex: bytesToHex(seed), pk: bytesToHex(ed25519.getPublicKey(seed)) };
}

export function isHex64(s) { return typeof s === 'string' && PK_RE.test(s); }

// ── Доказ володіння ключем групи (для тих, хто пропустив перевипуск) ──
// HMAC(старий ключ групи, {g, from, to}) — прив'язаний до мене й до
// одержувача, тож переслати чужий доказ не вийде. Перевіряє лише адмін,
// який знає, кого він видаляв (removed_local), — інакше видалений учасник
// (що теж знає старий ключ) повернувся б так само.
function keyProofBytes({ g, from, to }) {
  return utf8(JSON.stringify({ morok_key_proof: 'v1', g, from, to }));
}

export function makeKeyProof({ groupKeyB64, groupId, fromPk, toPk }) {
  try {
    const mac = hmac(sha256, base64ToBytes(groupKeyB64), keyProofBytes({
      g: groupId, from: String(fromPk).toLowerCase(), to: String(toPk).toLowerCase(),
    }));
    return { kh: keyHash(groupKeyB64), mac: bytesToHex(mac) };
  } catch { return null; }
}

/** true, якщо доказ зроблено одним із ключів `keysB64` для пари from→to. */
export function verifyKeyProof(proof, { keysB64, groupId, fromPk, toPk }) {
  if (!proof || typeof proof.mac !== 'string' || !/^[0-9a-f]{64}$/.test(proof.mac)) return false;
  for (const k of keysB64 || []) {
    const mine = makeKeyProof({ groupKeyB64: k, groupId, fromPk, toPk });
    if (!mine) continue;
    if (proof.kh && proof.kh !== mine.kh) continue;
    // порівняння сталого часу
    let d = 0;
    for (let i = 0; i < 64; i++) d |= mine.mac.charCodeAt(i) ^ proof.mac.charCodeAt(i);
    if (d === 0) return true;
  }
  return false;
}

function proofBytes({ g, from, to, ts }) {
  return utf8(JSON.stringify({ morok_invite: 'v1', g, from, to, ts }));
}

/** Доказ запрошення для КОНКРЕТНОГО одержувача (to). */
export function makeInviteProof({ inviteSeedHex, groupId, fromPk, toPk, ts = nowS() }) {
  const seed = hexToBytes(inviteSeedHex);
  const from = String(fromPk).toLowerCase();
  const to = String(toPk).toLowerCase();
  return {
    pk: bytesToHex(ed25519.getPublicKey(seed)),
    ts,
    sig: bytesToHex(ed25519.sign(proofBytes({ g: groupId, from, to, ts }), seed)),
  };
}

/**
 * Чи можна видати ключ групи цьому запитувачу.
 * Повертає 'vouched' | 'invite' | null.
 */
export function requestAllowed({ state, localVouched = [], requesterPk, myPk, groupId, proof }) {
  const s = normState(state);
  if (!s) return null;
  const pk = String(requesterPk || '').toLowerCase();
  if (s.vouched.includes(pk) || localVouched.includes(pk)) return 'vouched';
  if (!proof || typeof proof !== 'object') return null;
  const ipk = typeof proof.pk === 'string' ? proof.pk.toLowerCase() : '';
  const ts = Number.isInteger(proof.ts) ? proof.ts : 0;
  const sig = typeof proof.sig === 'string' ? proof.sig.toLowerCase() : '';
  const now = nowS();
  const inv = s.invites.find((i) => i.pk === ipk);
  if (!inv || inv.exp <= now || !SIG_RE.test(sig) || Math.abs(now - ts) > PROOF_SKEW_S) return null;
  try {
    const ok = ed25519.verify(hexToBytes(sig), proofBytes({ g: groupId, from: pk, to: String(myPk).toLowerCase(), ts }), hexToBytes(ipk));
    return ok ? 'invite' : null;
  } catch { return null; }
}
