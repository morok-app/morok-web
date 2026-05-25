/**
 * Local conversation cache in localStorage.
 */

const K = 'morok.conv.v1';
const HARD_CEILING_SECONDS = 30 * 86400;

function load() {
  try {
    const raw = localStorage.getItem(K);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(state) {
  try {
    localStorage.setItem(K, JSON.stringify(state));
  } catch (e) {
    console.warn('conversations save failed', e);
  }
}

function reap(state) {
  const now = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const peer of Object.keys(state)) {
    const conv = state[peer];
    const before = conv.messages.length;
    conv.messages = conv.messages.filter((m) => {
      if (!m.expires_at) return true;
      return m.expires_at > now;
    });
    if (conv.messages.length !== before) changed = true;
  }
  if (changed) save(state);
  return state;
}

export function listConversations() {
  const state = reap(load());
  return Object.values(state).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

export function getConversation(peerPubkey) {
  const state = reap(load());
  return state[peerPubkey] || null;
}

/**
 * Create or update a conversation.
 *
 * If peerUsername is passed:
 *   - It REPLACES the stored peer_username (even if one was already set).
 *   - This is so that when an anonymous peer later claims a username, the
 *     conversation reflects the new identity. Same in reverse: a peer who
 *     released their username (became anon) will be re-displayed correctly.
 *
 * To avoid clobbering a known username with a stale null, callers should
 * only pass peerUsername when they actually have one (either fresh from
 * server lookup or from envelope `from_username`). Don't pass `null`
 * to force an update; in that case omit the field.
 *
 * peerUsername === null + flag `explicitNull: true` does reset it back
 * to null (when the peer has demonstrably released their username).
 */
export function ensureConversation({
  peerPubkey, peerUsername, peerHomeRelay, explicitNull = false,
}) {
  const state = load();
  if (!state[peerPubkey]) {
    state[peerPubkey] = {
      peer_pubkey: peerPubkey,
      peer_username: peerUsername || null,
      peer_home_relay: peerHomeRelay || null,
      messages: [],
      updated_at: Math.floor(Date.now() / 1000),
    };
    save(state);
    return state[peerPubkey];
  }

  let changed = false;
  if (peerUsername !== undefined) {
    if (peerUsername) {
      // Always update with a fresh username
      if (state[peerPubkey].peer_username !== peerUsername) {
        state[peerPubkey].peer_username = peerUsername;
        changed = true;
      }
    } else if (explicitNull) {
      // Peer reset their username back to anonymous
      if (state[peerPubkey].peer_username !== null) {
        state[peerPubkey].peer_username = null;
        changed = true;
      }
    }
  }
  if (peerHomeRelay && !state[peerPubkey].peer_home_relay) {
    state[peerPubkey].peer_home_relay = peerHomeRelay;
    changed = true;
  }
  if (changed) save(state);
  return state[peerPubkey];
}

export function appendMessage(peerPubkey, message) {
  const state = load();
  if (!state[peerPubkey]) {
    state[peerPubkey] = {
      peer_pubkey: peerPubkey,
      peer_username: null,
      peer_home_relay: null,
      messages: [],
      updated_at: 0,
    };
  }
  if (message.ts && message.ttl) {
    const ceiling = message.ts + Math.min(message.ttl, HARD_CEILING_SECONDS);
    message.expires_at = Math.min(message.expires_at || ceiling, ceiling);
  }
  state[peerPubkey].messages.push(message);
  state[peerPubkey].updated_at = Math.floor(Date.now() / 1000);
  save(state);
}

export function updateMessage(peerPubkey, messageId, updates) {
  const state = load();
  const conv = state[peerPubkey];
  if (!conv) return;
  const m = conv.messages.find((x) => x.id === messageId);
  if (m) {
    Object.assign(m, updates);
    save(state);
  }
}

export function deleteMessage(peerPubkey, messageId) {
  const state = load();
  const conv = state[peerPubkey];
  if (!conv) return null;
  const idx = conv.messages.findIndex((x) => x.id === messageId);
  if (idx < 0) return null;
  const [removed] = conv.messages.splice(idx, 1);
  save(state);
  return removed;
}

/**
 * Remove a message from a peer's conversation by its server envelope_id.
 *
 * Used by the WebSocket "deleted" event handler: when a sender deletes
 * a DM remotely, the relay pushes the envelope_id to the recipient — we
 * find the local message that wraps that envelope and drop it.
 *
 * Returns the removed message or null if it wasn't there. Callers can
 * use the return value to decide whether to refresh UI.
 */
export function deleteMessageByEnvelope(peerPubkey, envelopeId) {
  if (!envelopeId) return null;
  const state = load();
  const conv = state[peerPubkey];
  if (!conv) return null;
  const idx = conv.messages.findIndex((x) => x.envelope_id === envelopeId);
  if (idx < 0) return null;
  const [removed] = conv.messages.splice(idx, 1);
  save(state);
  return removed;
}

export function hasEnvelope(peerPubkey, envelopeId) {
  const state = load();
  const conv = state[peerPubkey];
  if (!conv) return false;
  return conv.messages.some((m) => m.envelope_id === envelopeId);
}

export function deleteConversation(peerPubkey) {
  const state = load();
  delete state[peerPubkey];
  save(state);
}

export function getLastMessage(peerPubkey) {
  const conv = getConversation(peerPubkey);
  if (!conv || conv.messages.length === 0) return null;
  return conv.messages[conv.messages.length - 1];
}

export function markConversationRead(peerPubkey) {
  const state = load();
  const conv = state[peerPubkey];
  if (!conv) return;
  const now = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const m of conv.messages) {
    if (m.direction === 'in' && !m.read_at) {
      m.read_at = now;
      changed = true;
    }
  }
  if (changed) save(state);
}

export function countUnread(peerPubkey) {
  const conv = getConversation(peerPubkey);
  if (!conv) return 0;
  return conv.messages.filter((m) => m.direction === 'in' && !m.read_at).length;
}
