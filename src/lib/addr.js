import { t } from './i18n.js';
/**
 * Parse Morok user addresses.
 *
 * Accepted formats:
 *   @vasya                       — local relay (current home)
 *   vasya                        — same as above
 *   @vasya@relay2.morok.app      — explicit federation
 *   vasya@relay2.morok.app       — same
 *
 * Returns { username, relay } where relay is null for local-only.
 * Throws on malformed input.
 */

const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function parseAddress(input) {
  if (!input || typeof input !== 'string') {
    throw new Error(t('empty address'));
  }
  let s = input.trim();
  if (s.startsWith('@')) s = s.slice(1);

  // Split on @ — there's at most one (between username and host)
  const atIdx = s.indexOf('@');
  let username, relay;
  if (atIdx === -1) {
    username = s.toLowerCase();
    relay = null;
  } else {
    username = s.slice(0, atIdx).toLowerCase();
    relay = s.slice(atIdx + 1).toLowerCase();
  }

  if (!USERNAME_RE.test(username)) {
    throw new Error(t('Invalid username'));
  }
  if (relay !== null && !HOST_RE.test(relay)) {
    throw new Error(t('Invalid relay address'));
  }
  return { username, relay };
}

/**
 * Format an address back. If relay matches the user's home relay, omit it.
 */
export function formatAddress({ username, relay }, myHomeRelay) {
  if (!relay || relay === myHomeRelay) return `@${username}`;
  return `@${username}@${relay}`;
}
