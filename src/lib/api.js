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
// Messages (1-on-1)
// ────────────────────────────────────────────────────────────

export async function sendEnvelope(envelope) {
  return http('POST', '/api/v1/messages', { body: envelope, auth: true });
}

export async function listInbox(limit = 50) {
  return http('GET', `/api/v1/messages?limit=${limit}`, { auth: true });
}

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

export async function ackEnvelope(envelopeId) {
  return http('DELETE', `/api/v1/messages/${envelopeId}`, { auth: true });
}

/**
 * Sender-initiated server-side delete of a DM.
 * Removes the message from the recipient's inbox AND pushes a delete
 * event onto their WebSocket. Best-effort: if the recipient already
 * acked the message, the queue removal is a no-op but the WS event
 * still goes out (so an online recipient drops it from local store).
 */
export async function deleteDMMessage(envelopeId, recipientPubkeyHex) {
  return http('POST', `/api/v1/messages/${envelopeId}/delete-for-recipient`, {
    body: { recipient_pubkey_hex: recipientPubkeyHex },
    auth: true,
  });
}

/**
 * Delete a group message. Authorized for the sender of the message
 * OR for the group admin. Removes from every member's inbox and pushes
 * a delete event on each member's channel.
 */
export async function deleteGroupMessage(groupId, envelopeId) {
  return http('POST', `/api/v1/groups/${groupId}/messages/${envelopeId}/delete`, {
    auth: true,
  });
}

// ────────────────────────────────────────────────────────────
// WebSocket inbox
// ────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────
// Encrypted backup
// ────────────────────────────────────────────────────────────

export async function uploadBackup({ encryptedSeedB64, kdfSaltB64, kdfParams }) {
  return http('POST', '/api/v1/backup', {
    body: {
      encrypted_seed_b64: encryptedSeedB64,
      kdf_salt_b64: kdfSaltB64,
      kdf_params: kdfParams || { alg: 'pbkdf2', hash: 'sha256', iter: 200000 },
      schema_version: 1,
    },
    auth: true,
  });
}

export async function getMyBackup() {
  return http('GET', '/api/v1/backup', { auth: true });
}

export async function deleteMyBackup() {
  return http('DELETE', '/api/v1/backup', { auth: true });
}

export async function restoreBackupByUsername(username) {
  return http('GET', `/api/v1/backup/by-username/${encodeURIComponent(username)}`);
}

// ────────────────────────────────────────────────────────────
// Groups (Day 6Б)
// ────────────────────────────────────────────────────────────

/**
 * Create a new group. `nameEncryptedB64` — base64 of XChaCha20-Poly1305
 * ciphertext of the group name encrypted with the freshly-generated group_key.
 *
 * Returns the full group info INCLUDING members (the creator becomes the
 * sole admin).
 */
export async function createGroup({
  nameEncryptedB64,
  isChannel = false,
  defaultTtlSeconds = 86400,
  anonymousSenders = false,
  expiresAt = null,
  slug = null,
}) {
  return http('POST', '/api/v1/groups', {
    body: {
      name_encrypted: nameEncryptedB64,
      is_channel: isChannel,
      default_ttl_seconds: defaultTtlSeconds,
      anonymous_senders: anonymousSenders,
      expires_at: expiresAt,
      slug,
    },
    auth: true,
  });
}

export async function listMyGroups() {
  return http('GET', '/api/v1/groups', { auth: true });
}

export async function getGroupInfo(groupId) {
  return http('GET', `/api/v1/groups/${groupId}`, { auth: true });
}

export async function deleteGroup(groupId) {
  return http('DELETE', `/api/v1/groups/${groupId}`, { auth: true });
}

export async function addGroupMember(groupId, pubkeyHex) {
  return http('POST', `/api/v1/groups/${groupId}/members`, {
    body: { pubkey_hex: pubkeyHex },
    auth: true,
  });
}

export async function removeGroupMember(groupId, pubkeyHex) {
  return http('DELETE', `/api/v1/groups/${groupId}/members/${pubkeyHex}`, { auth: true });
}

/**
 * Broadcast a signed envelope to all group members.
 * envelope = { from, to (=group_id), ts, ttl, blob, sig }
 */
export async function sendGroupMessage(groupId, envelope) {
  return http('POST', `/api/v1/groups/${groupId}/messages`, {
    body: envelope,
    auth: true,
  });
}

// ────────────────────────────────────────────────────────────
// Group invite tokens (Day 6Б — variant B)
// ────────────────────────────────────────────────────────────

export async function createInviteToken(groupId, ttlSeconds) {
  return http('POST', `/api/v1/groups/${groupId}/invites`, {
    body: ttlSeconds ? { ttl_seconds: ttlSeconds } : {},
    auth: true,
  });
}

export async function listInviteTokens(groupId) {
  return http('GET', `/api/v1/groups/${groupId}/invites`, { auth: true });
}

export async function revokeInviteToken(groupId, token) {
  return http('DELETE', `/api/v1/groups/${groupId}/invites/${token}`, { auth: true });
}

export async function joinGroupViaToken(token) {
  return http('POST', `/api/v1/groups/join?token=${encodeURIComponent(token)}`, {
    auth: true,
  });
}
// ───────────────────────────────────────────────────────────
// Dead Man's Switch (Day 7)
// ───────────────────────────────────────────────────────────

/**
 * Create a DMS armed for `trigger_seconds` of inactivity.
 *
 * payloadEncryptedB64 is base64 ciphertext (encrypted FOR the recipient
 * with a regular DM-style DH key, same as a normal DM blob). The relay
 * will deliver this exact blob to the recipient when the switch fires.
 *
 * recipientPubkeysHex — array of pubkey hex strings. We pass exactly 1
 * in the MVP (UI enforces this).
 */
export async function createDMS({
  triggerSeconds,
  payloadEncryptedB64,
  recipientPubkeysHex,
  label = null,
}) {
  return http('POST', '/api/v1/dms', {
    body: {
      trigger_seconds: triggerSeconds,
      payload_encrypted: payloadEncryptedB64,
      recipient_pubkeys_hex: recipientPubkeysHex,
      label,
    },
    auth: true,
  });
}

/**
 * List all my DMS (any status).
 */
export async function listMyDMS() {
  return http('GET', '/api/v1/dms', { auth: true });
}

/**
 * Get details of one DMS.
 */
export async function getDMS(dmsId) {
  return http('GET', `/api/v1/dms/${dmsId}`, { auth: true });
}

/**
 * Check in — resets the inactivity timer to "now".
 * Only valid for ARMED switches; CANCELLED/TRIGGERED → 409.
 */
export async function checkInDMS(dmsId) {
  return http('POST', `/api/v1/dms/${dmsId}/check-in`, { auth: true });
}

/**
 * Cancel a DMS. Idempotent.
 */
export async function cancelDMS(dmsId) {
  return http('DELETE', `/api/v1/dms/${dmsId}`, { auth: true });
}
// ────────────────────────────────────────────────────────────
// Burner inbox (Day 7)
// ────────────────────────────────────────────────────────────

/**
 * Create a new burner token (owner-side, authenticated).
 *
 * Returns: { token, owner_pubkey_hex, label, created_at, expires_at, message_count }
 */
export async function createBurnerToken({ ttlSeconds, label }) {
  return http('POST', '/api/v1/burner', {
    body: { ttl_seconds: ttlSeconds, label },
    auth: true,
  });
}

/**
 * List my active burner tokens (owner-side, authenticated).
 *
 * Returns: { tokens: BurnerInfo[] }
 */
export async function listBurnerTokens() {
  return http('GET', '/api/v1/burner', { auth: true });
}

/**
 * Revoke a burner token (owner-side, authenticated).
 */
export async function revokeBurnerToken(token) {
  return http('DELETE', `/api/v1/burner/${encodeURIComponent(token)}`, {
    auth: true,
  });
}

/**
 * PUBLIC: Get the owner's pubkey for a burner token. No auth.
 * Used by the burner-send web form.
 *
 * Returns: { owner_pubkey_hex, label, expires_at }
 */
export async function getBurnerPublic(token) {
  return http('GET', `/api/v1/burner/public/${encodeURIComponent(token)}`);
}

/**
 * PUBLIC: Submit an encrypted message via a burner token. No auth.
 *
 * Returns: { envelope_id, queued, expires_at, message_count }
 */
export async function sendViaBurner({
  token,
  ephemeralPubkeyHex,
  blobB64,
  senderLabel,
}) {
  return http('POST', `/api/v1/burner/public/${encodeURIComponent(token)}/send`, {
    body: {
      ephemeral_pubkey_hex: ephemeralPubkeyHex,
      blob_b64: blobB64,
      sender_label: senderLabel || null,
    },
  });
}
