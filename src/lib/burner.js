/**
 * Burner inbox business logic.
 *
 * Two distinct roles:
 *
 *   OWNER (authenticated user):
 *     - listMyTokens(), createToken(), revokeToken()
 *
 *   ANONYMOUS SENDER (no account, just a URL):
 *     - fetchPublicInfo(token) → owner_pubkey
 *     - sendAnonymousMessage({token, ownerPubkeyHex, plaintext, senderLabel})
 *       → generates ephemeral keypair, encrypts via DH, POSTs
 *
 * Recipient sees the message as a regular DM from
 * @anon_<ephemeral_pubkey_prefix>, with a "🔥 burner" badge.
 */

import { ed25519 } from '@noble/curves/ed25519';
import * as api from './api.js';
import {
  encryptForPeer,
  bytesToHex,
} from './crypto.js';

// ────────────────────────────────────────────────────────────
// Owner side (authenticated)
// ────────────────────────────────────────────────────────────

export async function listMyTokens() {
  const r = await api.listBurnerTokens();
  return r.tokens || [];
}

export async function createToken({ ttlSeconds, label = null }) {
  return await api.createBurnerToken({
    ttlSeconds,
    label: label?.trim() || null,
  });
}

export async function revokeToken(token) {
  return await api.revokeBurnerToken(token);
}

// ────────────────────────────────────────────────────────────
// Sender side (anonymous, no account)
// ────────────────────────────────────────────────────────────

/**
 * Look up the owner's pubkey for a burner token. Public, no auth.
 *
 * Returns: { owner_pubkey_hex, label, expires_at } or throws.
 */
export async function fetchPublicInfo(token) {
  return await api.getBurnerPublic(token);
}

/**
 * Send an anonymous message via a burner token.
 *
 * 1. Generate a fresh ephemeral Ed25519 keypair (one-time use).
 * 2. Derive a DH-based shared key with the owner's pubkey.
 * 3. Encrypt the plaintext (XChaCha20-Poly1305 + random nonce).
 * 4. POST {ephemeral_pubkey_hex, blob_b64, sender_label} to the relay.
 *
 * The ephemeral keypair is discarded immediately. The recipient sees
 * the message coming from an unknown ephemeral pubkey — there's no way
 * to link it back to the sender's identity (because there is none).
 *
 * Returns: { envelope_id, queued, message_count }
 */
export async function sendAnonymousMessage({
  token,
  ownerPubkeyHex,
  plaintext,
  senderLabel = null,
}) {
  if (!plaintext || !plaintext.trim()) {
    throw new Error('Порожнє повідомлення');
  }
  if (!ownerPubkeyHex || ownerPubkeyHex.length !== 64) {
    throw new Error('Некоректний адресат');
  }

  // 1. Generate ephemeral Ed25519 keypair.
  //    @noble/curves v1 має НЕ `ed25519.keygen()` (це API v2), а
  //    utils.randomPrivateKey() + getPublicKey(). Виклик keygen() тут
  //    падав із "keygen is not a function", тобто анонімна відправка
  //    через бернер не працювала взагалі. RN-версія вже виправлена так само.
  const secretKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  const ephemeralPubkeyHex = bytesToHex(publicKey);

  // 2/3. Encrypt with the SAME DM scheme — the recipient client will
  //      decrypt with decryptFromPeer using the ephemeral pubkey as the
  //      "peer". No special crypto path needed.
  const blobB64 = encryptForPeer({
    seed: secretKey,           // 32-byte ephemeral seed
    myPubkeyHex: ephemeralPubkeyHex,
    peerPubkeyHex: ownerPubkeyHex,
    plaintext,
  });

  // 4. Submit
  const result = await api.sendViaBurner({
    token,
    ephemeralPubkeyHex,
    blobB64,
    senderLabel: senderLabel?.trim() || null,
  });

  return result;
}

// ────────────────────────────────────────────────────────────
// Display helpers
// ────────────────────────────────────────────────────────────

export const TTL_OPTIONS = [
  { seconds: 3600,        label: '1 година',   hint: 'для разової швидкої передачі' },
  { seconds: 24 * 3600,   label: '24 години',  hint: 'для активної кампанії' },
  { seconds: 7 * 86400,   label: '7 днів',     hint: 'довгий публічний лінк' },
];

export function formatTTLLabel(seconds) {
  const opt = TTL_OPTIONS.find((o) => o.seconds === seconds);
  if (opt) return opt.label;
  const days = Math.round(seconds / 86400);
  if (days < 1) return `${Math.round(seconds / 3600)}г`;
  return `${days}д`;
}

export function formatRemainingTime(expiresAt) {
  const now = Math.floor(Date.now() / 1000);
  const remaining = expiresAt - now;
  if (remaining <= 0) return 'застарілий';
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  if (days > 0) return `${days}д ${hours}г`;
  const minutes = Math.floor((remaining % 3600) / 60);
  return `${hours}г ${minutes}хв`;
}

/**
 * Parse the special sender_username metadata format used for burner DMs.
 *
 * Server stores it as either "🔥burner" (no label) or "🔥burner::<label>".
 *
 * Returns: { isBurner: boolean, label: string | null }
 */
export function parseBurnerMeta(senderUsername) {
  if (!senderUsername) return { isBurner: false, label: null };
  if (senderUsername === '🔥burner') return { isBurner: true, label: null };
  if (senderUsername.startsWith('🔥burner::')) {
    return { isBurner: true, label: senderUsername.slice('🔥burner::'.length) };
  }
  return { isBurner: false, label: null };
}
