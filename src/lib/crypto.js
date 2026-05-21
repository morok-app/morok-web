/**
 * Morok client crypto.
 *
 * - Seed: 256 bits of CSPRNG-generated entropy. This IS the private key.
 * - Mnemonic: standard BIP39 (English wordlist) over the seed.
 * - Identity: Ed25519 key derived from the seed.
 * - Signing: server-issued challenge bytes; we sign with Ed25519.
 *
 * Why BIP39: standard library means we're not the source of any
 * mnemonic-related bug. Same wordlist as Bitcoin/Ethereum hardware
 * wallets. 24 words = 256 bits entropy = uncrackable.
 */

import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';
import { randomBytes } from '@noble/hashes/utils';
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

// --- Bytes utilities ---

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new Error('hex must be even-length string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function utf8(s) {
  return new TextEncoder().encode(s);
}

// --- Seed / Mnemonic ---

/**
 * Generate a brand new identity. Returns { seed, mnemonic, pubkeyHex }.
 * Seed is 32 bytes (256 bits) of CSPRNG entropy.
 * Mnemonic is 24 BIP39 words.
 */
export function generateIdentity() {
  const seed = randomBytes(32);
  const mnemonic = entropyToMnemonic(seed, wordlist);
  const pubkey = ed25519.getPublicKey(seed);
  return {
    seed,
    mnemonic,
    pubkeyHex: bytesToHex(pubkey),
  };
}

/**
 * Restore identity from a 24-word mnemonic. Throws if mnemonic is invalid.
 */
export function identityFromMnemonic(mnemonic) {
  const cleaned = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!validateMnemonic(cleaned, wordlist)) {
    throw new Error('Невалідна 24-словна фраза');
  }
  const seed = mnemonicToEntropy(cleaned, wordlist);
  const pubkey = ed25519.getPublicKey(seed);
  return {
    seed,
    mnemonic: cleaned,
    pubkeyHex: bytesToHex(pubkey),
  };
}

// --- Signing ---

/**
 * Sign a message with the seed. Returns hex string of 64-byte signature.
 */
export function sign(seed, messageBytes) {
  const sig = ed25519.sign(messageBytes, seed);
  return bytesToHex(sig);
}

/**
 * Canonical JSON encoding — sorted keys, no whitespace.
 * Must match server's `crypto.canonical_json`.
 */
export function canonicalJson(obj) {
  return utf8(JSON.stringify(obj, Object.keys(obj).sort()));
}

/**
 * Sign the relay-issued auth challenge.
 * Server expects sig over canonical JSON:
 *   {"morok_auth":"v1","challenge":<hex>,"pubkey":<hex>,"timestamp":<int>}
 */
export function signAuthChallenge({ seed, pubkeyHex, challengeHex, timestamp }) {
  const msg = canonicalJson({
    morok_auth: 'v1',
    challenge: challengeHex,
    pubkey: pubkeyHex,
    timestamp,
  });
  return sign(seed, msg);
}
