/**
 * reply.js — відповідь на конкретне повідомлення (цитата).
 *
 * ФОРМАТ НА ДРОТІ (поле всередині зашифрованого payload):
 *
 *   reply_to: { id: <envelope_id повідомлення, на яке відповідаємо> }
 *
 * І ВСЕ. Ні уривка тексту, ні автора — навмисно:
 *   • уривок продовжував би життя повідомлення, яке вже згоріло (burn-after-
 *     read) чи мало коротший TTL, ніж відповідь — це ламало б зникаючі
 *     повідомлення;
 *   • автора відправник міг би підставити будь-якого («Ви: я згоден
 *     заплатити»). Тому і текст, і автора цитати клієнт бере ЛИШЕ з власної
 *     локальної копії оригіналу (за envelope_id у ЦІЙ розмові). Нема копії —
 *     показуємо «Повідомлення недоступне» без автора.
 *
 * Де воно їде:
 *   • групи — у JSON {kind:'group_msg', text, reply_to};
 *   • особисті — ЛИШЕ в sealed-конверті ({kind:'text', text, reply_to}).
 *     Звичайний (v1) текстовий конверт несе голий текст без JSON, і старі
 *     клієнти показали б JSON як є. Тому у v1 відповідь іде звичайним
 *     текстом без цитати — нічого не ламається, просто без прив'язки.
 *
 * Старі/чужі клієнти, що шлють ще й `from`/`text`/`kind`, — ці поля
 * відкидаються при прийомі.
 *
 * Дзеркало: morok-rn/lib/reply.js — має збігатися.
 */

import { t } from './i18n.js';

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const SNIPPET_MAX = 140;

// керівні символи та «невидимі» (bidi-override, zero-width) — геть
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function cleanSnippet(s) {
  if (typeof s !== 'string') return '';
  const one = s.replace(BAD_CHARS, '').replace(/\s+/g, ' ').trim();
  return one.length > SNIPPET_MAX ? `${one.slice(0, SNIPPET_MAX - 1)}…` : one;
}

/** Тип повідомлення для цитати. */
export function kindOf(m) {
  if (m?.voice) return 'voice';
  if (m?.image) return 'image';
  return 'text';
}

/**
 * Побудувати reply_to з локального повідомлення, на яке відповідаємо.
 * null — на повідомлення не можна відповісти (ще не доставлене — нема
 * envelope_id, або не розшифроване).
 */
export function buildReplyTo(m) {
  if (!m || m.status === 'undecryptable') return null;
  const id = m.envelope_id;
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  return { id };
}

/** Перевірити reply_to, що прийшов ззовні. Лишаємо тільки валідний id. */
export function sanitizeReplyTo(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  return { id: r.id };
}

/** Текст цитати — тільки з локальної копії оригіналу. */
export function quotePreview(original) {
  if (!original || original.status === 'undecryptable') return t('Message unavailable');
  const tx = cleanSnippet(original.text || '');
  const kind = kindOf(original);
  if (kind === 'voice') return t('🎤 Voice message');
  if (kind === 'image') return tx ? `📷 ${tx}` : t('📷 Photo');
  return tx || '…';
}
