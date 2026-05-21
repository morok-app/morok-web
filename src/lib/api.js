/**
 * Morok relay HTTP client.
 */

import { signAuthChallenge } from './crypto.js';

const DEFAULT_RELAY = 'https://relay1.morok.app';

let _relayUrl = DEFAULT_RELAY;
let _sessionToken = null;

export function getRelayUrl() { return _relayUrl; }
export function setRelayUrl(url) { _relayUrl = url.replace(/\/+$/, ''); }
export function setSessionToken(token) { _sessionToken = token; }
export function getSessionToken() { return _sessionToken; }

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
  try { payload = await resp.json(); } catch { /* tolerate empty */ }

  if (!resp.ok) {
    const err = new Error(payload?.error || payload?.detail || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

// ────────────────────────────────────────────────────────────
// Health
// ────────────────────────────────────────────────────────────

export async function getHealth() {
  return http('GET', '/health');
}

// ────────────────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────────────────

export async function login({ seed, pubkeyHex }) {
  const challenge = await http('POST', '/api/v1/auth/challenge', {
    body: { pubkey_hex: pubkeyHex },
  });
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
  return auth;
}

export async function logout() {
  if (!_sessionToken) return { revoked: false };
  try {
    return await http('POST', '/api/v1/auth/logout', { auth: true });
  } finally {
    setSessionToken(null);
  }
}

// ────────────────────────────────────────────────────────────
// User / Username
// ────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────
// Messages
// ────────────────────────────────────────────────────────────

/**
 * POST a signed envelope to the relay for delivery.
 * envelope = { from, to, ts, ttl, blob, sig }  (sig is hex string)
 */
export async function sendEnvelope(envelope) {
  return http('POST', '/api/v1/messages', {
    body: envelope,
    auth: true,
  });
}

/**
 * List pending envelopes addressed to me. Limit 1-200.
 * Returns { envelopes: [...], count: N }
 */
export async function listInbox(limit = 50) {
  return http('GET', `/api/v1/messages?limit=${limit}`, { auth: true });
}

/**
 * Fetch the blob bytes for an envelope. Returns Uint8Array.
 * Server returns application/octet-stream (raw bytes).
 */
export async function fetchBlob(envelopeId) {
  const resp = await fetch(`${_relayUrl}/api/v1/messages/${envelopeId}`, {
    headers: { 'Authorization': `Bearer ${_sessionToken}` },
  });
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Acknowledge receipt of an envelope (removes from inbox).
 */
export async function ackEnvelope(envelopeId) {
  return http('DELETE', `/api/v1/messages/${envelopeId}`, { auth: true });
}

// ────────────────────────────────────────────────────────────
// WebSocket inbox
// ────────────────────────────────────────────────────────────

/**
 * Open a WebSocket connection to the inbox stream.
 *
 * Server: ws(s)://host/ws/v1/inbox?token=<session_token>
 * On open: server pushes catchup of pending, then real-time as new envelopes arrive.
 *
 * Returns the WebSocket object; caller wires up listeners.
 */
export function openInboxSocket(onMessage, onOpen, onClose, onError) {
  const wsUrl = _relayUrl.replace(/^http/, 'ws') + `/ws/v1/inbox?token=${encodeURIComponent(_sessionToken)}`;
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => onOpen?.(ws);
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      onMessage?.(data, ws);
    } catch (e) {
      console.warn('WS bad message:', e, ev.data);
    }
  };
  ws.onclose = (ev) => onClose?.(ev);
  ws.onerror = (ev) => onError?.(ev);
  return ws;
}
