/**
 * Display helpers for user names.
 *
 * Users without a claimed username are anonymous — they're displayed as
 * @anon_<first 8 hex chars of pubkey>. The pubkey is the source of truth;
 * the anon_ display is derived from it, so two clients always agree.
 *
 * Special case: burner-inbox DMs arrive with a `from_username` of either
 * "🔥burner" or "🔥burner::<label>". We render those as "Анонім" or
 * "Анонім · <label>" without the @-prefix, since they're one-way.
 */

const BURNER_PREFIX = '🔥burner';

function tryParseBurner(username) {
  if (!username) return null;
  if (username === BURNER_PREFIX) return { label: null };
  if (username.startsWith(BURNER_PREFIX + '::')) {
    return { label: username.slice(BURNER_PREFIX.length + 2) };
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
    return burner.label ? `Анонім · ${burner.label}` : 'Анонім';
  }
  if (username) return username;
  if (!pubkey) return 'unknown';
  return `anon_${pubkey.slice(0, 8)}`;
}

/**
 * "@kaban" or "@anon_abc12345" — but for burner, just "Анонім" (no @).
 */
export function formatPeerHandle({ username, pubkey }) {
  const burner = tryParseBurner(username);
  if (burner) {
    return burner.label ? `🔥 Анонім · ${burner.label}` : '🔥 Анонім';
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
