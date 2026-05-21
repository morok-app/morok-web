/**
 * Morok relay HTTP client.
 *
 * Holds the configured relay URL and session token. All endpoints return
 * parsed JSON or throw {status, error, detail}.
 */

import { signAuthChallenge } from './crypto.js';

// Default — can be changed in settings later.
const DEFAULT_RELAY = 'https://relay1.morok.app';

let _relayUrl = DEFAULT_RELAY;
let _sessionToken = null;

export function getRelayUrl() {
  return _relayUrl;
}

export function setRelayUrl(url) {
  _relayUrl = url.replace(/\/+$/, '');
}

export function setSessionToken(token) {
  _sessionToken = token;
}

export function getSessionToken() {
  return _sessionToken;
}

async function http(method, path, { body, auth } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && _sessionToken) {
    headers['Authorization'] = `Bearer ${_sessionToken}`;
  }
  const resp = await fetch(`${_relayUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try { payload = await resp.json(); } catch { /* tolerate empty body */ }

  if (!resp.ok) {
    const err = new Error(payload?.error || payload?.detail || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

// ────────────────────────────────────────────────────────────────
// Health
// ────────────────────────────────────────────────────────────────

export async function getHealth() {
  return http('GET', '/health');
}

// ────────────────────────────────────────────────────────────────
// Auth flow (challenge → verify → session token)
// ────────────────────────────────────────────────────────────────

export async function login({ seed, pubkeyHex }) {
  // 1. Get challenge
  const challenge = await http('POST', '/api/v1/auth/challenge', {
    body: { pubkey_hex: pubkeyHex },
  });
  // 2. Sign and verify
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureHex = signAuthChallenge({
    seed,
    pubkeyHex,
    challengeHex: challenge.challenge_hex,
    timestamp,
  });
  const auth = await http('POST', '/api/v1/auth/verify', {
    body: {
      pubkey_hex: pubkeyHex,
      challenge_hex: challenge.challenge_hex,
      timestamp,
      signature_hex: signatureHex,
    },
  });
  setSessionToken(auth.session_token);
  return auth; // {session_token, expires_at, pubkey_hex}
}

export async function logout() {
  if (!_sessionToken) return { revoked: false };
  try {
    return await http('POST', '/api/v1/auth/logout', { auth: true });
  } finally {
    setSessionToken(null);
  }
}

// ────────────────────────────────────────────────────────────────
// User / Username
// ────────────────────────────────────────────────────────────────

export async function getMe() {
  return http('GET', '/api/v1/users/me', { auth: true });
}

export async function claimUsername(username) {
  return http('POST', '/api/v1/users/me/username', {
    body: { username },
    auth: true,
  });
}

export async function releaseUsername() {
  return http('DELETE', '/api/v1/users/me/username', { auth: true });
}

export async function lookupUsername(username, relay) {
  const qs = relay ? `?relay=${encodeURIComponent(relay)}` : '';
  return http('GET', `/api/v1/users/lookup/${encodeURIComponent(username)}${qs}`);
}
