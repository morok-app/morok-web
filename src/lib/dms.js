/**
 * Dead Man's Switch business logic.
 *
 * Flow:
 *   1. User creates a DMS for recipient @kaban with trigger=7d and a
 *      plaintext message "If you're reading this, I'm gone. Bitcoin
 *      seed: ..."
 *   2. Client encrypts the plaintext with the same DM crypto we use
 *      for normal messages (DH-derived key) — relay never sees it.
 *   3. Client POSTs /api/v1/dms with the ciphertext + recipient pubkey
 *      + trigger_seconds + optional label.
 *   4. Relay stores it ARMED. User auto-check-ins on every login.
 *   5. If user goes silent past trigger window → relay fires the switch:
 *      delivers the ciphertext to recipient as a regular DM envelope.
 *   6. Recipient's client decrypts it (because the DH math gives the
 *      same shared key — sender's pubkey is part of the address book).
 *
 * For the recipient, the delivered payload looks like a normal message
 * from the original sender. No special "this is a DMS" marker — by
 * design. The sender chose what to write; the recipient gets that.
 *
 * Auto check-in: on every login + every 6h while the app is open,
 * we call checkInAllArmed() which iterates over local cache of ARMED
 * DMS ids and pings each one. The server is the source of truth, but
 * we cache so we don't have to LIST first.
 */

import * as api from './api.js';
import * as crypto from './crypto.js';
import { t, tp } from './i18n.js';

/**
 * Encrypt plaintext FOR a specific recipient using the same DH
 * scheme as a normal DM. Returns base64 of XChaCha20-Poly1305
 * ciphertext bytes (with prepended 24-byte nonce — same format
 * as sendDM uses).
 */
export function encryptDMSPayload({ seed, myPubkeyHex, recipientPubkeyHex, plaintext }) {
  return crypto.encryptForPeer({
    seed,
    myPubkeyHex,
    peerPubkeyHex: recipientPubkeyHex,
    plaintext,
  });
}

/**
 * Create a new DMS. Single recipient (MVP).
 *
 * Params:
 *   seed              — our seed bytes
 *   myPubkeyHex       — our pubkey
 *   recipientPubkeyHex — recipient's pubkey
 *   plaintext         — what to deliver when fired
 *   triggerSeconds    — inactivity window
 *   label             — display label like "Family"
 *
 * Returns the DMSInfo from the server.
 */
export async function createDeadManSwitch({
  seed, myPubkeyHex,
  recipientPubkeyHex,
  plaintext,
  triggerSeconds,
  label = null,
}) {
  const payloadEncryptedB64 = encryptDMSPayload({
    seed, myPubkeyHex, recipientPubkeyHex, plaintext,
  });
  return await api.createDMS({
    triggerSeconds,
    payloadEncryptedB64,
    recipientPubkeysHex: [recipientPubkeyHex],
    label,
  });
}

/**
 * List my DMS. Returns array of DMSInfo.
 */
export async function listAll() {
  return await api.listMyDMS();
}

/**
 * Get details of one.
 */
export async function getOne(dmsId) {
  return await api.getDMS(dmsId);
}

/**
 * Check in. Returns the new last_check_in_at + fires_at.
 */
export async function checkIn(dmsId) {
  return await api.checkInDMS(dmsId);
}

/**
 * Cancel. Returns { dms_id, cancelled }.
 */
export async function cancel(dmsId) {
  return await api.cancelDMS(dmsId);
}

/**
 * Auto check-in for all currently-armed DMS.
 *
 * Called from App.jsx on login and periodically (every 6h).
 * Fetches list, filters ARMED, pings each. Failures are logged but
 * don't break the chain (other DMS still get checked in).
 *
 * Returns: { checkedIn, failed, total }
 */
export async function checkInAllArmed() {
  let list;
  try {
    list = await listAll();
  } catch (e) {
    console.warn('DMS auto check-in: listAll failed:', e?.message);
    return { checkedIn: 0, failed: 0, total: 0, error: e?.message };
  }

  const armed = list.filter((d) => d.status === 'armed');
  let checkedIn = 0, failed = 0;
  for (const d of armed) {
    try {
      await checkIn(d.dms_id);
      checkedIn++;
    } catch (e) {
      console.warn('DMS check-in failed for', d.dms_id, e?.message);
      failed++;
    }
  }
  return { checkedIn, failed, total: armed.length };
}

// ────────────────────────────────────────────────────────────
// Display helpers
// ────────────────────────────────────────────────────────────

export const TRIGGER_OPTIONS = [
  { seconds: 86400,        label: t('1 day'),  hint: t('for testing') },
  { seconds: 7 * 86400,    label: t('7 days'),  hint: t('if you sign in often') },
  { seconds: 30 * 86400,   label: t('30 days'), hint: t('recommended') },
  { seconds: 90 * 86400,   label: t('90 days'), hint: t('for travel') },
  { seconds: 365 * 86400,  label: t('1 year'),   hint: t('for a long-term last message') },
];

export function formatTriggerLabel(seconds) {
  const opt = TRIGGER_OPTIONS.find((o) => o.seconds === seconds);
  if (opt) return opt.label;
  // Custom — fallback
  const days = Math.round(seconds / 86400);
  if (days < 1) return tp("{0}h", [Math.round(seconds / 3600)]);
  if (days < 30) return tp("{0}d", [days]);
  if (days < 365) return tp("{0}mo", [Math.round(days / 30)]);
  return tp("{0}y", [Math.round(days / 365)]);
}

export function formatRemainingTime(firesAt) {
  const now = Math.floor(Date.now() / 1000);
  const remaining = firesAt - now;
  if (remaining <= 0) return t('triggered');
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  if (days > 0) return tp("{0}d {1}h", [days, hours]);
  const minutes = Math.floor((remaining % 3600) / 60);
  return tp("{0}h {1}m", [hours, minutes]);
}

export function statusLabel(status) {
  return {
    armed: t('active'),
    triggered: t('triggered'),
    cancelled: t('cancelled'),
  }[status] || status;
}

export function statusColor(status) {
  return {
    armed: 'var(--success)',
    triggered: 'var(--danger)',
    cancelled: 'var(--text-faint)',
  }[status] || 'var(--text-dim)';
}
