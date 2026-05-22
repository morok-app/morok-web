/**
 * Group business logic.
 *
 * High-level operations:
 *
 *   createGroup(name, memberPubkeys)
 *     → generate group_key
 *     → encrypt name with group_key
 *     → POST /api/v1/groups
 *     → add each member via add_member endpoint
 *     → send each member a DM with kind=group_key carrying the group_key
 *     → store locally
 *
 *   processIncomingGroupKey(payload)
 *     called when a DM arrives with kind=group_key
 *     → store group_key locally
 *     → GET /groups/{id} to fetch metadata + decrypt name
 *
 *   sendGroupMessage(groupId, text, ttl)
 *     → wrap in JSON {kind: 'group_msg', text}
 *     → encrypt with group_key
 *     → sign envelope (to=group_id)
 *     → POST /api/v1/groups/{id}/messages
 *
 *   processIncomingGroupEnvelope(envMeta, ourSeedBytes, ourPubkeyHex)
 *     → fetch blob
 *     → decrypt with stored group_key
 *     → parse JSON, dispatch by kind
 *     → store as message in group_storage
 *
 *   joinViaToken(token)
 *     → POST /api/v1/groups/join?token=...
 *     → returns {group_id, member_count}
 *     → no group_key yet — admin must DM it. We mark the group "pending key"
 *       so the UI can show a placeholder.
 */

import * as api from './api.js';
import * as crypto from './crypto.js';
import * as gstore from './group_storage.js';
import * as msgs from './messages.js';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function nowSeconds() { return Math.floor(Date.now() / 1000); }

/**
 * Wrap arbitrary group payload in a kind-tagged JSON envelope.
 */
function wrapGroupPayload(kind, data) {
  return JSON.stringify({ kind, ...data });
}

/**
 * Try parsing a group plaintext into {kind, ...}.
 * Returns null if not JSON or no kind.
 */
function parseGroupPayload(plaintext) {
  try {
    const obj = JSON.parse(plaintext);
    if (obj && typeof obj === 'object' && typeof obj.kind === 'string') {
      return obj;
    }
  } catch {}
  return null;
}

// ────────────────────────────────────────────────────────────
// Create group
// ────────────────────────────────────────────────────────────

/**
 * Create a group, generate a key, encrypt the name, then optionally
 * add members (DMing them the key).
 *
 * Params:
 *   name                   — plaintext name
 *   members                — array of { pubkey_hex, username } to add
 *   defaultTtlSeconds      — default message TTL for this group
 *   seed, myPubkeyHex      — needed to DM the key to each member
 *
 * Returns: { group_id, group, addedCount, failedCount }
 */
export async function createGroup({
  name,
  members = [],
  defaultTtlSeconds = 86400,
  seed,
  myPubkeyHex,
}) {
  // 1. Generate fresh group_key
  const groupKey = crypto.generateSymmetricKey();
  const groupKeyB64 = crypto.bytesToBase64(groupKey);

  // 2. Encrypt name with group_key
  const nameEncryptedB64 = crypto.encryptStringWithKey(groupKey, name);

  // 3. Create on server
  const groupInfo = await api.createGroup({
    nameEncryptedB64,
    defaultTtlSeconds,
  });

  // 4. Store locally — creator is automatically the admin
  gstore.upsertGroup({
    group_id: groupInfo.group_id,
    name,
    creator_pubkey_hex: groupInfo.creator_pubkey_hex,
    is_channel: groupInfo.is_channel,
    default_ttl_seconds: groupInfo.default_ttl_seconds,
    max_members: groupInfo.max_members,
    member_count: groupInfo.member_count,
    members: groupInfo.members,
    group_key_b64: groupKeyB64,
  });

  // 5. Add members and send each their group_key via DM
  let addedCount = 0;
  let failedCount = 0;
  for (const m of members) {
    try {
      await api.addGroupMember(groupInfo.group_id, m.pubkey_hex);
      await sendGroupKeyDM({
        seed,
        myPubkeyHex,
        peerPubkeyHex: m.pubkey_hex,
        groupId: groupInfo.group_id,
        groupKeyB64,
        name,
      });
      addedCount++;
    } catch (e) {
      console.warn('Failed to add or DM key to member', m.pubkey_hex, e);
      failedCount++;
    }
  }

  // Refresh group info after adding members
  if (addedCount > 0) {
    try {
      const fresh = await api.getGroupInfo(groupInfo.group_id);
      gstore.upsertGroup({
        group_id: fresh.group_id,
        name,
        creator_pubkey_hex: fresh.creator_pubkey_hex,
        is_channel: fresh.is_channel,
        default_ttl_seconds: fresh.default_ttl_seconds,
        max_members: fresh.max_members,
        member_count: fresh.member_count,
        members: fresh.members,
        group_key_b64: groupKeyB64,
      });
    } catch (e) { console.warn('group refresh failed:', e); }
  }

  return {
    group_id: groupInfo.group_id,
    group: gstore.getGroup(groupInfo.group_id),
    addedCount,
    failedCount,
  };
}

// ────────────────────────────────────────────────────────────
// Group key DM distribution
// ────────────────────────────────────────────────────────────

/**
 * Send the group_key to a peer via a regular DM (kind=group_key).
 * The peer's client will recognize the kind and store the key locally.
 */
export async function sendGroupKeyDM({
  seed, myPubkeyHex, peerPubkeyHex,
  groupId, groupKeyB64, name,
}) {
  const payload = wrapGroupPayload('group_key', {
    group_id: groupId,
    key_b64: groupKeyB64,
    name,
  });
  // Use the existing DM sendDM helper but with a longer TTL so the key
  // survives until recipient comes online (7 days hard cap on server).
  await msgs.sendDM({
    seed, myPubkeyHex, peerPubkeyHex,
    plaintext: payload,
    ttlSeconds: 86400,  // 1 day
  });
}

/**
 * Called from messages.js when a DM with kind=group_key arrives.
 * Stores the key locally and fetches group metadata.
 */
export async function processIncomingGroupKey({ payload }) {
  if (!payload?.group_id || !payload?.key_b64) {
    console.warn('group_key DM missing fields:', payload);
    return;
  }
  gstore.storeGroupKey(payload.group_id, payload.key_b64, payload.name || null);

  // Try fetching full group info to populate members etc.
  try {
    const info = await api.getGroupInfo(payload.group_id);
    gstore.upsertGroup({
      group_id: info.group_id,
      name: payload.name || null,
      creator_pubkey_hex: info.creator_pubkey_hex,
      is_channel: info.is_channel,
      default_ttl_seconds: info.default_ttl_seconds,
      max_members: info.max_members,
      member_count: info.member_count,
      members: info.members,
      group_key_b64: payload.key_b64,
    });
  } catch (e) {
    // Common: 403 not_a_member (we haven't been added yet when DM arrived
    // before server-side add_member). Group will be filled in later when
    // user opens it.
    console.warn('Group info fetch failed (will retry on open):', e?.message);
  }
}

// ────────────────────────────────────────────────────────────
// Send group message
// ────────────────────────────────────────────────────────────

export async function sendGroupMessage({
  groupId, text, ttlSeconds = 86400,
  seed, myPubkeyHex,
}) {
  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    throw new Error('Немає ключа групи');
  }
  const groupKey = crypto.base64ToBytes(group.group_key_b64);

  const payload = wrapGroupPayload('group_msg', { text });
  const blobB64 = crypto.encryptStringWithKey(groupKey, payload);

  const ts = nowSeconds();
  const sig = crypto.signEnvelope({
    seed,
    fromHex: myPubkeyHex,
    toHex: groupId,
    ts,
    ttl: ttlSeconds,
    blobB64,
  });

  // Optimistic local
  const localMsg = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    direction: 'out',
    sender_pubkey: myPubkeyHex,
    text,
    ts,
    ttl: ttlSeconds,
    expires_at: ts + ttlSeconds,
    status: 'sending',
  };
  gstore.appendMessage(groupId, localMsg);

  try {
    const ack = await api.sendGroupMessage(groupId, {
      from: myPubkeyHex,
      to: groupId,
      ts,
      ttl: ttlSeconds,
      blob: blobB64,
      sig,
    });
    gstore.updateMessage(groupId, localMsg.id, {
      envelope_id: ack.envelope_id,
      status: 'sent',
      expires_at: ack.expires_at || (ts + ttlSeconds),
    });
    return { ...localMsg, envelope_id: ack.envelope_id, status: 'sent' };
  } catch (e) {
    gstore.updateMessage(groupId, localMsg.id, {
      status: 'failed',
      error: e.message,
    });
    throw e;
  }
}

// ────────────────────────────────────────────────────────────
// Process incoming group envelope
// ────────────────────────────────────────────────────────────

/**
 * Called from messages.js when an envelope arrives with `group_id` in meta.
 *
 * Returns the new message object, or null if nothing happened (duplicate,
 * undecryptable, unknown group, etc.).
 */
export async function processIncomingGroupEnvelope({ envMeta, myPubkeyHex }) {
  const envelopeId = envMeta.envelope_id;
  const groupId = envMeta.group_id;
  const senderPubkey = envMeta.from;
  const senderUsername = envMeta.from_username || null;

  if (!groupId || !senderPubkey) {
    console.warn('group envelope without group_id or sender:', envMeta);
    return null;
  }

  // Dedup
  if (gstore.hasEnvelope(groupId, envelopeId)) return null;

  // Sender is ourselves — we already have the local optimistic copy.
  // Just mark the envelope as known (so we don't re-process).
  if (senderPubkey === myPubkeyHex) {
    // We have no good way to map envelope_id → local id; safest is to
    // append a marker so dedup hits next time. But that would duplicate
    // the message. Cleaner: scan for a 'sending'/'sent' message without
    // envelope_id and patch envelope_id in. If none found — assume it's
    // already there.
    return null;
  }

  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    // We don't have a key for this group. Probably we'll get a group_key
    // DM soon (or already had it, and lost it). Store as a stub.
    console.warn('No group_key for group', groupId, '— stashing envelope as stub');
    return null;
  }

  // Fetch blob
  let blobBytes;
  try {
    blobBytes = await api.fetchBlob(envelopeId);
  } catch (e) {
    console.warn('fetchBlob failed for group envelope', envelopeId, e);
    return null;
  }
  const blobB64 = crypto.bytesToBase64(blobBytes);

  // Decrypt
  let plaintext;
  try {
    const groupKey = crypto.base64ToBytes(group.group_key_b64);
    plaintext = crypto.decryptStringWithKey(groupKey, blobB64);
  } catch (e) {
    console.warn('Group decrypt failed:', e);
    const stub = {
      id: `recv-${envelopeId.slice(0, 16)}`,
      envelope_id: envelopeId,
      direction: 'in',
      sender_pubkey: senderPubkey,
      sender_username: senderUsername,
      text: null,
      ts: envMeta.ts || nowSeconds(),
      ttl: envMeta.ttl,
      expires_at: envMeta.expires_at,
      status: 'undecryptable',
      error: 'Не вдалось розшифрувати',
    };
    gstore.appendMessage(groupId, stub);
    return stub;
  }

  // Parse payload
  const payload = parseGroupPayload(plaintext);
  if (!payload) {
    console.warn('group payload not JSON / no kind:', plaintext.slice(0, 100));
    return null;
  }

  if (payload.kind === 'group_msg') {
    const msg = {
      id: `recv-${envelopeId.slice(0, 16)}`,
      envelope_id: envelopeId,
      direction: 'in',
      sender_pubkey: senderPubkey,
      sender_username: senderUsername,
      text: payload.text || '',
      ts: envMeta.ts || nowSeconds(),
      ttl: envMeta.ttl,
      expires_at: envMeta.expires_at,
      status: 'received',
    };
    gstore.appendMessage(groupId, msg);
    return msg;
  }

  // Unknown kind — log and skip
  console.warn('unknown group payload kind:', payload.kind);
  return null;
}

// ────────────────────────────────────────────────────────────
// Join / leave / delete
// ────────────────────────────────────────────────────────────

export async function joinViaToken(token) {
  const result = await api.joinGroupViaToken(token);
  // Group info we'll know after we receive the group_key DM from admin.
  // For now, mark a pending stub locally.
  gstore.upsertGroup({
    group_id: result.group_id,
    name: null,  // unknown until key arrives
    member_count: result.member_count,
  });
  return result;
}

export async function leaveGroup(groupId, myPubkeyHex) {
  await api.removeGroupMember(groupId, myPubkeyHex);
  gstore.removeGroup(groupId);
}

export async function deleteGroupCompletely(groupId) {
  await api.deleteGroup(groupId);
  gstore.removeGroup(groupId);
}

/**
 * Refresh member list and metadata from server.
 */
export async function refreshGroup(groupId) {
  const info = await api.getGroupInfo(groupId);
  const existing = gstore.getGroup(groupId);
  gstore.upsertGroup({
    group_id: info.group_id,
    name: existing?.name ?? null,
    creator_pubkey_hex: info.creator_pubkey_hex,
    is_channel: info.is_channel,
    default_ttl_seconds: info.default_ttl_seconds,
    max_members: info.max_members,
    member_count: info.member_count,
    members: info.members,
    group_key_b64: existing?.group_key_b64,
  });
  return gstore.getGroup(groupId);
}

/**
 * Admin adds an existing pubkey by username lookup.
 * Then sends group_key DM. UI calls this from "Додати учасника".
 */
export async function addMemberAndSendKey({
  groupId, newPubkeyHex,
  seed, myPubkeyHex,
}) {
  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    throw new Error('Немає ключа групи');
  }
  await api.addGroupMember(groupId, newPubkeyHex);
  await sendGroupKeyDM({
    seed, myPubkeyHex,
    peerPubkeyHex: newPubkeyHex,
    groupId,
    groupKeyB64: group.group_key_b64,
    name: group.name || '',
  });
  return await refreshGroup(groupId);
}

export { parseGroupPayload };
