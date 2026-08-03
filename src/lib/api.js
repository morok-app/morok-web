/**
 * Morok relay HTTP client.
 */

import { signAuthChallenge, canonicalJson, sign } from './crypto.js';

// Storage key for the user's chosen relay (only consulted in Capacitor
// where window.location.origin is meaningless — localhost or the
// custom capacitor:// scheme).
const STORAGE_KEY_RELAY = 'morok.relay_url.v1';

/**
 * Determine which relay this client should talk to.
 *
 * Browser: same-origin (web is served from relay1.morok.app or
 * relay2.morok.app and talks to its own host). No CORS needed.
 *
 * Capacitor native (Android/iOS): window.location.origin is
 * `http://localhost` or `capacitor://localhost` — useless for finding
 * the real relay. We use a stored choice (Settings) if present, else
 * fall back to relay1.morok.app. The relay MUST allow this origin via
 * CORS — see morok_relay/main.py for the allow list.
 */
function detectDefaultRelay() {
  if (typeof window === 'undefined') return 'https://relay1.morok.app';

  // Native runtime check — Capacitor (Android/iOS) АБО Tauri (Windows/
  // Linux/macOS десктоп). В обох origin безглуздий (tauri://localhost),
  // тож беремо збережений вибір або дефолтний relay1.
  const isNative = !!(
    window.Capacitor?.isNativePlatform?.() ||
    window.Capacitor?.isNative ||
    window.__TAURI__ ||
    window.__TAURI_INTERNALS__ ||
    /^tauri:/.test(window.location?.protocol || '') ||
    (window.location?.protocol === 'http:' && window.location?.hostname === 'tauri.localhost')
  );
  if (isNative) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_RELAY);
      if (stored && /^https?:\/\//.test(stored)) {
        return stored.replace(/\/+$/, '');
      }
    } catch { /* fall through */ }
    return 'https://relay1.morok.app';
  }

  return window.location.origin;
}

const DEFAULT_RELAY = detectDefaultRelay();
let _relayUrl = DEFAULT_RELAY;
let _sessionToken = null;

export function getRelayUrl() { return _relayUrl; }

/**
 * Switch active relay. On Capacitor this is persisted to localStorage
 * so the choice survives an app restart; on web it's session-only since
 * the browser's address bar already encodes the relay.
 */
export function setRelayUrl(url) {
  const clean = url.replace(/\/+$/, '');
  _relayUrl = clean;
  // БУВ БАГ: перевірявся лише Capacitor, тому у Tauri (Windows) вибір
  // релея читався на старті, але НЕ зберігався — після перезапуску
  // застосунок відкочувався на relay1. Тепер умова дзеркалить
  // detectDefaultRelay(): зберігаємо на будь-якому нативному рантаймі.
  const isNative = !!(
    window?.Capacitor?.isNativePlatform?.() ||
    window?.Capacitor?.isNative ||
    window?.__TAURI__ ||
    window?.__TAURI_INTERNALS__ ||
    /^tauri:/.test(window?.location?.protocol || '') ||
    (window?.location?.protocol === 'http:' &&
     window?.location?.hostname === 'tauri.localhost')
  );
  if (isNative) {
    try { localStorage.setItem(STORAGE_KEY_RELAY, clean); } catch {}
  }
}

/** Чи можна на цьому рантаймі перемикати релей (нативні збірки). */
export function canSwitchRelay() {
  return !!(
    window?.Capacitor?.isNativePlatform?.() ||
    window?.Capacitor?.isNative ||
    window?.__TAURI__ ||
    window?.__TAURI_INTERNALS__ ||
    /^tauri:/.test(window?.location?.protocol || '') ||
    (window?.location?.protocol === 'http:' &&
     window?.location?.hostname === 'tauri.localhost')
  );
}

export function getDefaultRelayUrl() { return 'https://relay1.morok.app'; }

/**
 * Перевірити релей ПЕРЕД перемиканням: чи живий, чи це справді Morok.
 * Повертає {ok, name, version, onion} або кидає зрозумілу помилку.
 * Свій таймаут — щоб не висіти на мертвому хості.
 */
export async function checkRelayHealth(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/i.test(clean)) {
    throw new Error('Адреса має вигляд https://relay.вашдомен.com');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let r;
  try {
    r = await fetch(`${clean}/health`, { signal: ctrl.signal });
  } catch {
    throw new Error('Релей не відповідає — перевірте адресу і що сервер запущено');
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw new Error(`Релей відповів помилкою ${r.status}`);
  let d;
  try { d = await r.json(); } catch { throw new Error('Це не схоже на Morok-релей'); }
  if (d?.status !== 'ok' || !d?.version) throw new Error('Це не схоже на Morok-релей');
  return { ok: true, url: clean, name: d.relay_name || clean, version: d.version, onion: d.onion || null };
}

export function setSessionToken(token) { _sessionToken = token; }
export function getSessionToken() { return _sessionToken; }

// Таймаут на HTTP-запити. Без нього при недоступному relay fetch висить
// до таймауту браузера (десятки секунд) — застосунок «думає». 8с достатньо
// для REST. Порт із RN-версії, де це вже було.
const REQUEST_TIMEOUT_MS = 8000;

async function http(method, path, { body, auth, timeoutMs } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && _sessionToken) {
    headers['Authorization'] = `Bearer ${_sessionToken}`;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || REQUEST_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(`${_relayUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    // Таймаут (abort) і мережеві помилки приводимо до однакового вигляду,
    // щоб виклики могли по err.code === 'network' відрізнити «relay недоступний».
    const err = new Error(e?.name === 'AbortError' ? 'Перевищено час очікування' : 'Немає з’єднання з сервером');
    err.code = 'network';
    err.cause = e;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try { payload = await resp.json(); } catch { /* tolerate empty */ }

  if (!resp.ok) {
    const err = new Error(payload?.error || payload?.detail || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

// ────────────────────────────────────────────────────────────
// Mail (morok.email) — аліаси
// ────────────────────────────────────────────────────────────

export async function mailListAliases() {
  return http('GET', '/api/v1/mail/aliases', { auth: true });
}

/** alias: бажаний local-part або null (згенерувати). primary: bool.
 * label: підпис «для чого» (олх, netflix...) — серце фічі «хто злив адресу». */
export async function mailCreateAlias({ alias = null, primary = false, label = null } = {}) {
  return http('POST', '/api/v1/mail/aliases', {
    auth: true,
    body: { alias, primary, label },
  });
}

export async function mailSetAliasLabel(alias, label) {
  return http('POST', `/api/v1/mail/aliases/${encodeURIComponent(alias)}/label`, {
    auth: true,
    body: { label: label || null },
  });
}

export async function mailPauseAlias(alias) {
  return http('POST', `/api/v1/mail/aliases/${encodeURIComponent(alias)}/pause`, { auth: true });
}

export async function mailResumeAlias(alias) {
  return http('POST', `/api/v1/mail/aliases/${encodeURIComponent(alias)}/resume`, { auth: true });
}

export async function mailResolve(alias) {
  return http('GET', `/api/v1/mail/resolve/${encodeURIComponent(alias)}`, { auth: true });
}

export async function mailSendExternal({ toAddr, fromAlias, subject, text, attachments, inReplyTo, references }) {
  return http('POST', '/api/v1/mail/send', {
    auth: true,
    body: { to_alias: toAddr, from_alias: fromAlias, subject, text,
            attachments: attachments || [],
            in_reply_to: inReplyTo || null, references: references || null },
  });
}

export async function mailOutboundStatus() {
  return http('GET', '/api/v1/mail/outbound/status', { auth: true });
}

export async function mailSendInternal({ toAlias, blobB64, fromAlias }) {
  return http('POST', '/api/v1/mail/send', {
    auth: true,
    body: { to_alias: toAlias, blob_b64: blobB64, from_alias: fromAlias || null },
  });
}

export async function mailKillAlias(alias) {
  return http('DELETE', `/api/v1/mail/aliases/${encodeURIComponent(alias)}`, { auth: true });
}

// ────────────────────────────────────────────────────────────
// Health
// ────────────────────────────────────────────────────────────

export async function getHealth() {
  return http('GET', '/health');
}

// ────────────────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────────────────

export async function login({ seed, pubkeyHex }) {
  const challenge = await http('POST', '/api/v1/auth/challenge', {
    body: { pubkey_hex: pubkeyHex },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureHex = signAuthChallenge({
    seed,
    pubkeyHex,
    challengeHex: challenge.challenge_hex,
    timestamp,
  });
  const auth = await http('POST', '/api/v1/auth/verify', {
    body: {
      pubkey_hex: pubkeyHex,
      challenge_hex: challenge.challenge_hex,
      timestamp,
      signature_hex: signatureHex,
    },
  });
  setSessionToken(auth.session_token);
  return auth;
}

export async function logout() {
  if (!_sessionToken) return { revoked: false };
  try {
    return await http('POST', '/api/v1/auth/logout', { auth: true });
  } finally {
    setSessionToken(null);
  }
}

// ────────────────────────────────────────────────────────────
// User / Username
// ────────────────────────────────────────────────────────────

export async function getMe() {
  return http('GET', '/api/v1/users/me', { auth: true });
}

export async function claimUsername(username) {
  return http('POST', '/api/v1/users/me/username', {
    body: { username },
    auth: true,
  });
}

export async function releaseUsername() {
  return http('DELETE', '/api/v1/users/me/username', { auth: true });
}

/**
 * Permanently delete the current account on the relay.
 *
 * The caller MUST verify the mnemonic locally before calling this —
 * the relay only checks the auth token, which any active session has.
 * Trusting the active session alone would let a thief with an
 * unlocked device wipe the account.
 */
export async function deleteAccount() {
  return http('DELETE', '/api/v1/me', { auth: true });
}

/**
 * Fetch the calling user's login history (up to 30 most recent).
 * Each entry: { created_at, ip_hash, user_agent }.
 */
export async function getLoginHistory() {
  return http('GET', '/api/v1/me/sessions', { auth: true });
}

/**
 * Wipe the calling user's login history. Returns { cleared: N }.
 */
export async function clearLoginHistory() {
  return http('DELETE', '/api/v1/me/sessions', { auth: true });
}

export async function lookupUsername(username, relay) {
  const qs = relay ? `?relay=${encodeURIComponent(relay)}` : '';
  return http('GET', `/api/v1/users/lookup/${encodeURIComponent(username)}${qs}`);
}

// ────────────────────────────────────────────────────────────
// Messages (1-on-1)
// ────────────────────────────────────────────────────────────

export async function sendEnvelope(envelope) {
  return http('POST', '/api/v1/messages', { body: envelope, auth: true });
}

export async function listInbox(limit = 50) {
  return http('GET', `/api/v1/messages?limit=${limit}`, { auth: true });
}

export async function fetchBlob(envelopeId) {
  const resp = await fetch(`${_relayUrl}/api/v1/messages/${envelopeId}`, {
    headers: { 'Authorization': `Bearer ${_sessionToken}` },
  });
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

export async function ackEnvelope(envelopeId) {
  return http('DELETE', `/api/v1/messages/${envelopeId}`, { auth: true });
}

/**
 * Send a batch of read receipts. `reads` is an array of
 * { envelope_id, sender_pubkey_hex, group_id? } objects. The relay
 * notifies each sender (locally via WS or via federation forward).
 */
export async function sendReadReceipts(reads) {
  if (!reads || reads.length === 0) return { sent: 0 };
  return http('POST', '/api/v1/messages/read', {
    body: { reads },
    auth: true,
  });
}

/** Web push: fetch this relay's VAPID public key (base64url). */
export async function getPushVapidKey() {
  return http('GET', '/api/v1/push/vapid-public-key', { auth: false });
}

/** Web push: register a subscription on this relay for the current user. */
export async function pushSubscribe(body) {
  return http('POST', '/api/v1/push/subscribe', { body, auth: true });
}

/** Web push: remove a subscription by endpoint. */
export async function pushUnsubscribe(body) {
  return http('POST', '/api/v1/push/unsubscribe', { body, auth: true });
}

export async function pushSubscribeNative(body) {
  return http('POST', '/api/v1/push/subscribe-native', { body, auth: true });
}

export async function pushUnsubscribeNative(body) {
  return http('POST', '/api/v1/push/unsubscribe-native', { body, auth: true });
}

// ─── Sealed Sender ───────────────────────────────────────────

/** Реєстрація sha256-хеша мого delivery-токена на МОЄМУ релеї. */
export async function registerInboxToken(body) {
  return http('POST', '/api/v1/inbox-token', { body, auth: true });
}

export async function revokeInboxToken(body) {
  return http('POST', '/api/v1/inbox-token/revoke', { body, auth: true });
}

/**
 * Відправка sealed-конверта НАПРЯМУ на домашній релей одержувача.
 * Свідомо БЕЗ автентифікації і БЕЗ http()-хелпера: жодних session-
 * заголовків, жодних слідів нашої особи. relayBase — як-от
 * "https://relay2.morok.app" (з lookup одержувача).
 */
export async function sendSealedEnvelope(relayBase, body) {
  const base = String(relayBase || '').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/v1/messages/sealed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `http_${res.status}`;
    try { detail = (await res.json())?.detail || detail; } catch { /* ok */ }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Видалення sealed-конверта пред'явленням delete-ключа (без auth). */
export async function deleteSealedEnvelope(relayBase, envelopeId, deleteKeyHex) {
  const base = String(relayBase || '').replace(/\/+$/, '');
  const res = await fetch(
    `${base}/api/v1/messages/sealed/${envelopeId}/delete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete_key: deleteKeyHex }),
    },
  );
  if (!res.ok) {
    let detail = `http_${res.status}`;
    try { detail = (await res.json())?.detail || detail; } catch { /* ok */ }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Sender-initiated server-side delete of a DM.
 * Removes the message from the recipient's inbox AND pushes a delete
 * event onto their WebSocket. Best-effort: if the recipient already
 * acked the message, the queue removal is a no-op but the WS event
 * still goes out (so an online recipient drops it from local store).
 *
 * `seed` is required: the sender signs the delete intent so the
 * recipient's relay (which may be a peer over federation) can verify
 * cryptographically that the delete is genuine, not a forgery by a
 * trusted-but-malicious peer. Without the signature the backend will
 * refuse the request.
 */
export async function deleteDMMessage(envelopeId, recipientPubkeyHex, seed) {
  if (!seed) {
    throw new Error('deleteDMMessage requires seed for signing');
  }
  const ts = Math.floor(Date.now() / 1000);
  const message = canonicalJson({
    envelope_id: envelopeId,
    kind: 'dm_delete',
    ts,
  });
  const signature_hex = sign(seed, message);
  return http('POST', `/api/v1/messages/${envelopeId}/delete-for-recipient`, {
    body: {
      recipient_pubkey_hex: recipientPubkeyHex,
      signature_hex,
      ts,
    },
    auth: true,
  });
}

/**
 * Delete a group message. Authorized for the sender of the message
 * OR for the group admin. Removes from every member's inbox and pushes
 * a delete event on each member's channel.
 *
 * `seed` is required for the same reason as deleteDMMessage — the
 * delete intent is signed so it can be verified through the
 * federation hop chain (sender → host → other relays).
 */
export async function deleteGroupMessage(groupId, envelopeId, seed) {
  if (!seed) {
    throw new Error('deleteGroupMessage requires seed for signing');
  }
  const ts = Math.floor(Date.now() / 1000);
  const message = canonicalJson({
    envelope_id: envelopeId,
    group_id: groupId,
    kind: 'group_delete',
    ts,
  });
  const signature_hex = sign(seed, message);
  return http('POST', `/api/v1/groups/${groupId}/messages/${envelopeId}/delete`, {
    body: { signature_hex, ts },
    auth: true,
  });
}

// ────────────────────────────────────────────────────────────
// WebSocket inbox
// ────────────────────────────────────────────────────────────

export function openInboxSocket(onMessage, onOpen, onClose, onError) {
  // Без валідного токена не відкриваємо сокет: інакше URL стає
  // "?token=null", relay миттєво його відкидає, і InboxClient впадає
  // у вічний цикл reconnect на максимальній швидкості (саме це плодило
  // ghost-слоти в Redis). Краще одразу повідомити про "close", щоб
  // спрацював backoff і перелогін.
  if (!_sessionToken) {
    const err = new Error('no_session_token');
    err.code = 'no_session';
    // асинхронно, щоб InboxClient уже мав посилання на ws перед колбеком
    setTimeout(() => {
      try { onError?.(err); } catch { /* ignore */ }
      try { onClose?.({ code: 4001, reason: 'no_session_token' }); } catch { /* ignore */ }
    }, 0);
    return { readyState: 3, close() {}, send() {} }; // фейковий "closed" сокет
  }

  const wsUrl = _relayUrl.replace(/^http/, 'ws') + `/ws/v1/inbox?token=${encodeURIComponent(_sessionToken)}`;
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => onOpen?.(ws);
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      onMessage?.(data, ws);
    } catch (e) {
      console.warn('WS bad message:', e, ev.data);
    }
  };
  ws.onclose = (ev) => onClose?.(ev);
  ws.onerror = (ev) => onError?.(ev);
  return ws;
}

// ────────────────────────────────────────────────────────────
// Encrypted backup
// ────────────────────────────────────────────────────────────

export async function uploadBackup({ encryptedSeedB64, kdfSaltB64, kdfParams }) {
  return http('POST', '/api/v1/backup', {
    body: {
      encrypted_seed_b64: encryptedSeedB64,
      kdf_salt_b64: kdfSaltB64,
      kdf_params: kdfParams || { alg: 'pbkdf2', hash: 'sha256', iter: 200000 },
      schema_version: 1,
    },
    auth: true,
  });
}

export async function getMyBackup() {
  return http('GET', '/api/v1/backup', { auth: true });
}

export async function deleteMyBackup() {
  return http('DELETE', '/api/v1/backup', { auth: true });
}

export async function restoreBackupByUsername(username) {
  return http('GET', `/api/v1/backup/by-username/${encodeURIComponent(username)}`);
}

// ────────────────────────────────────────────────────────────
// Groups (Day 6Б)
// ────────────────────────────────────────────────────────────

/**
 * Create a new group. `nameEncryptedB64` — base64 of XChaCha20-Poly1305
 * ciphertext of the group name encrypted with the freshly-generated group_key.
 *
 * Returns the full group info INCLUDING members (the creator becomes the
 * sole admin).
 */
export async function createGroup({
  nameEncryptedB64,
  isChannel = false,
  defaultTtlSeconds = 86400,
  anonymousSenders = false,
  expiresAt = null,
  slug = null,
}) {
  return http('POST', '/api/v1/groups', {
    body: {
      name_encrypted: nameEncryptedB64,
      is_channel: isChannel,
      default_ttl_seconds: defaultTtlSeconds,
      anonymous_senders: anonymousSenders,
      expires_at: expiresAt,
      slug,
    },
    auth: true,
  });
}

export async function listMyGroups() {
  return http('GET', '/api/v1/groups', { auth: true });
}

export async function getGroupInfo(groupId) {
  return http('GET', `/api/v1/groups/${groupId}`, { auth: true });
}

export async function deleteGroup(groupId, seed = null) {
  // Без seed — старий шлях: видалення тільки тут, локальні члени
  // дізнаються по WS, віддалені — ледаче (404 при наступному відкритті).
  // З seed — підписуємо намір "group_gone", релей-хост форварднe його на
  // релеї віддалених членів, де підпис ПЕРЕВІРЯЄТЬСЯ незалежно (проти
  // підробки скомпрометованим хостом). Миттєве зникнення на всіх релеях.
  if (!seed) {
    return http('DELETE', `/api/v1/groups/${groupId}`, { auth: true });
  }
  const ts = Math.floor(Date.now() / 1000);
  // Payload мусить збігатися з релейним _verify_delete_sig для group_gone:
  // {kind:'group_gone', ts, group_id}. canonicalJson сортує ключі.
  const message = canonicalJson({
    group_id: groupId,
    kind: 'group_gone',
    ts,
  });
  const gone_signature_hex = sign(seed, message);
  const qs = `?gone_signature_hex=${gone_signature_hex}&gone_ts=${ts}`;
  return http('DELETE', `/api/v1/groups/${groupId}${qs}`, { auth: true });
}

export async function addGroupMember(groupId, pubkeyHex) {
  return http('POST', `/api/v1/groups/${groupId}/members`, {
    body: { pubkey_hex: pubkeyHex },
    auth: true,
  });
}

export async function removeGroupMember(groupId, pubkeyHex) {
  return http('DELETE', `/api/v1/groups/${groupId}/members/${pubkeyHex}`, { auth: true });
}

/**
 * Broadcast a signed envelope to all group members.
 * envelope = { from, to (=group_id), ts, ttl, blob, sig }
 */
export async function sendGroupMessage(groupId, envelope) {
  return http('POST', `/api/v1/groups/${groupId}/messages`, {
    body: envelope,
    auth: true,
  });
}

// ────────────────────────────────────────────────────────────
// Group invite tokens (Day 6Б — variant B)
// ────────────────────────────────────────────────────────────

export async function createInviteToken(groupId, ttlSeconds) {
  return http('POST', `/api/v1/groups/${groupId}/invites`, {
    body: ttlSeconds ? { ttl_seconds: ttlSeconds } : {},
    auth: true,
  });
}

export async function listInviteTokens(groupId) {
  return http('GET', `/api/v1/groups/${groupId}/invites`, { auth: true });
}

export async function revokeInviteToken(groupId, token) {
  return http('DELETE', `/api/v1/groups/${groupId}/invites/${token}`, { auth: true });
}

export async function joinGroupViaToken(token) {
  return http('POST', `/api/v1/groups/join?token=${encodeURIComponent(token)}`, {
    auth: true,
  });
}
// ───────────────────────────────────────────────────────────
// Dead Man's Switch (Day 7)
// ───────────────────────────────────────────────────────────

/**
 * Create a DMS armed for `trigger_seconds` of inactivity.
 *
 * payloadEncryptedB64 is base64 ciphertext (encrypted FOR the recipient
 * with a regular DM-style DH key, same as a normal DM blob). The relay
 * will deliver this exact blob to the recipient when the switch fires.
 *
 * recipientPubkeysHex — array of pubkey hex strings. We pass exactly 1
 * in the MVP (UI enforces this).
 */
export async function createDMS({
  triggerSeconds,
  payloadEncryptedB64,
  recipientPubkeysHex,
  label = null,
}) {
  return http('POST', '/api/v1/dms', {
    body: {
      trigger_seconds: triggerSeconds,
      payload_encrypted: payloadEncryptedB64,
      recipient_pubkeys_hex: recipientPubkeysHex,
      label,
    },
    auth: true,
  });
}

/**
 * List all my DMS (any status).
 */
export async function listMyDMS() {
  return http('GET', '/api/v1/dms', { auth: true });
}

/**
 * Get details of one DMS.
 */
export async function getDMS(dmsId) {
  return http('GET', `/api/v1/dms/${dmsId}`, { auth: true });
}

/**
 * Check in — resets the inactivity timer to "now".
 * Only valid for ARMED switches; CANCELLED/TRIGGERED → 409.
 */
export async function checkInDMS(dmsId) {
  return http('POST', `/api/v1/dms/${dmsId}/check-in`, { auth: true });
}

/**
 * Cancel a DMS. Idempotent.
 */
export async function cancelDMS(dmsId) {
  return http('DELETE', `/api/v1/dms/${dmsId}`, { auth: true });
}
// ────────────────────────────────────────────────────────────
// Burner inbox (Day 7)
// ────────────────────────────────────────────────────────────

/**
 * Create a new burner token (owner-side, authenticated).
 *
 * Returns: { token, owner_pubkey_hex, label, created_at, expires_at, message_count }
 */
export async function createBurnerToken({ ttlSeconds, label }) {
  return http('POST', '/api/v1/burner', {
    body: { ttl_seconds: ttlSeconds, label },
    auth: true,
  });
}

/**
 * List my active burner tokens (owner-side, authenticated).
 *
 * Returns: { tokens: BurnerInfo[] }
 */
export async function listBurnerTokens() {
  return http('GET', '/api/v1/burner', { auth: true });
}

/**
 * Revoke a burner token (owner-side, authenticated).
 */
export async function revokeBurnerToken(token) {
  return http('DELETE', `/api/v1/burner/${encodeURIComponent(token)}`, {
    auth: true,
  });
}

/**
 * PUBLIC: Get the owner's pubkey for a burner token. No auth.
 * Used by the burner-send web form.
 *
 * Returns: { owner_pubkey_hex, label, expires_at }
 */
export async function getBurnerPublic(token) {
  return http('GET', `/api/v1/burner/public/${encodeURIComponent(token)}`);
}

/**
 * PUBLIC: Submit an encrypted message via a burner token. No auth.
 *
 * Returns: { envelope_id, queued, expires_at, message_count }
 */
export async function sendViaBurner({
  token,
  ephemeralPubkeyHex,
  blobB64,
  senderLabel,
}) {
  return http('POST', `/api/v1/burner/public/${encodeURIComponent(token)}/send`, {
    body: {
      ephemeral_pubkey_hex: ephemeralPubkeyHex,
      blob_b64: blobB64,
      sender_label: senderLabel || null,
    },
  });
}
