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

import { sanitizeFwd, parseEdit, TEXT_MAX, sanitizeBurn } from './msgfx.js';
import { verifyAlarm } from './alarm_cert.js';
import * as api from './api.js';
import * as sealedTokens from './sealed_tokens.js';
import * as crypto from './crypto.js';
import * as convs from './conversations.js';
import * as replay from './replay.js';
import { sanitizeIncomingUsername } from './display.js';
import { sanitizeReplyTo } from './reply.js';
import { compressImage } from './images.js';
import { blobToBase64 } from './voice.js';
import { t, tp } from './i18n.js';

const ZERO_SIG = '0'.repeat(128);

// Kinds that are purely protocol signalling — never shown to the user
// and never stored in conversation history. Everything else (raw text,
// {kind:'image'}, future content kinds) is a real message.
// мій таймер «зникнення після прочитання» — їде в повідомленнях, щоб
// співрозмовник теж знищував їх після прочитання (симетрія)
function burnField() {
  const b = convs.getReadBurnSeconds();
  return b > 0 ? { burn: b } : {};
}

// таймер співрозмовника НА МОМЕНТ надсилання: лише ці повідомлення згорять
// у мене, коли він прочитає (не ті, що я надіслав до того, як він увімкнув)
function peerBurnStamp(peerPubkeyHex) {
  const b = sanitizeBurn(convs.getConversation(peerPubkeyHex)?.peer_burn);
  return b ? { burn_peer: b } : {};
}

const WJ = '\u2060';   // див. sendDM: екранування тексту, схожого на службовий кадр
const CONTROL_KINDS = new Set(['group_key', 'group_key_request', 'reaction', 'sealed_token', 'edit']);

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
    const base = /^https?:\/\//.test(hr) ? hr.trim().replace(/\/+$/, '') : `https://${String(hr).trim()}`;
    // home_relay записаний з lookup, тобто від релею — перевіряємо формат:
    // тільки https://host[:port] (або http .onion), без шляхів і логінів.
    return api.isSafeRelayUrl(base) ? base : null;
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

export async function sendDM({ seed, myPubkeyHex, peerPubkeyHex, plaintext, ttlSeconds, replyTo = null, fwd = null, control = false }) {
  // Цитата їде лише в sealed-конверті (див. lib/reply.js).
  const reply = replyTo ? sanitizeReplyTo(replyTo) : null;
  const ts = Math.floor(Date.now() / 1000);
  // Службовий кадр — ЛИШЕ коли викликач явно каже control:true (group_key,
  // sealed_token…). Текст користувача, що випадково/зловмисно схожий на
  // JSON із полем kind (напр. переслане чуже повідомлення), не має стати
  // командою: у v1 перед ним невидимий WORD JOINER, і одержувач не
  // розбере його як кадр (а новий клієнт цей символ прибирає).
  const parsedCtl = control ? tryParseControl(plaintext) : null;
  const isControl = !!(parsedCtl && CONTROL_KINDS.has(parsedCtl.kind));
  const wirePlain = (!isControl && tryParseControl(plaintext)) ? `${WJ}${plaintext}` : plaintext;
  const blob = crypto.encryptForPeer({
    seed,
    myPubkeyHex,
    peerPubkeyHex,
    plaintext: wirePlain,
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
    ...peerBurnStamp(peerPubkeyHex),
    text: plaintext,
    ts,
    ttl: ttlSeconds,
    expires_at: ts + ttlSeconds,
    status: 'sending',
  };
  if (reply) localMsg.reply_to = reply;
  const fw = fwd ? sanitizeFwd(fwd) : null;
  if (fw) localMsg.fwd = fw;
  convs.appendMessage(peerPubkeyHex, localMsg);

  // ── Спроба SEALED (анонімно до релея) ──
  // Доставка важливіша за анонімність: null -> тихий fallback на v1.
  const sealedRes = await trySealedSend({
    seed, myPubkeyHex, peerPubkeyHex,
    payload: { kind: 'text', text: plaintext, ...(reply ? { reply_to: reply } : {}), ...(fw ? { fwd: fw } : {}), ...burnField() },
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
  // Цитата у v1 не доходить (голий текст) — прибираємо її і в себе, щоб
  // обидві сторони бачили одне й те саме.
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
      ...(reply ? { reply_to: null } : {}),
      // «Переслано» у v1 теж не доходить (голий текст)
      ...(fw ? { fwd: null } : {}),
    });
    return { ...localMsg, envelope_id: ack.envelope_id, status: 'sent', reply_to: null };
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
  preEncoded = null,   // {data_b64,mime,w,h} — уже стиснене (пересилання)
  fwd = null,
}) {
  const compressed = preEncoded?.data_b64 ? preEncoded : await compressImage(file);
  const fw = fwd ? sanitizeFwd(fwd) : null;
  const payload = JSON.stringify({
    kind: 'image',
    ...(fw ? { fwd: fw } : {}),
    ...burnField(),
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
    ...peerBurnStamp(peerPubkeyHex),
    ...(fw ? { fwd: fw } : {}),
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
      ...(fw ? { fwd: fw } : {}),
      ...burnField(),
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
  preEncoded = null,   // {data_b64,mime,duration_ms} — пересилання
  fwd = null,
}) {
  if (preEncoded?.data_b64) {
    mimeType = preEncoded.mime || mimeType;
    durationMs = preEncoded.duration_ms ?? durationMs;
  }
  const data_b64 = preEncoded?.data_b64 || await blobToBase64(audioBlob);
  const fw = fwd ? sanitizeFwd(fwd) : null;
  const rawSize = Math.floor(data_b64.length * 0.75);
  if (rawSize > 140 * 1024) {
    throw new Error(
      tp("Voice message too large ({0}KB). ", [Math.round(rawSize / 1024)]) +
      t('Record a shorter one.'),
    );
  }

  const payload = JSON.stringify({
    kind: 'voice',
    ...(fw ? { fwd: fw } : {}),
    ...burnField(),
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
    ...peerBurnStamp(peerPubkeyHex),
    ...(fw ? { fwd: fw } : {}),
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
      ...(fw ? { fwd: fw } : {}),
      ...burnField(),
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
 * Правка мого повідомлення (див. msgfx.js). Застосовується в мене одразу;
 * якщо не вдалося надіслати — відкочується. Як і реакції, іде sealed, а
 * якщо не вийшло — звичайним v1-конвертом із JSON.
 */
export async function sendDMEdit({
  seed, myPubkeyHex, peerPubkeyHex,
  targetEnvelopeId, text,
  ttlSeconds = 86400,
}) {
  const body = String(text || '').slice(0, TEXT_MAX);
  if (!targetEnvelopeId || !body.trim()) throw new Error('bad_edit');
  const conv = convs.getConversation(peerPubkeyHex);
  const orig = (conv?.messages || []).find((x) => x.envelope_id === targetEnvelopeId);
  if (!orig || orig.direction !== 'out') throw new Error('not_found');
  const before = { text: orig.text, edited: !!orig.edited, edited_at: orig.edited_at };

  const ts = Math.max(Math.floor(Date.now() / 1000), (orig.edited_at || orig.ts || 0) + 1);
  // правка живе не довше за оригінал (і не менше хвилини)
  if (Number.isFinite(orig.expires_at)) ttlSeconds = Math.max(60, Math.min(ttlSeconds, orig.expires_at - ts));
  if (!convs.applyEdit(peerPubkeyHex, targetEnvelopeId, { text: body, ts }, 'me')) {
    if (orig.text === body) return { status: 'unchanged' };
    throw new Error('edit_window');
  }
  const payloadObj = { kind: 'edit', target_envelope_id: targetEnvelopeId, text: body };

  const sealedRes = await trySealedSend({
    seed, myPubkeyHex, peerPubkeyHex, payload: payloadObj, ts, ttlSeconds,
  });
  if (sealedRes) return { envelope_id: sealedRes.envelope_id, status: 'sent', control: true, sealed: true };

  try {
    const plaintext = JSON.stringify(payloadObj);
    const blob = crypto.encryptForPeer({ seed, myPubkeyHex, peerPubkeyHex, plaintext });
    const sig = crypto.signEnvelope({ seed, fromHex: myPubkeyHex, toHex: peerPubkeyHex, ts, ttl: ttlSeconds, blobB64: blob });
    const ack = await api.sendEnvelope({ from: myPubkeyHex, to: peerPubkeyHex, ts, ttl: ttlSeconds, blob, sig });
    return { envelope_id: ack.envelope_id, status: 'sent', control: true };
  } catch (e) {
    convs.applyEdit(peerPubkeyHex, targetEnvelopeId, before, 'me', { force: true, onlyIfTs: ts });
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
/**
 * Кого вважати співрозмовником для вхідного конверта.
 *
 * ЧОМУ ЦЕ ОКРЕМА ФУНКЦІЯ. Для 99% конвертів відповідь тривіальна —
 * `from` з метаданих. Але для спрацьованого цифрового заповіту вона
 * НЕПРАВИЛЬНА, і саме через це заповіт ніколи не працював.
 *
 * ЩО БУЛО ЗЛАМАНО. Заповіт шифрується статичним ECDH між АВТОРОМ і
 * одержувачем (dms.js → encryptForPeer). Коли релей його доставляє,
 * він ставить `from = pubkey РЕЛЕЮ` — інакше не може, ключа автора в
 * нього немає (і не має бути). Клієнт брав `peer = envMeta.from` і
 * рахував ECDH(мій_приват, релей_pub) — не той ключ, розшифровка
 * падала, людина бачила «⚠ Не вдалось розшифрувати» в розмові з
 * невідомим ключем. Замість останніх слів — сміття.
 *
 * Доведено на цій же крипті: той самий blob розшифровується ключем
 * автора і кидає `invalid tag` ключем релею.
 *
 * ЧОМУ ДОВІРЯТИ `dms_creator_pubkey` З МЕТАДАНИХ БЕЗПЕЧНО. Це
 * НЕпідписане поле від релею, тобто підказка, а не доказ. Але воно
 * самоперевірне: якщо релей збреше про автора, ECDH дасть інший
 * спільний ключ і AEAD впаде на автентифікації. Тобто підробити
 * ЗМІСТ заповіту релей не може — лише не доставити його. Успішна
 * розшифровка і є підтвердженням авторства.
 *
 * Повертає { peer, isDmsTrigger }.
 */
export function resolveIncomingPeer(envMeta) {
  const creator = envMeta?.dms_creator_pubkey;
  const isDmsTrigger = envMeta?.kind === 'dms_trigger'
    && typeof creator === 'string'
    && /^[0-9a-f]{64}$/i.test(creator);

  const peer = isDmsTrigger
    ? creator.toLowerCase()
    : (envMeta?.sender_pubkey_hex || envMeta?.from_pubkey || envMeta?.from || null);

  return { peer, isDmsTrigger };
}


export async function processIncoming({ envMeta, seed, myPubkeyHex }) {
  const envelopeId = envMeta.envelope_id;

  // ── GROUP envelope ──────────────────────────────────────
  if (envMeta.group_id) {
    const groupsMod = await import('./groups.js');
    return await groupsMod.processIncomingGroupEnvelope({
      envMeta, myPubkeyHex, seed,
    });
  }

  // ── MAIL envelope (morok.email) ─────────────────────────
  // channel==='mail' → окремий формат morok-mail-v1, розшифровуємо
  // crypto.mailOpen (не sealedDecrypt). Повертаємо mail-маркер, який
  // App.jsx направляє у поштову скриньку, а не в чати.
  if (envMeta.channel === 'mail') {
    // синхрон: якщо цей лист уже у скриньці — не тягнемо блоб повторно
    const mailStore = await import('./mail_store.js');
    try {
      const have = await mailStore.getEmail(envelopeId);
      if (have) {
        // запис існує (лист або надгробок видаленого) — блоб не тягнемо,
        // подію не шлемо як новий; надгробок лишає лист мертвим назавжди
        return { __mail: true, envelope_id: envelopeId, isNew: false, email: have.email };
      }
    } catch { /* ignore */ }

    let mailBlob;
    try {
      mailBlob = await api.fetchBlob(envelopeId);
    } catch (e) {
      console.warn('fetchBlob (mail) failed:', e);
      if (e?.code === 'network') return { __retry: true, envelope_id: envelopeId };
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
      // НЕ null: null → ack, а пошта не ack-ається навіть при успіху
      // (мультидевайс). Ack тут стер би лист із черги і для інших
      // пристроїв, де він, можливо, розшифрувався б. __retry лишає
      // конверт у черзі до TTL (7 діб): транзієнтний збій вилікується
      // наступним catchup'ом, стійкий — помре природно за TTL.
      return { __retry: true, envelope_id: envelopeId };
    }
    // ── ДОВІРА ДО ВІДПРАВНИКА ──
    // Внутрішній лист: блоб будував клієнт-відправник, тож полю from/spf у
    // блобі НЕ довіряємо. Особу беремо ТІЛЬКИ із серверних метаданих конверта
    // (mail_from перевірено сервером = аліас реально належить відправнику).
    // Зовнішній лист: блоб будував релей → блобу можна довіряти.
    // Fail-closed: довіряємо блобу ЛИШЕ коли релей явно позначив лист як
    // зовнішній. Будь-що інше (поле відсутнє, невідоме значення) —
    // трактуємо як внутрішній, тобто НЕ віримо from/spf з блоба.
    if (envMeta.mail_origin !== 'external') {
      email.out = false;
      delete email.ext_status;
      email.spf = 'internal';
      email.internal = true;
      if (envMeta.mail_from) {
        email.from = `${envMeta.mail_from}@morok.email`;
        email.from_verified = true;
      } else {
        email.from = t('Anonymous sender');
        email.from_verified = false;
      }
    }
    const isNew = await mailStore.addEmail({
      envelopeId,
      ts: envMeta.ts || Math.floor(Date.now() / 1000),
      email,
    });
    return {
      __mail: true,
      envelope_id: envelopeId,
      isNew,        // false → дубль (повторний catchup), звук не грати
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
      if (e?.code === 'network') return { __retry: true, envelope_id: envelopeId };
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
      console.warn('sealed decrypt/verify failed:', e?.message || e);
      // Stub неможливий: відправник стає відомий лише ПІСЛЯ розшифровки.
      // Але й null → ack губить повідомлення назавжди при першому ж збої.
      // __retry: конверт лишається в черзі до TTL (≤ доби) і повторюється
      // наступним catchup'ом. Отруйні конверти обмежені протоколом — без
      // мого delivery-токена sealed у чергу не потрапляє, тож сміття може
      // слати лише той, кому я сам видав токен, і воно згорає за добу.
      return { __retry: true, envelope_id: envelopeId };
    }
    const sealedPeer = opened.senderPubkeyHex;

    // Блокліст застосовуємо ПІСЛЯ розкриття особи (раніше ми її не знали).
    const cMod = await import('./contacts.js');
    if (cMod.isBlocked(sealedPeer)) return null;
    if (convs.hasEnvelope(sealedPeer, envelopeId)) return null;

    const sealedPayload = opened.payload || {};
    const sealedKind = typeof sealedPayload.kind === 'string' ? sealedPayload.kind : 'text';
    const sealedTs = opened.ts || envMeta.timestamp || envMeta.ts || Math.floor(Date.now() / 1000);

    // ── Тривожний сигнал (див. morok-rn/lib/alarm.js) ──
    // Конверт підписаний тривожним ключем контакта, а сертифікат — його
    // ОСНОВНИМ ключем. Перевірили → показуємо в чаті з основним акаунтом.
    if (sealedKind === 'text' && sealedPayload.alarm) {
      const al = verifyAlarm(sealedPayload.alarm, sealedPeer);
      if (al) {
        if (cMod.isBlocked(al.main)) return null;
        if (convs.hasEnvelope(al.main, envelopeId)) return null;
        // Старий сигнал, повторно підкинутий релеєм під новим envelope_id,
        // не має виглядати свіжою тривогою: лише свіжі, кожен — один раз.
        if (Math.abs(Math.floor(Date.now() / 1000) - Number(sealedTs)) > 86400) return null;
        const rid = crypto.bytesToHex(crypto.sha256Bytes(crypto.utf8(`alarm|${sealedPeer}|${sealedTs}|${sealedPayload.text}`)));
        if (replay.seen(rid)) return null;
        replay.remember(rid);
        const am = {
          id: `recv-${envelopeId.slice(0, 16)}`,
          envelope_id: envelopeId,
          direction: 'in',
          peer_pubkey: al.main,
          text: typeof sealedPayload.text === 'string' ? sealedPayload.text.slice(0, 400) : '',
          ts: sealedTs,
          ttl: envMeta.ttl_seconds || envMeta.ttl,
          expires_at: envMeta.expires_at,
          status: 'received',
          sealed: true,
          alarm: true,
          ...(al.test ? { alarm_test: true } : {}),
        };
        convs.appendMessage(al.main, am);
        return am;
      }
    }

    // ── Реакція: не повідомлення, а зміна реакції на існуючому ──
    if (sealedKind === 'reaction') {
      const target = sealedPayload.target_envelope_id;
      const op = sealedPayload.op === 'remove' ? 'remove' : 'add';
      const emoji = typeof sealedPayload.emoji === 'string' ? sealedPayload.emoji : '';
      if (target) convs.applyReaction(sealedPeer, target, emoji, op, sealedPeer);
      return { __update: true, peer_pubkey: sealedPeer };
    }

    // ── Правка: змінює текст наявного повідомлення цього ж автора ──
    if (sealedKind === 'edit') {
      const ed = parseEdit(sealedPayload, sealedTs);
      if (ed && convs.applyEdit(sealedPeer, ed.target, ed, sealedPeer)) return { __update: true, peer_pubkey: sealedPeer };
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
    const sealedFwd = sanitizeFwd(sealedPayload.fwd);
    if (sealedFwd) msg.fwd = sealedFwd;
    // таймер відправника: знищити після прочитання + запам'ятати його вибір
    const sealedBurn = sanitizeBurn(sealedPayload.burn);
    if (sealedBurn) msg.burn = sealedBurn;

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
      const r = sanitizeReplyTo(sealedPayload.reply_to);
      if (r) msg.reply_to = r;
    }

    convs.appendMessage(sealedPeer, msg);
    convs.setPeerBurn(sealedPeer, sealedBurn);
    return msg;
  }

  // ── DM envelope ─────────────────────────────────────────
  const { peer, isDmsTrigger } = resolveIncomingPeer(envMeta);
  // Особа відправника звичайного DM — ЛИШЕ підписаний `from`. Інші поля
  // (sender_pubkey_hex, from_pubkey) релей може дописати як завгодно.
  if (!crypto.isPubkeyHex(envMeta.from) || !crypto.isPubkeyHex(peer) ||
      (!isDmsTrigger && peer !== envMeta.from)) {
    console.warn('DM envelope with invalid sender, dropped');
    return null;
  }
  // Для заповіту `from_username` — це нік РЕЛЕЮ (а точніше його немає),
  // а не автора. Беремо null, щоб нижче не чіпати збережений нік автора.
  const senderUsername = isDmsTrigger ? null : sanitizeIncomingUsername(envMeta.from_username);
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
    // Мережевий збій ≠ «оброблено». Маркер каже App.jsx НЕ ack-ати конверт:
    // інакше повідомлення зникає назавжди при одній осічці зв'язку.
    if (e?.code === 'network') return { __retry: true, envelope_id: envelopeId };
    return null;
  }
  const blobB64 = crypto.bytesToBase64(blobBytes);

  // ── Автентичність і свіжість конверта ───────────────────
  // 1) підпис `from` над {from,to,ts,ttl,blob} — релей не може видати мій
  //    же конверт за чужий (віддзеркалення) чи підмінити адресата;
  // 2) to — це я;
  // 3) не протух за підписаним ts+ttl (повтор старого конверта);
  // 4) той самий підпис ще не оброблявся (повтор під новим envelope_id).
  //
  // Виняток — анонімна скринька (burner): відправник одноразовий, релей
  // ставить нульовий підпис-заглушку і нік «🔥burner». Такі листи
  // приймаємо без підпису, але: (а) вони ніколи не виконуються як службові
  // кадри (див. isBurner нижче); (б) ефемерний ключ не може збігатися з
  // контактом чи наявною розмовою — інакше релей видав би мій же лист до
  // Боба за «анонімку» в чаті з Бобом.
  const isBurner = !isDmsTrigger && envMeta.sig === ZERO_SIG &&
    typeof senderUsername === 'string' && senderUsername.startsWith('🔥burner');
  if (envMeta.to !== myPubkeyHex) {
    console.warn('DM envelope for another recipient, dropped');
    return null;
  }
  if (isBurner) {
    const c = await import('./contacts.js');
    const known = convs.getConversation ? convs.getConversation(peer) : null;
    if (c.isInContacts(peer) || (known && !String(known.peer_username || '').startsWith('🔥burner'))) {
      console.warn('burner envelope from a known peer, dropped');
      return null;
    }
  } else {
    if (!crypto.verifyEnvelope({
      fromHex: envMeta.from, toHex: envMeta.to, ts: envMeta.ts, ttl: envMeta.ttl,
      blobB64, sigHex: envMeta.sig,
    })) {
      console.warn('DM envelope signature invalid, dropped');
      return null;
    }
    if (replay.seen(envMeta.sig)) return null;
    replay.remember(envMeta.sig);
  }
  if (!replay.isFresh(envMeta.ts, envMeta.ttl)) {
    console.warn('DM envelope outside its lifetime, dropped');
    return null;
  }

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
      error: 'Couldn\'t decrypt',
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
  } else if (!isDmsTrigger) {
    convs.ensureConversation({ peerPubkey: peer, peerUsername: null, explicitNull: true });
  }
  // isDmsTrigger → НЕ чіпаємо нік узагалі. Конверт приходить від релею,
  // тож `from_username` порожній завжди; explicitNull тут стер би
  // збережений нік автора в наявній розмові — тобто заповіт мовчки
  // перейменував би контакт на голий pubkey.

  // Control message?
  // Заповіт НІКОЛИ не інтерпретуємо як службовий кадр. Текст пише
  // людина; якщо вона напише щось схоже на JSON з полем kind, воно не
  // має виконуватись як group_key чи sealed_token.
  // Анонімці (burner) теж не довіряємо службові кадри: інакше будь-хто з
  // посиланням на скриньку міг би підкинути group_key / sealed_token.
  const control = (isDmsTrigger || isBurner) ? null : tryParseControl(plaintext);
  if (control) {
    if (control.kind === 'group_key') {
      try {
        const groupsMod = await import('./groups.js');
        const res = await groupsMod.processIncomingGroupKey({ payload: control, senderPubkeyHex: peer });
        if (res?.__retry) {
          replay.forget(envMeta.sig); // конверт прийде знову — не відкидати як повтор
          return { __retry: true, envelope_id: envelopeId };
        }
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
      convs.setPeerBurn(peer, sanitizeBurn(control.burn));
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
      return { __update: true, peer_pubkey: peer };
    }
    if (control.kind === 'edit') {
      // Правка: лише вхідного повідомлення ЦЬОГО ж відправника (перевіряє
      // applyEdit), час — підписаний ts конверта.
      const ed = parseEdit(control, Number(envMeta.ts));
      if (ed && convs.applyEdit(peer, ed.target, ed, peer)) return { __update: true, peer_pubkey: peer };
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
      const cf = sanitizeFwd(control.fwd);
      if (cf) msg.fwd = cf;
      const cb = sanitizeBurn(control.burn);
      if (cb) msg.burn = cb;
      convs.appendMessage(peer, msg);
      convs.setPeerBurn(peer, cb);
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
      const cf = sanitizeFwd(control.fwd);
      if (cf) msg.fwd = cf;
      const cb = sanitizeBurn(control.burn);
      if (cb) msg.burn = cb;
      convs.appendMessage(peer, msg);
      convs.setPeerBurn(peer, cb);
      return msg;
    }
    // Unknown control kind → fall through to display as text
  }

  const msg = {
    id: `recv-${envelopeId.slice(0, 16)}`,
    envelope_id: envelopeId,
    direction: 'in',
    peer_pubkey: peer,
    // екранований відправником текст (див. sendDM) — прибираємо маркер
    text: plaintext.startsWith(`${WJ}{`) ? plaintext.slice(1) : plaintext,
    ts: envMeta.timestamp || envMeta.ts || Math.floor(Date.now() / 1000),
    ttl: envMeta.ttl_seconds || envMeta.ttl,
    expires_at: envMeta.expires_at,
    status: 'received',
  };
  if (isDmsTrigger) {
    // Мітка для UI. Без неї людина побачила б звичайне повідомлення
    // «щойно від друга» — а насправді автор написав його заздалегідь і
    // мовчить від самого `ts`. Видавати заздалегідь залишені останні
    // слова за свіже повідомлення — оманливо.
    msg.dms_trigger = true;
    msg.dms_id = typeof envMeta.dms_id === 'string' ? envMeta.dms_id : null;
  }
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
      plaintext: JSON.stringify({ kind: 'sealed_token', token: myToken, ...burnField() }),
      control: true,
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
