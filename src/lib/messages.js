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
import * as sealedTokens from './sealed_tokens.js';
import * as crypto from './crypto.js';
import * as convs from './conversations.js';
import { compressImage } from './images.js';
import { blobToBase64 } from './voice.js';

// Kinds that are purely protocol signalling — never shown to the user
// and never stored in conversation history. Everything else (raw text,
// {kind:'image'}, future content kinds) is a real message.
const CONTROL_KINDS = new Set(['group_key', 'group_key_request', 'reaction', 'sealed_token']);

/**
 * Базовий URL домашнього релея контакта для прямого sealed-POST.
 * Беремо home_relay з адресної книги; якщо невідомий — null
 * (тоді відправка піде звичайним v1-шляхом).
 */
async function peerHomeRelayBase(peerPubkeyHex) {
  try {
    const contactsMod = await import('./contacts.js');
    const row = contactsMod.getByPubkey(peerPubkeyHex);
    const hr = row?.home_relay;
    if (!hr) return null;
    if (/^https?:\/\//.test(hr)) return hr.replace(/\/+$/, '');
    return `https://${hr}`;
  } catch {
    return null;
  }
}

/**
 * Спроба надіслати payload як SEALED-конверт (анонімно до релея).
 *
 * Спільне ядро для всіх типів повідомлень (text/image/voice/reaction).
 * Повертає { envelope_id, expires_at, deleteKeyHex } при успіху або
 * null при БУДЬ-ЯКІЙ осічці (нема токена контакта / не знаю його релей /
 * мережа / релей одержувача старий). null => викликач тихо йде своїм
 * звичайним v1-шляхом. Доставка важливіша за анонімність.
 */
async function trySealedSend({ seed, myPubkeyHex, peerPubkeyHex, payload, ts, ttlSeconds }) {
  try {
    const peerToken = sealedTokens.getPeerToken(peerPubkeyHex);
    if (!peerToken) return null;
    const relayBase = await peerHomeRelayBase(peerPubkeyHex);
    if (!relayBase) return null;

    const sealed = crypto.sealedEncrypt({
      seed, myPubkeyHex, peerPubkeyHex,
      payload, to: peerPubkeyHex, ts,
    });
    const ack = await api.sendSealedEnvelope(relayBase, {
      to: peerPubkeyHex,
      ts,
      ttl: ttlSeconds,
      blob: sealed.blobB64,
      delivery_token: peerToken,
      delete_key_hash: sealed.deleteKeyHashHex,
    });
    return {
      envelope_id: ack.envelope_id,
      expires_at: ack.expires_at || (ts + ttlSeconds),
      deleteKeyHex: sealed.deleteKeyHex,
      relayBase,
    };
  } catch (e) {
    console.warn('sealed send failed, falling back to v1:', e?.message || e);
    return null;
  }
}

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

  // ── Спроба SEALED (анонімно до релея) ──
  // Доставка важливіша за анонімність: null -> тихий fallback на v1.
  const sealedRes = await trySealedSend({
    seed, myPubkeyHex, peerPubkeyHex,
    payload: { kind: 'text', text: plaintext },
    ts, ttlSeconds,
  });
  if (sealedRes) {
    convs.updateMessage(peerPubkeyHex, localMsg.id, {
      envelope_id: sealedRes.envelope_id,
      status: 'sent',
      sealed: true,
      sealed_delete_key: sealedRes.deleteKeyHex,
      sealed_relay: sealedRes.relayBase,
      expires_at: sealedRes.expires_at,
    });
    return { ...localMsg, envelope_id: sealedRes.envelope_id, status: 'sent', sealed: true };
  }

  // ── Звичайний v1 (як було) ──
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

  // ── Спроба SEALED ──
  const sealedRes = await trySealedSend({
    seed, myPubkeyHex, peerPubkeyHex,
    payload: {
      kind: 'image',
      data_b64: compressed.data_b64,
      mime: compressed.mime,
      w: compressed.w,
      h: compressed.h,
      caption: caption || '',
    },
    ts, ttlSeconds,
  });
  if (sealedRes) {
    convs.updateMessage(peerPubkeyHex, localMsg.id, {
      envelope_id: sealedRes.envelope_id,
      status: 'sent',
      sealed: true,
      sealed_delete_key: sealedRes.deleteKeyHex,
      sealed_relay: sealedRes.relayBase,
      expires_at: sealedRes.expires_at,
    });
    return { ...localMsg, envelope_id: sealedRes.envelope_id, status: 'sent', sealed: true };
  }

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
 * Send a voice DM. Converts the recorded blob to base64, wraps it as
 * {kind:'voice', ...} JSON, encrypts and sends. The local conversation
 * log gets a message with `voice` populated.
 *
 * Throws if the encoded clip exceeds the per-envelope size budget
 * (which would be rejected by the relay anyway).
 */
export async function sendDMVoice({
  seed, myPubkeyHex, peerPubkeyHex,
  audioBlob, mimeType, durationMs, ttlSeconds,
}) {
  const data_b64 = await blobToBase64(audioBlob);
  const rawSize = Math.floor(data_b64.length * 0.75);
  if (rawSize > 140 * 1024) {
    throw new Error(
      `Голосове завелике (${Math.round(rawSize / 1024)}KB). ` +
      'Запишіть коротше.',
    );
  }

  const payload = JSON.stringify({
    kind: 'voice',
    data_b64,
    mime: mimeType || 'audio/webm',
    duration_ms: Math.max(0, Math.floor(durationMs || 0)),
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
  convs.appendMessage(peerPubkeyHex, localMsg);

  // ── Спроба SEALED ──
  const sealedRes = await trySealedSend({
    seed, myPubkeyHex, peerPubkeyHex,
    payload: {
      kind: 'voice',
      data_b64,
      mime: mimeType || 'audio/webm',
      duration_ms: Math.max(0, Math.floor(durationMs || 0)),
    },
    ts, ttlSeconds,
  });
  if (sealedRes) {
    convs.updateMessage(peerPubkeyHex, localMsg.id, {
      envelope_id: sealedRes.envelope_id,
      status: 'sent',
      sealed: true,
      sealed_delete_key: sealedRes.deleteKeyHex,
      sealed_relay: sealedRes.relayBase,
      expires_at: sealedRes.expires_at,
    });
    return { ...localMsg, envelope_id: sealedRes.envelope_id, status: 'sent', sealed: true };
  }

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

/**
 * Send a reaction (or remove one) to a DM message.
 *
 * Reactions are wrapped as a control payload — not stored in the
 * sender's own history. The sender updates the target message's
 * reactions array locally BEFORE sending (optimistic), so the UI
 * reflects the change instantly. If the relay rejects the envelope,
 * we roll the local update back.
 *
 * Validates the emoji against ALLOWED_REACTIONS before sending — the
 * UI should only ever surface those, this is a belt-and-braces check.
 */
export async function sendDMReaction({
  seed, myPubkeyHex, peerPubkeyHex,
  targetEnvelopeId, emoji, op = 'add',
  ttlSeconds = 86400,
}) {
  if (!targetEnvelopeId) throw new Error('no_target');
  if (op !== 'add' && op !== 'remove') throw new Error('bad_op');
  if (op === 'add' && !convs.ALLOWED_REACTIONS.includes(emoji)) {
    throw new Error('bad_emoji');
  }

  // Optimistic local update (we already see our own reactions)
  const previous = convs.getMyReaction(peerPubkeyHex, targetEnvelopeId, myPubkeyHex);
  convs.applyReaction(peerPubkeyHex, targetEnvelopeId, emoji, op, myPubkeyHex);

  const payload = JSON.stringify({
    kind: 'reaction',
    target_envelope_id: targetEnvelopeId,
    emoji: op === 'add' ? emoji : '',
    op,
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

  // ── Спроба SEALED ──
  const sealedRes = await trySealedSend({
    seed, myPubkeyHex, peerPubkeyHex,
    payload: {
      kind: 'reaction',
      target_envelope_id: targetEnvelopeId,
      emoji: op === 'add' ? emoji : '',
      op,
    },
    ts, ttlSeconds,
  });
  if (sealedRes) {
    return { envelope_id: sealedRes.envelope_id, status: 'sent', control: true, sealed: true };
  }

  try {
    const ack = await api.sendEnvelope({
      from: myPubkeyHex,
      to: peerPubkeyHex,
      ts, ttl: ttlSeconds, blob, sig,
    });
    return { envelope_id: ack.envelope_id, status: 'sent', control: true };
  } catch (e) {
    // Roll back local optimistic update
    if (previous) {
      convs.applyReaction(peerPubkeyHex, targetEnvelopeId, previous, 'add', myPubkeyHex);
    } else {
      convs.applyReaction(peerPubkeyHex, targetEnvelopeId, emoji, 'remove', myPubkeyHex);
    }
    throw e;
  }
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

  // ── MAIL envelope (morok.email) ─────────────────────────
  // channel==='mail' → окремий формат morok-mail-v1, розшифровуємо
  // crypto.mailOpen (не sealedDecrypt). Повертаємо mail-маркер, який
  // App.jsx направляє у поштову скриньку, а не в чати.
  if (envMeta.channel === 'mail') {
    let mailBlob;
    try {
      mailBlob = await api.fetchBlob(envelopeId);
    } catch (e) {
      console.warn('fetchBlob (mail) failed:', e);
      return null;
    }
    let email;
    try {
      email = crypto.mailOpen({
        seed,
        blobB64: crypto.bytesToBase64(mailBlob),
      });
    } catch (e) {
      console.warn('mail decrypt failed:', e?.message || e);
      return null;
    }
    return {
      __mail: true,
      envelope_id: envelopeId,
      ts: envMeta.ts || Math.floor(Date.now() / 1000),
      email,
    };
  }

  // ── SEALED DM envelope ──────────────────────────────────
  // Релей не знає відправника (from=""), тому особа з'являється лише
  // ПІСЛЯ розшифровки ефемерним ключем + перевірки внутрішнього
  // підпису. Окрема гілка перед звичайним DM.
  if (envMeta.sealed) {
    let sealedBlobBytes;
    try {
      sealedBlobBytes = await api.fetchBlob(envelopeId);
    } catch (e) {
      console.warn('fetchBlob (sealed) failed:', e);
      return null;
    }
    let opened;
    try {
      opened = crypto.sealedDecrypt({
        seed, myPubkeyHex,
        blobB64: crypto.bytesToBase64(sealedBlobBytes),
        to: myPubkeyHex,
      });
    } catch (e) {
      // Підроблений підпис / чужий конверт / биті байти — тихо кидаємо.
      console.warn('sealed decrypt/verify failed:', e?.message || e);
      return null;
    }
    const sealedPeer = opened.senderPubkeyHex;

    // Блокліст застосовуємо ПІСЛЯ розкриття особи (раніше ми її не знали).
    const cMod = await import('./contacts.js');
    if (cMod.isBlocked(sealedPeer)) return null;
    if (convs.hasEnvelope(sealedPeer, envelopeId)) return null;

    const sealedPayload = opened.payload || {};
    const sealedKind = typeof sealedPayload.kind === 'string' ? sealedPayload.kind : 'text';
    const sealedTs = opened.ts || envMeta.timestamp || envMeta.ts || Math.floor(Date.now() / 1000);

    // ── Реакція: не повідомлення, а зміна реакції на існуючому ──
    if (sealedKind === 'reaction') {
      const target = sealedPayload.target_envelope_id;
      const op = sealedPayload.op === 'remove' ? 'remove' : 'add';
      const emoji = typeof sealedPayload.emoji === 'string' ? sealedPayload.emoji : '';
      if (target) convs.applyReaction(sealedPeer, target, emoji, op, sealedPeer);
      return null;
    }

    // ── Контент: text / image / voice ──
    const msg = {
      id: `recv-${envelopeId.slice(0, 16)}`,
      envelope_id: envelopeId,
      direction: 'in',
      peer_pubkey: sealedPeer,
      text: '',
      ts: sealedTs,
      ttl: envMeta.ttl_seconds || envMeta.ttl,
      expires_at: envMeta.expires_at,
      status: 'received',
      sealed: true,
    };

    if (sealedKind === 'image') {
      msg.text = typeof sealedPayload.caption === 'string' ? sealedPayload.caption : '';
      msg.image = {
        data_b64: sealedPayload.data_b64,
        mime: sealedPayload.mime || 'image/jpeg',
        w: sealedPayload.w,
        h: sealedPayload.h,
      };
    } else if (sealedKind === 'voice') {
      msg.voice = {
        data_b64: sealedPayload.data_b64,
        mime: sealedPayload.mime || 'audio/webm',
        duration_ms: Math.max(0, Math.floor(sealedPayload.duration_ms || 0)),
      };
    } else {
      // text (default)
      msg.text = typeof sealedPayload.text === 'string' ? sealedPayload.text : '';
    }

    convs.appendMessage(sealedPeer, msg);
    return msg;
  }

  // ── DM envelope ─────────────────────────────────────────
  const peer = envMeta.sender_pubkey_hex || envMeta.from_pubkey || envMeta.from;
  const senderUsername = envMeta.from_username || null;
  if (!peer) {
    console.warn('Envelope without sender field:', envMeta);
    return null;
  }

  // ── Blocklist filter ────────────────────────────────────
  // The relay doesn't know about the user's blocklist (privacy), so it
  // happily delivers everything. Drop blocked-sender DMs silently —
  // don't fetch the blob, don't decrypt, don't append, don't notify.
  // The block is therefore effective only client-side, but that's all
  // we can guarantee without leaking the contact graph.
  const contactsMod = await import('./contacts.js');
  if (contactsMod.isBlocked(peer)) {
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

  // Оновлюємо peer_username з конверта. Три випадки:
  //  • є нік  → ставимо/оновлюємо (актуалізація).
  //  • нема ніка (звільнив) → ЯВНО скидаємо старий у null (explicitNull),
  //    інакше стара етикетка "прилипає" до розмови назавжди.
  // Безпечно: сюди доходить лише УСПІШНО розшифрований DM від реального
  // pubkey (decryptFromPeer вище), тож це справді твій співрозмовник.
  // Sealed/anon конверти сюди не доходять. Гілку "decrypt failed" не чіпаємо.
  if (senderUsername) {
    convs.ensureConversation({ peerPubkey: peer, peerUsername: senderUsername });
  } else {
    convs.ensureConversation({ peerPubkey: peer, peerUsername: null, explicitNull: true });
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
    if (control.kind === 'sealed_token') {
      // Контакт надіслав мені свій delivery-токен — зберігаємо, щоб
      // надалі слати ЙОМУ sealed-конверти. Невидиме повідомлення.
      if (typeof control.token === 'string' && /^[0-9a-f]{64}$/.test(control.token)) {
        sealedTokens.setPeerToken(peer, control.token);
      }
      return null;
    }
    if (control.kind === 'reaction') {
      // Reaction on a DM we sent or received. Look up the target by
      // envelope_id; if expired or never present locally, drop quietly.
      const target = control.target_envelope_id;
      const op = control.op === 'remove' ? 'remove' : 'add';
      const emoji = typeof control.emoji === 'string' ? control.emoji : '';
      if (!target) return null;
      // Whitelist enforced inside applyReaction; bad input → null
      convs.applyReaction(peer, target, emoji, op, peer);
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
    if (control.kind === 'voice') {
      // CONTENT — voice note. Bubble shows a play button + duration.
      const msg = {
        id: `recv-${envelopeId.slice(0, 16)}`,
        envelope_id: envelopeId,
        direction: 'in',
        peer_pubkey: peer,
        text: '',
        voice: {
          data_b64: control.data_b64,
          mime: control.mime || 'audio/webm',
          duration_ms: control.duration_ms || 0,
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


/**
 * Надіслати контакту МІЙ delivery-токен (невидиме control-повідомлення),
 * щоб він міг слати мені sealed-конверти. Викликається при відкритті
 * чату; шле не частіше ніж раз на 24 год на контакта (щоб не спамити
 * службовими конвертами при кожному відкритті).
 *
 * Тихо no-op, якщо релей не підтримує sealed (мій токен = null).
 */
const SEALED_TOKEN_SENT_KEY = 'morok.sealed.token_sent.v1';

export async function maybeShareSealedToken({ seed, myPubkeyHex, peerPubkeyHex }) {
  try {
    // Персональний токен ДЛЯ ЦЬОГО контакта (per-contact). Кожен контакт
    // отримує свій — відкликання одного не чіпає інших.
    const myToken = await sealedTokens.ensureMyTokenFor(peerPubkeyHex);
    if (!myToken) return;  // старий релей — sealed недоступний

    let sentMap = {};
    try { sentMap = JSON.parse(localStorage.getItem(SEALED_TOKEN_SENT_KEY) || '{}'); } catch {}
    const last = sentMap[peerPubkeyHex] || 0;
    const now = Date.now();
    if (now - last < 24 * 3600 * 1000) return;  // вже слали недавно

    await sendDM({
      seed, myPubkeyHex, peerPubkeyHex,
      plaintext: JSON.stringify({ kind: 'sealed_token', token: myToken }),
      // Релей обмежує TTL конверта добою (le=86400). Токен оновлюється
      // при кожному відкритті чату, тож доба — більш ніж достатньо.
      ttlSeconds: 86400,
    });
    sentMap[peerPubkeyHex] = now;
    try { localStorage.setItem(SEALED_TOKEN_SENT_KEY, JSON.stringify(sentMap)); } catch {}
  } catch (e) {
    console.warn('maybeShareSealedToken failed (non-fatal):', e?.message || e);
  }
}
