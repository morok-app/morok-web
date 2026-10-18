import { t, tp } from './i18n.js';
/**
 * Display helpers for user names.
 *
 * Users without a claimed username are anonymous — they're displayed as
 * @anon_<first 8 hex chars of pubkey>. The pubkey is the source of truth;
 * the anon_ display is derived from it, so two clients always agree.
 *
 * Special case: burner-inbox DMs arrive with a `from_username` of either
 * "🔥burner" or "🔥burner::<label>". We render those as "Anonymous" or
 * "Анонім · <label>" without the @-prefix, since they're one-way.
 */

const BURNER_PREFIX = '🔥burner';

// Невидимі та «керуючі» символи: bidi-перемикачі (U+202E перевертає
// текст), zero-width, переноси рядків. Ними підробляють імена —
// «Морок Підтримка», «kaban» з невидимим символом тощо.
const INVISIBLE_RE = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;

/** Підпис анонімки: без невидимих символів, одним рядком, ≤ 40 символів. */
export function sanitizeLabel(label) {
  const clean = String(label || '').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
  return clean.length > 40 ? clean.slice(0, 40) + '…' : clean;
}

// Ніки Morok — лише латиниця/цифри/підкреслення (як на релеї), можливо з
// федеративним @host. Усе інше від релею не показуємо як нік.
const USERNAME_RE = /^[a-z0-9_]{1,32}(@[a-z0-9.-]{1,253})?$/i;

function tryParseBurner(username) {
  if (!username) return null;
  if (username === BURNER_PREFIX) return { label: null };
  if (username.startsWith(BURNER_PREFIX + '::')) {
    return { label: sanitizeLabel(username.slice(BURNER_PREFIX.length + 2)) || null };
  }
  return null;
}

/**
 * Render a name for a user/peer.
 *   formatPeerName({username: 'kaban', pubkey: '...'})  → 'kaban'
 *   formatPeerName({username: null,    pubkey: '...'})  → 'anon_abc12345'
 *   formatPeerName({username: '🔥burner::Bob', pubkey:'…'}) → 'Анонім · Bob'
 */
export function formatPeerName({ username, pubkey }) {
  const burner = tryParseBurner(username);
  if (burner) {
    return burner.label ? tp("Anonymous · {0}", [burner.label]) : t('Anonymous');
  }
  if (username && USERNAME_RE.test(username)) return username;
  if (!pubkey) return 'unknown';
  return `anon_${pubkey.slice(0, 8)}`;
}

/**
 * "@kaban" or "@anon_abc12345" — but for burner, just "Anonymous" (no @).
 */
export function formatPeerHandle({ username, pubkey }) {
  const burner = tryParseBurner(username);
  if (burner) {
    return burner.label ? tp("🔥 Anonymous · {0}", [burner.label]) : t('🔥 Anonymous');
  }
  return `@${formatPeerName({ username, pubkey })}`;
}

/**
 * True if the peer is anonymous (no claimed username).
 */
export function isAnonymous(username) {
  return !username;
}

/**
 * True if this peer is a burner-inbox sender (one-way, anonymous).
 */
export function isBurner(username) {
  return tryParseBurner(username) !== null;
}

/**
 * Нік, що прийшов від релею (from_username конверта), перед збереженням.
 * Релей — у тому числі чужий федеративний — може прислати будь-що, тож
 * пропускаємо лише валідний нік або burner-позначку з очищеним підписом.
 */
export function sanitizeIncomingUsername(username) {
  if (typeof username !== 'string' || !username) return null;
  if (username === BURNER_PREFIX) return username;
  if (username.startsWith(BURNER_PREFIX + '::')) {
    const label = sanitizeLabel(username.slice(BURNER_PREFIX.length + 2));
    return label ? `${BURNER_PREFIX}::${label}` : BURNER_PREFIX;
  }
  return USERNAME_RE.test(username) ? username : null;
}
