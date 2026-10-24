/**
 * trust.js — «чи це та сама людина?»
 *
 * Акаунт у Morok — це ключ, а нік лише підпис до нього. Один і той самий
 * нік може опинитися на ДВОХ різних ключах:
 *   • людина створила новий акаунт (старий ключ втрачено / видалено);
 *   • нік звільнили, і його зайняв хтось інший;
 *   • такий самий нік на іншому сервері федерації (@vasya@relay2 ≠ @vasya);
 *   • підміна: сервер на запит «@vasya» віддав чужий ключ.
 * Раніше це ніяк не було видно — чат просто підписувався тим самим ніком.
 * Тепер, якщо серед відомих вам ключів (адресна книга + розмови) є інший
 * з таким самим ніком, показуємо попередження, доки ви не звірите ключі
 * (номер безпеки / QR — позначка «підтверджено»).
 *
 * Усе локально: сервер не знає, кого ви перевірили.
 * Однаковий файл у morok-rn/lib і morok-web/src/lib.
 */

import * as contacts from './contacts.js';
import * as convs from './conversations.js';
import * as safety from './safety.js';

const NICK_RE = /^[a-z0-9_]{1,32}$/;

/** «@Vasya@relay2.morok.app» → «vasya»; бернери / сміття → ''. */
export function normNick(username) {
  const n = String(username || '').trim().toLowerCase().replace(/^@/, '').split('@')[0];
  return NICK_RE.test(n) ? n : '';
}

/**
 * Індекс «нік → ключі» за один прохід (для списків чатів).
 * Повертає функцію othersFor(pubkey, username) → [{ pubkey, relay, contact, verified }].
 */
export function buildNickIndex() {
  const byNick = new Map();   // nick → Map(pubkey → { pubkey, relay })
  const add = (pk, username, relay) => {
    const n = normNick(username);
    if (!n || !/^[0-9a-f]{64}$/.test(pk || '')) return;
    if (!byNick.has(n)) byNick.set(n, new Map());
    const m = byNick.get(n);
    const prev = m.get(pk);
    m.set(pk, { pubkey: pk, relay: (prev && prev.relay) || relay || null });
  };
  try { for (const c of contacts.listContacts()) add(c.pubkey_hex, c.username, c.home_relay); } catch { /* ignore */ }
  try { for (const cv of convs.listConversations()) add(cv.peer_pubkey, cv.peer_username, cv.peer_home_relay); } catch { /* ignore */ }
  return function othersFor(pubkey, username) {
    const n = normNick(username);
    const m = n ? byNick.get(n) : null;
    if (!m) return [];
    const out = [];
    for (const o of m.values()) {
      if (o.pubkey === pubkey) continue;
      out.push({ ...o, contact: contacts.isInContacts(o.pubkey), verified: safety.isVerified(o.pubkey) });
    }
    // спершу підтверджені, потім контакти
    return out.sort((a, b) => (b.verified - a.verified) || (b.contact - a.contact));
  };
}

/**
 * Стан довіри до співрозмовника.
 *   verified — ви звірили ключі (номер безпеки / QR);
 *   others   — інші відомі ключі з таким самим ніком;
 *   conflict — показувати попередження:
 *     • цей ключ звірено — ні;
 *     • серед інших є звірений — так;
 *     • цей у контактах, а інші — ні (давній контакт і новий «двійник») — ні:
 *       попередження бачитиме саме двійник;
 *     • інакше (обидва в контактах / обидва чужі) — так.
 */
export function trustInfo(pubkey, username, othersFor = null) {
  const others = (othersFor || buildNickIndex())(pubkey, username);
  const verified = safety.isVerified(pubkey);
  let conflict = false;
  if (others.length && !verified) {
    if (others.some((o) => o.verified)) conflict = true;
    else if (contacts.isInContacts(pubkey) && !others.some((o) => o.contact)) conflict = false;
    else conflict = true;
  }
  return { verified, others, conflict, nick: normNick(username) };
}
