/**
 * username.js — валідація юзернейма НА КЛІЄНТІ, дзеркало серверних правил.
 *
 * Спільний файл для web і RN: якщо правила розійдуться, користувач знову
 * побачить «підходить» на екрані й 400 від сервера.
 *
 * Джерело істини — morok_relay/schemas.py, validate_username_for_tier().
 * При зміні правил на сервері цей файл треба оновити разом із ним.
 *
 * ЧОМУ ВЗАГАЛІ ДУБЛЮЄМО СЕРВЕРНУ ЛОГІКУ: щоб сказати «занадто коротко»
 * ДО запиту, а не після. Клієнтська перевірка тут — це UX, а не безпека:
 * авторитет усе одно за сервером, і він перевіряє все заново.
 */

// Ті самі 24 слова, що в RESERVED_USERNAMES на сервері.
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'morok', 'morok_app',
  'support', 'help', 'abuse', 'security', 'official', 'team',
  'anonymous', 'anon', 'null', 'undefined', 'me', 'self',
  'channel', 'group', 'user', 'users',
]);

const CHARS = /^[a-z0-9_]+$/;
const MAX_LEN = 20;

// TIER_MIN_LENGTH на сервері. Короткі ніки — платні, це навмисно.
const MIN_LEN_BY_TIER = { free: 5, premium: 3, admin: 1 };

/** Те саме, що normalize_username() на сервері. */
export function normalizeUsername(raw) {
  return String(raw || '').trim().replace(/^@+/, '').toLowerCase();
}

export function minLengthForTier(tier) {
  return MIN_LEN_BY_TIER[tier] ?? MIN_LEN_BY_TIER.free;
}

/**
 * Перевірити юзернейм для тарифу.
 *
 * Повертає { ok, normalized, error }, де error — готовий текст для
 * показу користувачу (українською, як решта інтерфейсу).
 *
 * Порядок перевірок збігається з серверним, щоб на однаковому вводі
 * клієнт і сервер скаржились на ОДНЕ Й ТЕ САМЕ. Інакше людина виправить
 * те, на що вказав екран, і все одно впіймає 400 через іншу причину.
 */
export function validateUsername(raw, tier = 'free') {
  const u = normalizeUsername(raw);
  const minLen = minLengthForTier(tier);

  if (!u) {
    return { ok: false, normalized: u, error: 'Введіть юзернейм' };
  }
  if (!CHARS.test(u)) {
    return {
      ok: false,
      normalized: u,
      error: 'Дозволені лише малі латинські літери, цифри та «_»',
    };
  }
  if (/^[0-9_]/.test(u)) {
    return {
      ok: false,
      normalized: u,
      error: 'Юзернейм має починатися з літери',
    };
  }
  if (u.length > MAX_LEN) {
    return {
      ok: false,
      normalized: u,
      error: `Занадто довго — максимум ${MAX_LEN} символів`,
    };
  }
  if (u.length < minLen) {
    return {
      ok: false,
      normalized: u,
      error: tier === 'free'
        ? `Занадто коротко — потрібно від ${minLen} символів. Коротші імена доступні на преміумі.`
        : `Занадто коротко — потрібно від ${minLen} символів`,
    };
  }
  if (RESERVED.has(u)) {
    return { ok: false, normalized: u, error: 'Це ім’я зарезервовано' };
  }
  return { ok: true, normalized: u, error: null };
}
