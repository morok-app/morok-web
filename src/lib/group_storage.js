/**
 * Local group cache + group_key storage.
 *
 * Schema:
 *   morok.groups.v1 → {
 *     [group_id]: {
 *       group_id,
 *       name,                  // plaintext name (decrypted with group_key)
 *       creator_pubkey_hex,
 *       is_channel,
 *       default_ttl_seconds,
 *       max_members,
 *       member_count,
 *       members: [{pubkey_hex, is_admin, joined_at, username?}],
 *       group_key_b64,         // 32-byte symmetric key, base64
 *       messages: [
 *         { id, envelope_id?, sender_pubkey,
 *           sender_username?, text, ts, ttl, expires_at, status }
 *       ],
 *       updated_at,
 *     }
 *   }
 *
 * Group messages live in the same shape as DM conversations to reuse
 * UI patterns where possible.
 */

import { getReadBurnSeconds } from './conversations.js';

const K = 'morok.groups.v1';
const HARD_CEILING_SECONDS = 30 * 86400;

function load() {
  try {
    const raw = localStorage.getItem(K);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function save(state) {
  try { localStorage.setItem(K, JSON.stringify(state)); }
  catch (e) { console.warn('groups save failed', e); }
}

/** Найраніший дедлайн зникнення (надсилання vs прочитання). */
function effectiveExpiry(m) {
  const a = m.expires_at || Infinity;
  const b = m.read_burn_at || Infinity;
  const e = Math.min(a, b);
  return e === Infinity ? null : e;
}

function reap(state) {
  const now = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const gid of Object.keys(state)) {
    const g = state[gid];
    if (!g.messages) continue;
    const before = g.messages.length;
    g.messages = g.messages.filter((m) => {
      const e = effectiveExpiry(m);
      return !e || e > now;
    });
    if (g.messages.length !== before) changed = true;
  }
  if (changed) save(state);
  return state;
}

/**
 * List all groups, sorted by last activity desc.
 */
export function listGroups() {
  const state = reap(load());
  return Object.values(state).sort(
    (a, b) => (b.updated_at || 0) - (a.updated_at || 0),
  );
}

export function getGroup(groupId) {
  const state = reap(load());
  return state[groupId] || null;
}

/**
 * Save / update a group's metadata + group_key.
 * Does NOT touch the messages array — that's done via appendMessage.
 */
export function upsertGroup({
  group_id, name, creator_pubkey_hex, is_channel, default_ttl_seconds,
  max_members, member_count, members, group_key_b64,
}) {
  const state = load();
  const existing = state[group_id] || {};
  state[group_id] = {
    ...existing,
    group_id,
    name: name ?? existing.name ?? null,
    creator_pubkey_hex: creator_pubkey_hex ?? existing.creator_pubkey_hex,
    is_channel: is_channel ?? existing.is_channel ?? false,
    default_ttl_seconds: default_ttl_seconds ?? existing.default_ttl_seconds ?? 86400,
    max_members: max_members ?? existing.max_members,
    member_count: member_count ?? existing.member_count,
    members: members ?? existing.members ?? [],
    group_key_b64: group_key_b64 ?? existing.group_key_b64 ?? null,
    messages: existing.messages || [],
    updated_at: existing.updated_at || Math.floor(Date.now() / 1000),
  };
  save(state);
  return state[group_id];
}

/**
 * Store just the group_key (used when received via group_key DM invite).
 * If the group is unknown locally, this creates a stub entry — full
 * metadata can be filled later via GET /groups/{id}.
 */
export function storeGroupKey(groupId, groupKeyB64, name) {
  const state = load();
  const existing = state[groupId] || {};
  state[groupId] = {
    ...existing,
    group_id: groupId,
    group_key_b64: groupKeyB64,
    name: name ?? existing.name ?? null,
    messages: existing.messages || [],
    updated_at: existing.updated_at || Math.floor(Date.now() / 1000),
  };
  save(state);
  return state[groupId];
}

export function getGroupKey(groupId) {
  const g = getGroup(groupId);
  return g?.group_key_b64 || null;
}

export function setGroupName(groupId, name) {
  const state = load();
  if (state[groupId]) {
    state[groupId].name = name;
    save(state);
  }
}

// ── Messages ────────────────────────────────────────────────

export function appendMessage(groupId, message) {
  const state = load();
  if (!state[groupId]) {
    state[groupId] = {
      group_id: groupId,
      name: null, creator_pubkey_hex: null,
      is_channel: false, default_ttl_seconds: 86400,
      max_members: 0, member_count: 0,
      members: [], group_key_b64: null,
      messages: [],
      updated_at: 0,
    };
  }
  if (message.ts && message.ttl) {
    const ceiling = message.ts + Math.min(message.ttl, HARD_CEILING_SECONDS);
    message.expires_at = Math.min(message.expires_at || ceiling, ceiling);
  }
  // Дедуп — та сама причина, що й у conversations.appendMessage:
  // повторний catchup після обриву WS до ack давав копію в групі.
  const mid = message?.id || message?.envelope_id;
  if (mid) {
    const list = state[groupId].messages;
    const at = list.findIndex((m) => (m?.id || m?.envelope_id) === mid);
    if (at >= 0) {
      list[at] = { ...list[at], ...message };
      state[groupId].updated_at = Math.floor(Date.now() / 1000);
      save(state);
      return;
    }
  }
  state[groupId].messages.push(message);
  state[groupId].updated_at = Math.floor(Date.now() / 1000);
  save(state);
}

export function updateMessage(groupId, messageId, updates) {
  const state = load();
  const g = state[groupId];
  if (!g) return;
  const m = g.messages.find((x) => x.id === messageId);
  if (m) {
    Object.assign(m, updates);
    save(state);
  }
}

export function hasEnvelope(groupId, envelopeId) {
  const state = load();
  const g = state[groupId];
  if (!g) return false;
  return g.messages.some((m) => m.envelope_id === envelopeId);
}

export function deleteMessage(groupId, messageId) {
  const state = load();
  const g = state[groupId];
  if (!g) return null;
  const idx = g.messages.findIndex((x) => x.id === messageId);
  if (idx < 0) return null;
  const [removed] = g.messages.splice(idx, 1);
  save(state);
  return removed;
}

/**
 * Remove a group message by its server envelope_id.
 *
 * Used by the WebSocket "deleted" event handler when sender or admin
 * removes a message group-wide — every member's client drops the
 * matching envelope from local store.
 *
 * Returns the removed message or null.
 */
export function deleteMessageByEnvelope(groupId, envelopeId) {
  if (!envelopeId) return null;
  const state = load();
  const g = state[groupId];
  if (!g) return null;
  const idx = g.messages.findIndex((x) => x.envelope_id === envelopeId);
  if (idx < 0) return null;
  const [removed] = g.messages.splice(idx, 1);
  save(state);
  return removed;
}

/**
 * Wipe local copy of a group (called after leave/delete on server).
 * Does NOT touch the server — caller is responsible for that.
 */
export function removeGroup(groupId) {
  const state = load();
  delete state[groupId];
  save(state);
}

export function markGroupRead(groupId) {
  const state = load();
  const g = state[groupId];
  if (!g) return;
  const now = Math.floor(Date.now() / 1000);
  const burn = getReadBurnSeconds();      // 0 = вимкнено
  let changed = false;
  for (const m of g.messages || []) {
    if (m.direction === 'in' && !m.read_at) {
      m.read_at = now;
      if (burn > 0 && !m.read_burn_at) m.read_burn_at = now + burn;
      changed = true;
    }
  }
  if (changed) save(state);
}

/**
 * Record that `readerPubkey` (some group member) has read our outgoing
 * group message identified by envelopeId. Adds the pubkey to a
 * deduplicated list under `read_by`. Returns the updated message
 * or null if it wasn't ours / not found / already recorded.
 *
 * UI shows aggregated count ("✓✓ N") so we never reveal which
 * specific members read; just how many.
 */
export function markOutgoingReadByMember(groupId, envelopeId, readerPubkey) {
  if (!groupId || !envelopeId || !readerPubkey) return null;
  const state = load();
  const g = state[groupId];
  if (!g) return null;
  const m = (g.messages || []).find(
    (x) => x.envelope_id === envelopeId && x.direction === 'out',
  );
  if (!m) return null;
  if (!Array.isArray(m.read_by)) m.read_by = [];
  if (m.read_by.includes(readerPubkey)) return null;
  m.read_by.push(readerPubkey);
  if (!m.read_at) {
    m.read_at = Math.floor(Date.now() / 1000);
    // Симетрія: коли перший учасник прочитав — моя копія згоряє (no trace).
    const burn = getReadBurnSeconds();
    if (burn > 0 && !m.read_burn_at) m.read_burn_at = m.read_at + burn;
  }
  save(state);
  return m;
}

export function countUnread(groupId) {
  const g = getGroup(groupId);
  if (!g) return 0;
  return (g.messages || []).filter((m) => m.direction === 'in' && !m.read_at).length;
}

export function getLastMessage(groupId) {
  const g = getGroup(groupId);
  if (!g || !g.messages || g.messages.length === 0) return null;
  return g.messages[g.messages.length - 1];
}

/**
 * Allowed reaction emoji — kept in sync with conversations.js.
 */
export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '🔥', '😢'];

/**
 * Apply a reaction (add or remove) to a target GROUP message.
 *
 * Mirrors conversations.js#applyReaction. One user → one reaction
 * per message. Returns the updated message or null.
 */
export function applyReaction(groupId, targetEnvelopeId, emoji, op, fromPubkey) {
  if (!groupId || !targetEnvelopeId || !fromPubkey) return null;
  if (op !== 'add' && op !== 'remove') return null;
  if (op === 'add' && !ALLOWED_REACTIONS.includes(emoji)) return null;

  const state = load();
  const g = state[groupId];
  if (!g) return null;
  const m = (g.messages || []).find((x) => x.envelope_id === targetEnvelopeId);
  if (!m) return null;

  if (!m.reactions || typeof m.reactions !== 'object') m.reactions = {};

  for (const e of Object.keys(m.reactions)) {
    m.reactions[e] = (m.reactions[e] || []).filter((p) => p !== fromPubkey);
    if (m.reactions[e].length === 0) delete m.reactions[e];
  }

  if (op === 'add') {
    if (!m.reactions[emoji]) m.reactions[emoji] = [];
    if (m.reactions[emoji].length < 200) {
      m.reactions[emoji].push(fromPubkey);
    }
  }

  save(state);
  return m;
}

export function getMyGroupReaction(groupId, targetEnvelopeId, myPubkey) {
  const g = getGroup(groupId);
  if (!g) return null;
  const m = (g.messages || []).find((x) => x.envelope_id === targetEnvelopeId);
  if (!m || !m.reactions) return null;
  for (const [emoji, pubkeys] of Object.entries(m.reactions)) {
    if (Array.isArray(pubkeys) && pubkeys.includes(myPubkey)) return emoji;
  }
  return null;
}
