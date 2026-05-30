/**
 * Message pipeline.
 *
 * Two distinct kinds of envelopes arrive:
 *
 *   1. DM envelopes (1-on-1)
 *      meta.to is a 64-hex pubkey, no group_id
 *      blob is XChaCha20-Poly1305 with DH-derived key
 *
 *   2. Group envelopes (broadcast to group members)
 *      meta.to is a UUID-string, meta.group_id is set
 *      blob is XChaCha20-Poly1305 with the group's symmetric group_key
 *
 * processIncoming dispatches based on meta.group_id.
 *
 * For DMs we also detect control payloads (kind=group_key,
 * kind=group_key_request) and dispatch to the groups module silently.
 */

import * as api from './api.js';
import * as crypto from './crypto.js';
import * as convs from './conversations.js';
import { compressImage } from './images.js';

// Kinds that are purely protocol signalling — never shown to the user
// and never stored in conversation history. Everything else (raw text,
// {kind:'image'}, future content kinds) is a real message.
const CONTROL_KINDS = new Set(['group_key', 'group_key_request']);

export async function sendDM({ seed, myPubkeyHex, peerPubkeyHex, plaintext, ttlSeconds }) {
  const ts = Math.floor(Date.now() / 1000);
  const blob = crypto.encryptForPeer({
    seed,
    myPubkeyHex,
    peerPubkeyHex,
    plaintext,
  });
  const sig = crypto.signEnvelope({
    seed,
    fromHex: myPubkeyHex,
    toHex: peerPubkeyHex,
    ts,
    ttl: ttlSeconds,
    blobB64: blob,
  });

  // Detect control messages (group_key, group_key_request) — these
  // should be invisible to the sender too. Send and return without
  // touching conversations storage. Content payloads like {kind:'image'}
  // are NOT control — they're real messages that the sender must see
  // in their own UI.
  const parsedCtl = tryParseControl(plaintext);
  const isControl = !!(parsedCtl && CONTROL_KINDS.has(parsedCtl.kind));
  if (isControl) {
    const ack = await api.sendEnvelope({
      from: myPubkeyHex,
      to: peerPubkeyHex,
      ts,
      ttl: ttlSeconds,
      blob,
      sig,
    });
    return { envelope_id: ack.envelope_id, status: 'sent', control: true };
  }

  const localMsg = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    direction: 'out',
    peer_pubkey: peerPubkeyHex,
    text: plaintext,
    ts,
    ttl: ttlSeconds,
    expires_at: ts + ttlSeconds,
    status: 'sending',
  };
  convs.appendMessage(peerPubkeyHex, localMsg);

  try {
    const ack = await api.sendEnvelope({
      from: myPubkeyHex,
      to: peerPubkeyHex,
      ts,
      ttl: ttlSeconds,
      blob,
      sig,
    });
    convs.updateMessage(peerPubkeyHex, localMsg.id, {
      envelope_id: ack.envelope_id,
      status: 'sent',
      expires_at: ack.expires_at || (ts + ttlSeconds),
    });
    return { ...localMsg, envelope_id: ack.envelope_id, status: 'sent' };
  } catch (e) {
    convs.updateMessage(peerPubkeyHex, localMsg.id, {
      status: 'failed',
      error: e.message,
    });
    throw e;
  }
}

/**
 * Send a DM but do NOT store it in the local conversation log.
 * Used for invisible control messages (group_key, group_key_request).
 *
 * NOTE: currently we still go through sendDM and then delete the local
 * record afterwards — simpler than duplicating sendDM logic, and the
 * brief flash in the chat list is acceptable.
 */

/**
 * Send an image DM. Compresses the file client-side, wraps it as
 * {kind:'image', ...} JSON, encrypts and sends. The local conversation
 * log gets a message with `image` populated and `text` set to the
 * caption (which may be empty).
 *
 * Throws if compression fails or sending fails. On success returns the
 * stored message object.
 */
export async function sendDMImage({
  seed, myPubkeyHex, peerPubkeyHex,
  file, caption = '', ttlSeconds,
}) {
  const compressed = await compressImage(file);
  const payload = JSON.stringify({
    kind: 'image',
    data_b64: compressed.data_b64,
    mime: compressed.mime,
    w: compressed.w,
    h: compressed.h,
    caption: caption || '',
  });

  const ts = Math.floor(Date.now() / 1000);
  const blob = crypto.encryptForPeer({
    seed, myPubkeyHex, peerPubkeyHex, plaintext: payload,
  });
  const sig = crypto.signEnvelope({
    seed,
    fromHex: myPubkeyHex,
    toHex: peerPubkeyHex,
    ts,
    ttl: ttlSeconds,
    blobB64: blob,
  });

  const localMsg = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    direction: 'out',
    peer_pubkey: peerPubkeyHex,
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
  convs.appendMessage(peerPubkeyHex, localMsg);

  try {
    const ack = await api.sendEnvelope({
      from: myPubkeyHex,
      to: peerPubkeyHex,
      ts,
      ttl: ttlSeconds,
      blob,
      sig,
    });
    convs.updateMessage(peerPubkeyHex, localMsg.id, {
      envelope_id: ack.envelope_id,
      status: 'sent',
      expires_at: ack.expires_at || (ts + ttlSeconds),
    });
    return { ...localMsg, envelope_id: ack.envelope_id, status: 'sent' };
  } catch (e) {
    convs.updateMessage(peerPubkeyHex, localMsg.id, {
      status: 'failed', error: e.message,
    });
    throw e;
  }
}

function tryParseControl(plaintext) {
  if (!plaintext || plaintext.length < 2) return null;
  if (plaintext[0] !== '{') return null;
  try {
    const obj = JSON.parse(plaintext);
    if (obj && typeof obj === 'object' && typeof obj.kind === 'string') {
      return obj;
    }
  } catch {}
  return null;
}

/**
 * Process an incoming envelope.
 *
 * If meta.group_id is present → dispatch to groups module.
 * Else → DM. Decrypt with peer key.
 *        If plaintext is {"kind":"group_key",...} → store key, no message.
 *        If plaintext is {"kind":"group_key_request",...} → auto-reply, no message.
 *
 * Returns the message object stored (or null).
 */
export async function processIncoming({ envMeta, seed, myPubkeyHex }) {
  const envelopeId = envMeta.envelope_id;

  // ── GROUP envelope ──────────────────────────────────────
  if (envMeta.group_id) {
    const groupsMod = await import('./groups.js');
    return await groupsMod.processIncomingGroupEnvelope({
      envMeta, myPubkeyHex,
    });
  }

  // ── DM envelope ─────────────────────────────────────────
  const peer = envMeta.sender_pubkey_hex || envMeta.from_pubkey || envMeta.from;
  const senderUsername = envMeta.from_username || null;
  if (!peer) {
    console.warn('Envelope without sender field:', envMeta);
    return null;
  }

  if (convs.hasEnvelope(peer, envelopeId)) return null;

  let blobBytes;
  try {
    blobBytes = await api.fetchBlob(envelopeId);
  } catch (e) {
    console.warn('fetchBlob failed for', envelopeId, e);
    return null;
  }
  const blobB64 = crypto.bytesToBase64(blobBytes);

  let plaintext;
  try {
    plaintext = crypto.decryptFromPeer({
      seed, myPubkeyHex,
      peerPubkeyHex: peer,
      blobB64,
    });
  } catch (e) {
    console.warn('Decrypt failed:', e);
    if (senderUsername) {
      convs.ensureConversation({ peerPubkey: peer, peerUsername: senderUsername });
    }
    const stub = {
      id: `recv-${envelopeId.slice(0, 16)}`,
      envelope_id: envelopeId,
      direction: 'in',
      peer_pubkey: peer,
      text: null,
      ts: envMeta.timestamp || envMeta.ts || Math.floor(Date.now() / 1000),
      ttl: envMeta.ttl_seconds || envMeta.ttl,
      expires_at: envMeta.expires_at,
      status: 'undecryptable',
      error: 'Не вдалось розшифрувати',
    };
    convs.appendMessage(peer, stub);
    return stub;
  }

  // Backfill peer_username if envelope brought one
  if (senderUsername) {
    convs.ensureConversation({ peerPubkey: peer, peerUsername: senderUsername });
  }

  // Control message?
  const control = tryParseControl(plaintext);
  if (control) {
    if (control.kind === 'group_key') {
      try {
        const groupsMod = await import('./groups.js');
        await groupsMod.processIncomingGroupKey({ payload: control });
      } catch (e) {
        console.warn('group_key processing failed:', e);
      }
      return null;
    }
    if (control.kind === 'group_key_request') {
      try {
        const groupsMod = await import('./groups.js');
        await groupsMod.processIncomingGroupKeyRequest({
          payload: control,
          senderPubkeyHex: peer,
          seed,
          myPubkeyHex,
        });
      } catch (e) {
        console.warn('group_key_request processing failed:', e);
      }
      return null;
    }
    if (control.kind === 'image') {
      // CONTENT — a real message with an image attached. Store with
      // both `image` and `text` (caption, may be empty).
      const msg = {
        id: `recv-${envelopeId.slice(0, 16)}`,
        envelope_id: envelopeId,
        direction: 'in',
        peer_pubkey: peer,
        text: control.caption || '',
        image: {
          data_b64: control.data_b64,
          mime: control.mime || 'image/jpeg',
          w: control.w,
          h: control.h,
        },
        ts: envMeta.timestamp || envMeta.ts || Math.floor(Date.now() / 1000),
        ttl: envMeta.ttl_seconds || envMeta.ttl,
        expires_at: envMeta.expires_at,
        status: 'received',
      };
      convs.appendMessage(peer, msg);
      return msg;
    }
    // Unknown control kind → fall through to display as text
  }

  const msg = {
    id: `recv-${envelopeId.slice(0, 16)}`,
    envelope_id: envelopeId,
    direction: 'in',
    peer_pubkey: peer,
    text: plaintext,
    ts: envMeta.timestamp || envMeta.ts || Math.floor(Date.now() / 1000),
    ttl: envMeta.ttl_seconds || envMeta.ttl,
    expires_at: envMeta.expires_at,
    status: 'received',
  };
  convs.appendMessage(peer, msg);
  return msg;
}
