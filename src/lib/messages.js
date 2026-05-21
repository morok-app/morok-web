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
 *   server gives us envelope_id + metadata
 *     → fetch blob bytes (GET /api/v1/messages/{id})
 *     → decrypt with sender's pubkey
 *     → store in local conversation as 'received'
 *     → ack to server
 */

import * as api from './api.js';
import * as crypto from './crypto.js';
import * as convs from './conversations.js';

/**
 * Send a plaintext DM to a peer. Returns the created local message.
 *
 * Params:
 *   seed            — my Ed25519 seed (Uint8Array)
 *   myPubkeyHex     — my Ed25519 pubkey hex
 *   peerPubkeyHex   — recipient's pubkey hex
 *   peerHomeRelay   — recipient's home_relay (for federation routing — not used yet on send side; server figures it out)
 *   plaintext       — UTF-8 text
 *   ttlSeconds      — TTL the user picked (1h/1d/7d/30d)
 */
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

  // Optimistically store as 'sending'
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
    // Promote to 'sent'; remember the envelope_id
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
 * Returns the local message (or null if it was a duplicate or undecryptable).
 *
 * envMeta = { envelope_id, from_pubkey, to_pubkey, ts, ttl, expires_at, ... }
 */
export async function processIncoming({ envMeta, seed, myPubkeyHex }) {
  const envelopeId = envMeta.envelope_id;
  const peer = envMeta.sender_pubkey_hex || envMeta.from_pubkey || envMeta.from;
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
    // Store undecryptable as a stub so user sees something is wrong
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
