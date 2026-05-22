/**
 * Message pipeline.
 *
 * Send flow:
 *   plaintext + peer pubkey
 *     → encrypt with shared key
 *     → wrap in envelope {from, to, ts, ttl, blob, sig}
 *     → POST /api/v1/messages
 *     → store in local conversation as 'sent' status
 *
 * Receive flow (from WS or polling):
 *   server gives us envelope_id + metadata (now includes from_username!)
 *     → fetch blob bytes (GET /api/v1/messages/{id})
 *     → decrypt with sender's pubkey
 *     → store in local conversation as 'received'
 *     → backfill peer_username on the conversation if we didn't know it
 *     → ack to server
 */

import * as api from './api.js';
import * as crypto from './crypto.js';
import * as convs from './conversations.js';

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
 * Process an incoming envelope (from WS or catchup).
 *
 * envMeta now may contain:
 *   from               — sender pubkey hex
 *   from_username      — sender's username snapshot (NEW)
 *   to                 — recipient pubkey hex
 *   ts, ttl, sig, expires_at, envelope_id
 *
 * If `from_username` is present and we don't have it cached on the
 * conversation, we backfill it.
 */
export async function processIncoming({ envMeta, seed, myPubkeyHex }) {
  const envelopeId = envMeta.envelope_id;
  const peer = envMeta.sender_pubkey_hex || envMeta.from_pubkey || envMeta.from;
  const senderUsername = envMeta.from_username || null;

  if (!peer) {
    console.warn('Envelope without sender field:', envMeta);
    return null;
  }

  // De-dup by envelope_id in conversation
  if (convs.hasEnvelope(peer, envelopeId)) {
    return null;
  }

  // Fetch encrypted blob bytes from server
  let blobBytes;
  try {
    blobBytes = await api.fetchBlob(envelopeId);
  } catch (e) {
    console.warn('fetchBlob failed for', envelopeId, e);
    return null;
  }

  // Decrypt
  const blobB64 = crypto.bytesToBase64(blobBytes);
  let plaintext;
  try {
    plaintext = crypto.decryptFromPeer({
      seed,
      myPubkeyHex,
      peerPubkeyHex: peer,
      blobB64,
    });
  } catch (e) {
    console.warn('Decrypt failed:', e);
    // Backfill username even on undecryptable so it shows in list
    if (senderUsername) {
      convs.ensureConversation({
        peerPubkey: peer,
        peerUsername: senderUsername,
      });
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

  // Backfill peer_username on the conversation if the envelope brought one
  if (senderUsername) {
    convs.ensureConversation({
      peerPubkey: peer,
      peerUsername: senderUsername,
    });
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
