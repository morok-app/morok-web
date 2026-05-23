/**
 * Display helpers for user names.
 *
 * Users without a claimed username are anonymous — they're displayed as
 * @anon_<first 8 hex chars of pubkey>. The pubkey is the source of truth;
 * the anon_ display is derived from it, so two clients always agree.
 *
 * When a username is set, that takes precedence.
 */

/**
 * Render a name for a user/peer.
 *   formatPeerName({username: 'kaban', pubkey: '...'})  → 'kaban'
 *   formatPeerName({username: null,    pubkey: '...'})  → 'anon_abc12345'
 *
 * Pass a pubkey hex (string) or anything with .pubkey_hex / .peer_pubkey.
 */
export function formatPeerName({ username, pubkey }) {
  if (username) return username;
  if (!pubkey) return 'unknown';
  return `anon_${pubkey.slice(0, 8)}`;
}

/**
 * "@kaban" or "@anon_abc12345"
 */
export function formatPeerHandle({ username, pubkey }) {
  return `@${formatPeerName({ username, pubkey })}`;
}

/**
 * True if the peer is anonymous (no claimed username).
 */
export function isAnonymous(username) {
  return !username;
}
