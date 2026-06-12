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
 *   processIncomingGroupKeyRequest(senderPubkey, payload, seed, myPubkeyHex)
 *     called when a DM arrives with kind=group_key_request
 *     → if we have the group_key locally → DM it back as group_key
 *     → else ignore (some other member will respond)
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
 *   joinViaToken(token, seed, myPubkeyHex)
 *     → POST /api/v1/groups/join?token=...
 *     → GET /groups/{id} to get member list
 *     → DM kind=group_key_request to every other member
 *     → first one who responds (could be admin, could be any member with
 *       the key already) sends back kind=group_key
 *     → mark stub locally while we wait
 */

import * as api from './api.js';
import * as crypto from './crypto.js';
import * as gstore from './group_storage.js';
import * as msgs from './messages.js';
import { compressImage } from './images.js';
import { blobToBase64 } from './voice.js';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function nowSeconds() { return Math.floor(Date.now() / 1000); }

function wrapGroupPayload(kind, data) {
  return JSON.stringify({ kind, ...data });
}

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

export async function createGroup({
  name,
  members = [],
  defaultTtlSeconds = 86400,
  seed,
  myPubkeyHex,
}) {
  const groupKey = crypto.generateSymmetricKey();
  const groupKeyB64 = crypto.bytesToBase64(groupKey);
  const nameEncryptedB64 = crypto.encryptStringWithKey(groupKey, name);

  const groupInfo = await api.createGroup({
    nameEncryptedB64,
    defaultTtlSeconds,
  });

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

  let addedCount = 0;
  let failedCount = 0;
  for (const m of members) {
    try {
      await api.addGroupMember(groupInfo.group_id, m.pubkey_hex);
      await sendGroupKeyDM({
        seed, myPubkeyHex,
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

export async function sendGroupKeyDM({
  seed, myPubkeyHex, peerPubkeyHex,
  groupId, groupKeyB64, name,
}) {
  const payload = wrapGroupPayload('group_key', {
    group_id: groupId,
    key_b64: groupKeyB64,
    name,
  });
  await msgs.sendDM({
    seed, myPubkeyHex, peerPubkeyHex,
    plaintext: payload,
    ttlSeconds: 86400,
  });
}

/**
 * Send a group_key_request DM to a peer (presumably a group member
 * who already has the key).
 */
export async function sendGroupKeyRequestDM({
  seed, myPubkeyHex, peerPubkeyHex, groupId,
}) {
  const payload = wrapGroupPayload('group_key_request', {
    group_id: groupId,
  });
  await msgs.sendDM({
    seed, myPubkeyHex, peerPubkeyHex,
    plaintext: payload,
    ttlSeconds: 86400,
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
    console.warn('Group info fetch failed (will retry on open):', e?.message);
  }
}

/**
 * Called from messages.js when a DM with kind=group_key_request arrives.
 * If we have the group_key locally → DM it back. Else silently ignore.
 *
 * To prevent abuse, we only respond if the requester is actually a
 * current member of the group on the server.
 */
export async function processIncomingGroupKeyRequest({
  payload, senderPubkeyHex, seed, myPubkeyHex,
}) {
  if (!payload?.group_id) return;
  const group = gstore.getGroup(payload.group_id);
  if (!group || !group.group_key_b64) return; // we don't have the key either

  // Verify requester is actually a member (otherwise this is abuse)
  let info;
  try {
    info = await api.getGroupInfo(payload.group_id);
  } catch (e) {
    console.warn('Cannot verify requester membership:', e?.message);
    return;
  }
  const isMember = info.members.some((m) => m.pubkey_hex === senderPubkeyHex);
  if (!isMember) {
    console.warn('group_key_request from non-member, ignoring:', senderPubkeyHex);
    return;
  }

  try {
    await sendGroupKeyDM({
      seed, myPubkeyHex,
      peerPubkeyHex: senderPubkeyHex,
      groupId: payload.group_id,
      groupKeyB64: group.group_key_b64,
      name: group.name || '',
    });
    console.info('Sent group_key in reply to request from', senderPubkeyHex.slice(0, 8));
  } catch (e) {
    console.warn('Failed to send group_key reply:', e);
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

export async function sendGroupImage({
  groupId, file, caption = '',
  ttlSeconds = 86400,
  seed, myPubkeyHex,
}) {
  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    throw new Error('Немає ключа групи');
  }
  const groupKey = crypto.base64ToBytes(group.group_key_b64);

  const compressed = await compressImage(file);
  const payload = wrapGroupPayload('image', {
    data_b64: compressed.data_b64,
    mime: compressed.mime,
    w: compressed.w,
    h: compressed.h,
    caption: caption || '',
  });
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

  const localMsg = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    direction: 'out',
    sender_pubkey: myPubkeyHex,
    text: caption || '',
    image: {
      data_b64: compressed.data_b64,
      mime: compressed.mime,
      w: compressed.w,
      h: compressed.h,
    },
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
      status: 'failed', error: e.message,
    });
    throw e;
  }
}

/**
 * Send a voice note to a group. Wraps the recorded blob as
 * {kind:'voice', ...} JSON inside the group payload, encrypts with
 * the group key and broadcasts via the group endpoint.
 */
export async function sendGroupVoice({
  groupId, audioBlob, mimeType, durationMs,
  ttlSeconds = 86400,
  seed, myPubkeyHex,
}) {
  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    throw new Error('Немає ключа групи');
  }
  const groupKey = crypto.base64ToBytes(group.group_key_b64);

  const data_b64 = await blobToBase64(audioBlob);
  const rawSize = Math.floor(data_b64.length * 0.75);
  if (rawSize > 140 * 1024) {
    throw new Error(
      `Голосове завелике (${Math.round(rawSize / 1024)}KB). Запишіть коротше.`,
    );
  }

  const payload = wrapGroupPayload('voice', {
    data_b64,
    mime: mimeType || 'audio/webm',
    duration_ms: Math.max(0, Math.floor(durationMs || 0)),
  });
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

  const localMsg = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    direction: 'out',
    sender_pubkey: myPubkeyHex,
    text: '',
    voice: {
      data_b64,
      mime: mimeType || 'audio/webm',
      duration_ms: Math.max(0, Math.floor(durationMs || 0)),
    },
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
      status: 'failed', error: e.message,
    });
    throw e;
  }
}

/**
 * Send a reaction (or remove one) to a group message.
 *
 * Same model as sendDMReaction — wrapped as kind:'reaction' payload,
 * encrypted with the group key, broadcast via the group endpoint. Not
 * stored as a regular history entry on the sender side; the target
 * message's reactions get updated optimistically before send.
 */
export async function sendGroupReaction({
  groupId, targetEnvelopeId, emoji, op = 'add',
  ttlSeconds = 86400,
  seed, myPubkeyHex,
}) {
  if (!groupId || !targetEnvelopeId) throw new Error('no_target');
  if (op !== 'add' && op !== 'remove') throw new Error('bad_op');
  if (op === 'add' && !gstore.ALLOWED_REACTIONS.includes(emoji)) {
    throw new Error('bad_emoji');
  }

  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    throw new Error('Немає ключа групи');
  }
  const groupKey = crypto.base64ToBytes(group.group_key_b64);

  // Optimistic local update
  const previous = gstore.getMyGroupReaction(groupId, targetEnvelopeId, myPubkeyHex);
  gstore.applyReaction(groupId, targetEnvelopeId, emoji, op, myPubkeyHex);

  const payload = wrapGroupPayload('reaction', {
    target_envelope_id: targetEnvelopeId,
    emoji: op === 'add' ? emoji : '',
    op,
  });
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

  try {
    const ack = await api.sendGroupMessage(groupId, {
      from: myPubkeyHex,
      to: groupId,
      ts,
      ttl: ttlSeconds,
      blob: blobB64,
      sig,
    });
    return { envelope_id: ack.envelope_id, status: 'sent', control: true };
  } catch (e) {
    // Roll back optimistic update
    if (previous) {
      gstore.applyReaction(groupId, targetEnvelopeId, previous, 'add', myPubkeyHex);
    } else {
      gstore.applyReaction(groupId, targetEnvelopeId, emoji, 'remove', myPubkeyHex);
    }
    throw e;
  }
}

export async function processIncomingGroupEnvelope({ envMeta, myPubkeyHex }) {
  const envelopeId = envMeta.envelope_id;
  const groupId = envMeta.group_id;
  const senderPubkey = envMeta.from;
  const senderUsername = envMeta.from_username || null;

  if (!groupId || !senderPubkey) {
    console.warn('group envelope without group_id or sender:', envMeta);
    return null;
  }

  if (gstore.hasEnvelope(groupId, envelopeId)) return null;
  if (senderPubkey === myPubkeyHex) return null;

  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    console.warn('No group_key for group', groupId, '— stashing envelope as stub');
    return null;
  }

  let blobBytes;
  try {
    blobBytes = await api.fetchBlob(envelopeId);
  } catch (e) {
    console.warn('fetchBlob failed for group envelope', envelopeId, e);
    return null;
  }
  const blobB64 = crypto.bytesToBase64(blobBytes);

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

  if (payload.kind === 'image') {
    const msg = {
      id: `recv-${envelopeId.slice(0, 16)}`,
      envelope_id: envelopeId,
      direction: 'in',
      sender_pubkey: senderPubkey,
      sender_username: senderUsername,
      text: payload.caption || '',
      image: {
        data_b64: payload.data_b64,
        mime: payload.mime || 'image/jpeg',
        w: payload.w,
        h: payload.h,
      },
      ts: envMeta.ts || nowSeconds(),
      ttl: envMeta.ttl,
      expires_at: envMeta.expires_at,
      status: 'received',
    };
    gstore.appendMessage(groupId, msg);
    return msg;
  }

  if (payload.kind === 'voice') {
    const msg = {
      id: `recv-${envelopeId.slice(0, 16)}`,
      envelope_id: envelopeId,
      direction: 'in',
      sender_pubkey: senderPubkey,
      sender_username: senderUsername,
      text: '',
      voice: {
        data_b64: payload.data_b64,
        mime: payload.mime || 'audio/webm',
        duration_ms: payload.duration_ms || 0,
      },
      ts: envMeta.ts || nowSeconds(),
      ttl: envMeta.ttl,
      expires_at: envMeta.expires_at,
      status: 'received',
    };
    gstore.appendMessage(groupId, msg);
    return msg;
  }

  if (payload.kind === 'reaction') {
    const target = payload.target_envelope_id;
    const op = payload.op === 'remove' ? 'remove' : 'add';
    const emoji = typeof payload.emoji === 'string' ? payload.emoji : '';
    if (target) {
      // Whitelist + per-user dedupe enforced inside applyReaction
      gstore.applyReaction(groupId, target, emoji, op, senderPubkey);
    }
    return null;
  }

  console.warn('unknown group payload kind:', payload.kind);
  return null;
}

// ────────────────────────────────────────────────────────────
// Join / leave / delete
// ────────────────────────────────────────────────────────────

/**
 * Join a group via invite token, then auto-request the group_key from
 * existing members. Any member who has the key will reply with a
 * group_key DM, which our messages.js dispatcher will pick up
 * automatically.
 *
 * UI sees: tap link → wait 1-2 seconds → group with name appears.
 * No further action needed from the joining user or from the admin.
 */
export async function joinViaToken({ token, seed, myPubkeyHex }) {
  const result = await api.joinGroupViaToken(token);

  // Mark a pending stub locally
  gstore.upsertGroup({
    group_id: result.group_id,
    name: null,
    member_count: result.member_count,
  });

  // Now fetch the member list and DM key request to all other members.
  // This works whether the admin is online or not — any member with the
  // key will reply.
  try {
    const info = await api.getGroupInfo(result.group_id);
    gstore.upsertGroup({
      group_id: info.group_id,
      name: null,
      creator_pubkey_hex: info.creator_pubkey_hex,
      is_channel: info.is_channel,
      default_ttl_seconds: info.default_ttl_seconds,
      max_members: info.max_members,
      member_count: info.member_count,
      members: info.members,
    });

    const others = (info.members || []).filter(
      (m) => m.pubkey_hex !== myPubkeyHex,
    );
    // DM the request to everyone in parallel — first to respond wins.
    await Promise.all(others.map(async (m) => {
      try {
        await sendGroupKeyRequestDM({
          seed, myPubkeyHex,
          peerPubkeyHex: m.pubkey_hex,
          groupId: result.group_id,
        });
      } catch (e) {
        console.warn('group_key_request DM to', m.pubkey_hex.slice(0, 8), 'failed:', e?.message);
      }
    }));
  } catch (e) {
    console.warn('Could not fetch group info after join:', e?.message);
  }

  return result;
}

export async function leaveGroup(groupId, myPubkeyHex) {
  await api.removeGroupMember(groupId, myPubkeyHex);
  gstore.removeGroup(groupId);
}

export async function deleteGroupCompletely(groupId, seed = null) {
  await api.deleteGroup(groupId, seed);
  gstore.removeGroup(groupId);
}

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

/**
 * Чи означає помилка від релея, що групи більше не існує (видалена
 * адміном) або нас із неї прибрали. У такому разі локальну копію
 * треба знести — інакше "мертва" група висить у списку чатів вічно.
 */
export function isGroupGoneError(e) {
  return !!e && (e.status === 404 || e.status === 403);
}

/**
 * Фонова валідація всіх локальних груп проти релея. Видаляє ті,
 * яких на релеї вже немає. Викликається зі списку чатів (fire &
 * forget). Повертає true якщо щось видалили (треба перемалювати UI).
 *
 * Не частіше ніж раз на VALIDATE_INTERVAL_MS, щоб не довбати relay
 * GET-ами при кожному рендері списку.
 */
let _lastValidateTs = 0;
const VALIDATE_INTERVAL_MS = 20 * 1000;

export async function validateGroupsAgainstRelay() {
  const now = Date.now();
  if (now - _lastValidateTs < VALIDATE_INTERVAL_MS) return false;
  _lastValidateTs = now;

  const groups = gstore.listGroups ? gstore.listGroups() : [];
  let removedAny = false;
  await Promise.allSettled(groups.map(async (g) => {
    try {
      await api.getGroupInfo(g.group_id);
    } catch (e) {
      if (isGroupGoneError(e)) {
        gstore.removeGroup(g.group_id);
        removedAny = true;
      }
      // Мережеві/інші помилки ігноруємо — не видаляємо групу через
      // відсутність інтернету.
    }
  }));
  return removedAny;
}
