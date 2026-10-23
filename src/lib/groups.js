/**
 * Group business logic.
 *
 * High-level operations:
 *
 *   createGroup(name, memberPubkeys)
 *     → generate group_key
 *     → encrypt name with group_key
 *     → POST /api/v1/groups
 *     → add each member via add_member endpoint
 *     → send each member a DM with kind=group_key carrying the group_key
 *     → store locally
 *
 *   processIncomingGroupKey(payload)
 *     called when a DM arrives with kind=group_key
 *     → store group_key locally
 *     → GET /groups/{id} to fetch metadata + decrypt name
 *
 *   processIncomingGroupKeyRequest(senderPubkey, payload, seed, myPubkeyHex)
 *     called when a DM arrives with kind=group_key_request
 *     → if we have the group_key locally → DM it back as group_key
 *     → else ignore (some other member will respond)
 *
 *   sendGroupMessage(groupId, text, ttl)
 *     → wrap in JSON {kind: 'group_msg', text}
 *     → encrypt with group_key
 *     → sign envelope (to=group_id)
 *     → POST /api/v1/groups/{id}/messages
 *
 *   processIncomingGroupEnvelope(envMeta, ourSeedBytes, ourPubkeyHex)
 *     → fetch blob
 *     → decrypt with stored group_key
 *     → parse JSON, dispatch by kind
 *     → store as message in group_storage
 *
 *   joinViaToken(token, seed, myPubkeyHex)
 *     → POST /api/v1/groups/join?token=...
 *     → GET /groups/{id} to get member list
 *     → DM kind=group_key_request to every other member
 *     → first one who responds (could be admin, could be any member with
 *       the key already) sends back kind=group_key
 *     → mark stub locally while we wait
 */

import * as api from './api.js';
import * as crypto from './crypto.js';
import * as gstore from './group_storage.js';
import * as replay from './replay.js';
import { sanitizeIncomingUsername } from './display.js';
import { sanitizeReplyTo } from './reply.js';
import * as gsec from './group_sec.js';
import * as inflight from './inflight.js';
import { sanitizeFwd, parseEdit, TEXT_MAX } from './msgfx.js';

/** group_id від релею — канонічний UUID. Будь-що інше відкидаємо. */
export function isGroupId(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
}
import * as msgs from './messages.js';
import { compressImage } from './images.js';
import { blobToBase64 } from './voice.js';
import { t, tp } from './i18n.js';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function nowSeconds() { return Math.floor(Date.now() / 1000); }

function wrapGroupPayload(kind, data) {
  return JSON.stringify({ kind, ...data });
}

function parseGroupPayload(plaintext) {
  try {
    const obj = JSON.parse(plaintext);
    if (obj && typeof obj === 'object' && typeof obj.kind === 'string') {
      return obj;
    }
  } catch {}
  return null;
}

// ────────────────────────────────────────────────────────────
// Create group
// ────────────────────────────────────────────────────────────

async function createGroup__impl({
  name,
  members = [],
  defaultTtlSeconds = 86400,
  seed,
  myPubkeyHex,
}) {
  const groupKey = crypto.generateSymmetricKey();
  const groupKeyB64 = crypto.bytesToBase64(groupKey);
  const nameEncryptedB64 = crypto.encryptStringWithKey(groupKey, name);

  const groupInfo = await api.createGroup({
    nameEncryptedB64,
    defaultTtlSeconds,
  });

  gstore.upsertGroup({
    group_id: groupInfo.group_id,
    name,
    creator_pubkey_hex: groupInfo.creator_pubkey_hex,
    is_channel: groupInfo.is_channel,
    default_ttl_seconds: groupInfo.default_ttl_seconds,
    max_members: groupInfo.max_members,
    member_count: groupInfo.member_count,
    members: groupInfo.members,
    group_key_b64: groupKeyB64,
  });
  // Захищена група з першого дня: адмін — я, довірені — ті, кого додаю.
  gstore.setGroupField(groupInfo.group_id, 'admin_pin', myPubkeyHex);
  gstore.setGroupSec(groupInfo.group_id, gsec.signState(gsec.newState({
    groupId: groupInfo.group_id, adminPk: myPubkeyHex, groupKeyB64,
    vouched: members.map((m) => m.pubkey_hex),
  }), seed));

  let addedCount = 0;
  let failedCount = 0;
  for (const m of members) {
    try {
      await api.addGroupMember(groupInfo.group_id, m.pubkey_hex);
      await sendGroupKeyDM({
        seed, myPubkeyHex,
        peerPubkeyHex: m.pubkey_hex,
        groupId: groupInfo.group_id,
        groupKeyB64,
        name,
      });
      addedCount++;
    } catch (e) {
      console.warn('Failed to add or DM key to member', m.pubkey_hex, e);
      failedCount++;
    }
  }

  if (addedCount > 0) {
    try {
      const fresh = await api.getGroupInfo(groupInfo.group_id);
      gstore.upsertGroup({
        group_id: fresh.group_id,
        name,
        creator_pubkey_hex: fresh.creator_pubkey_hex,
        is_channel: fresh.is_channel,
        default_ttl_seconds: fresh.default_ttl_seconds,
        max_members: fresh.max_members,
        member_count: fresh.member_count,
        members: fresh.members,
        group_key_b64: groupKeyB64,
      });
    } catch (e) { console.warn('group refresh failed:', e); }
  }

  return {
    group_id: groupInfo.group_id,
    group: gstore.getGroup(groupInfo.group_id),
    addedCount,
    failedCount,
  };
}

// ────────────────────────────────────────────────────────────
// Group key DM distribution
// ────────────────────────────────────────────────────────────

export async function sendGroupKeyDM({
  seed, myPubkeyHex, peerPubkeyHex,
  groupId, groupKeyB64, name,
}) {
  const sec = gstore.getGroupSec(groupId);
  const payload = wrapGroupPayload('group_key', {
    group_id: groupId,
    key_b64: groupKeyB64,
    name,
    ...(sec ? { sec } : {}),
  });
  await msgs.sendDM({
    seed, myPubkeyHex, peerPubkeyHex,
    plaintext: payload,
    control: true,
    ttlSeconds: 86400,
  });
}

/**
 * Send a group_key_request DM to a peer (presumably a group member
 * who already has the key).
 */
export async function sendGroupKeyRequestDM({
  seed, myPubkeyHex, peerPubkeyHex, groupId, inviteSeedHex = null, keyProofB64 = null,
}) {
  // Доказ запрошення, прив'язаний до мене І до цього одержувача (див.
  // group_sec.js): копію, що дісталась підставному учаснику, не можна
  // показати чесному. Сам ключ запрошення з посилання нікуди не йде.
  const invite_proof = gsec.isHex64(inviteSeedHex)
    ? gsec.makeInviteProof({ inviteSeedHex, groupId, fromPk: myPubkeyHex, toPk: peerPubkeyHex })
    : null;
  const key_proof = keyProofB64
    ? gsec.makeKeyProof({ groupKeyB64: keyProofB64, groupId, fromPk: myPubkeyHex, toPk: peerPubkeyHex })
    : null;
  const payload = wrapGroupPayload('group_key_request', {
    group_id: groupId,
    ...(invite_proof ? { invite_proof } : {}),
    ...(key_proof ? { key_proof } : {}),
  });
  await msgs.sendDM({
    seed, myPubkeyHex, peerPubkeyHex,
    plaintext: payload,
    control: true,
    ttlSeconds: 86400,
  });
}

/**
 * Called from messages.js when a DM with kind=group_key arrives.
 * Stores the key locally and fetches group metadata.
 */
export async function processIncomingGroupKey({ payload, senderPubkeyHex }) {
  if (!payload?.group_id || typeof payload?.key_b64 !== 'string') {
    console.warn('group_key DM missing fields');
    return;
  }
  // Формат id: інакше "../me#" ставав частиною шляху API (див. api.seg).
  if (!isGroupId(payload.group_id)) {
    console.warn('group_key with malformed group_id, ignored');
    return;
  }
  // Ключ — рівно 32 байти.
  let keyLen = 0;
  try { keyLen = crypto.base64ToBytes(payload.key_b64).length; } catch { /* bad b64 */ }
  if (keyLen !== 32) {
    console.warn('group_key with malformed key, ignored');
    return;
  }

  // ── Хто має право видати ключ ──
  // Раніше будь-хто (навіть анонімний burner) міг DM-ом ПЕРЕЗАПИСАТИ ключ
  // наявної групи — і далі твої повідомлення в ній шифрувались ключем
  // нападника. Тепер:
  //   • ключ уже є → приймаємо лише той самий (повтор), інший ігноруємо;
  //   • ключа ще нема → відправник має бути учасником цієї групи на релеї.
  const existing = gstore.getGroup(payload.group_id);
  if (!existing && _joinsInProgress > 0) return { __retry: true };
  if (existing?.group_key_b64) {
    const pin = existing.admin_pin || null;
    const curSeq = existing.sec?.state?.seq || 0;
    if (existing.group_key_b64 === payload.key_b64) {
      // Той самий ключ, але, можливо, новіший підписаний стан — беремо його
      // (так стан доходить і до тих, хто пропустив розсилку).
      const st = pin && payload.sec
        ? gsec.verifySigned(payload.sec, { groupId: payload.group_id, groupKeyB64: existing.group_key_b64, adminPin: pin })
        : null;
      if (st && st.seq > curSeq) applyNewerState(payload.group_id, st, payload.sec.sig);
      return;
    }
    // ІНШИЙ ключ — це може бути лише перевипуск: стан, підписаний
    // закріпленим адміном і прив'язаний (kh) саме до цього нового ключа.
    // Переслати його може будь-хто — важить підпис адміна.
    const st = pin && payload.sec
      ? gsec.verifySigned(payload.sec, { groupId: payload.group_id, groupKeyB64: payload.key_b64, adminPin: pin })
      : null;
    if (!st) {
      console.warn('group_key: different key without a rekey signed by the group admin — ignored');
      return;
    }
    // Спершу seq, потім «чи знаю ключ»: ключ, що колись потрапив у старі,
    // має стати поточним, якщо його стан новіший.
    if (st.seq > curSeq) {
      gstore.rotateGroupKey(payload.group_id, payload.key_b64);
      applyNewerState(payload.group_id, st, payload.sec.sig, { rotated: true });
      gstore.setGroupField(payload.group_id, 'key_req_at', 0);
      reprocessDeferred(payload.group_id);
    } else if (!gstore.hasGroupKey(payload.group_id, payload.key_b64)) {
      // проміжний ключ, що прийшов пізніше за новіший, — лише для розшифрування
      gstore.addOldGroupKey(payload.group_id, payload.key_b64);
      reprocessDeferred(payload.group_id);
    }
    return;
  }

  let info;
  try {
    info = await api.getGroupInfo(payload.group_id);
  } catch (e) {
    // Мережа / 5xx / 404 (снапшот федеративної групи ще не доїхав до
    // нашого релею — він іде окремою чергою) → НЕ губимо ключ: просимо
    // не ack-ати конверт, наступний catch-up спробує ще раз (до TTL).
    console.warn('group_key: cannot verify yet, will retry:', e?.message);
    if (e?.code === 'network' || e?.status === 404 || (e?.status >= 500)) {
      return { __retry: true };
    }
    return;
  }
  if (!info || info.group_id !== payload.group_id ||
      !Array.isArray(info.members) ||
      !info.members.some((m) => m?.pubkey_hex === senderPubkeyHex)) {
    console.warn('group_key from a non-member, ignored');
    return;
  }

  // ── Захищена група ──
  // Я приєднався за посиланням із ключем адміна → приймаю ключ групи ЛИШЕ
  // разом зі станом, підписаним саме цим адміном і прив'язаним (kh) саме до
  // цього ключа. Підставний «учасник» від релею не може ні того, ні іншого.
  const joinAdmin = gstore.getGroupField(payload.group_id, 'join_admin');
  const verified = payload.sec
    ? gsec.verifySigned(payload.sec, { groupId: payload.group_id, groupKeyB64: payload.key_b64, adminPin: joinAdmin })
    : null;
  if (joinAdmin && !verified) {
    console.warn('group_key without a state signed by the inviting admin — ignored');
    return;
  }

  gstore.storeGroupKey(payload.group_id, payload.key_b64, payload.name || null);
  const pinned = gstore.getGroupField(payload.group_id, 'admin_pin');
  if (verified && (joinAdmin || ((!pinned || pinned === verified.admin)
      && (verified.admin === senderPubkeyHex || verified.admin === info.creator_pubkey_hex)))) {
    gstore.setGroupField(payload.group_id, 'admin_pin', verified.admin);
    gstore.setGroupSec(payload.group_id, { state: verified, sig: String(payload.sec.sig).toLowerCase() });
  } else if (!gstore.getGroupField(payload.group_id, 'admin_pin') && crypto.isPubkeyHex(info.creator_pubkey_hex)) {
    // легасі: закріплюємо творця, якого називає релей зараз (TOFU)
    gstore.setGroupField(payload.group_id, 'admin_pin', info.creator_pubkey_hex);
  }
  gstore.setGroupField(payload.group_id, 'join_admin', null);

  try {
    gstore.upsertGroup({
      group_id: info.group_id,
      name: payload.name || null,
      creator_pubkey_hex: info.creator_pubkey_hex,
      is_channel: info.is_channel,
      default_ttl_seconds: info.default_ttl_seconds,
      max_members: info.max_members,
      member_count: info.member_count,
      members: info.members,
      group_key_b64: payload.key_b64,
    });
  } catch (e) {
    console.warn('Group info fetch failed (will retry on open):', e?.message);
  }
}

/**
 * Called from messages.js when a DM with kind=group_key_request arrives.
 * If we have the group_key locally → DM it back. Else silently ignore.
 *
 * To prevent abuse, we only respond if the requester is actually a
 * current member of the group on the server.
 */
export async function processIncomingGroupKeyRequest({
  payload, senderPubkeyHex, seed, myPubkeyHex,
}) {
  if (!payload?.group_id) return;
  const group = gstore.getGroup(payload.group_id);
  if (!group || !group.group_key_b64) return; // we don't have the key either

  // Verify requester is actually a member (otherwise this is abuse)
  let info;
  try {
    info = await api.getGroupInfo(payload.group_id);
  } catch (e) {
    console.warn('Cannot verify requester membership:', e?.message);
    return;
  }
  const isMember = info.members.some((m) => m.pubkey_hex === senderPubkeyHex);
  if (!isMember) {
    console.warn('group_key_request from non-member, ignoring:', senderPubkeyHex);
    return;
  }

  // Захищена група: списку релею недостатньо — запитувача має довірити
  // адмін (vouched) або він має показати секрет виданого адміном запрошення.
  const signed = gstore.getGroupSec(payload.group_id);
  const localVouched = gstore.getGroupField(payload.group_id, 'vouched_local') || [];
  if (signed) {
    let why = gsec.requestAllowed({
      state: signed.state, localVouched, requesterPk: senderPubkeyHex,
      myPk: myPubkeyHex, groupId: payload.group_id, proof: payload.invite_proof,
    });
    // видалений не повертається за старим запрошенням (повернути може лише
    // адмін явно — тоді він знову в підписаному стані, тобто 'vouched')
    if (why === 'invite' && removedSet(payload.group_id).has(senderPubkeyHex)) why = null;
    let viaKey = false;
    if (!why && signed.state.admin === myPubkeyHex && payload.key_proof
        && !removedSet(payload.group_id).has(senderPubkeyHex)
        && gsec.verifyKeyProof(payload.key_proof, {
          // лише поточний ключ і ті, що вийшли з ужитку недавно: «колись мав
          // ключ» не має назавжди означати «довірений»
          keysB64: gstore.getGroupKeys(payload.group_id, { maxAgeS: KEY_PROOF_MAX_AGE_S }), groupId: payload.group_id,
          fromPk: senderPubkeyHex, toPk: myPubkeyHex,
        })) {
      // Я адмін, а запитувач довів, що мав ключ групи (пропустив
      // перевипуск: був офлайн, «мовчазний» учасник, або його допустив інший
      // учасник). Тих, кого я видаляв, не повертаю.
      viaKey = true;
      // стан міняємо одразу, а розсилку всім — пакетом раз на кілька хвилин
      // (ключ-DM запитувачу й так несе актуальний стан)
      await broadcastSecUpdate({ groupId: payload.group_id, update: { add: [senderPubkeyHex] }, seed, myPubkeyHex, deferBroadcast: true }).catch(() => {});
    }
    if (!why && !viaKey) {
      console.warn('group_key_request not vouched by admin, ignoring:', senderPubkeyHex.slice(0, 8));
      return;
    }
    if (why === 'invite') {
      if (signed.state.admin === myPubkeyHex) {
        // я адмін — вношу в підписаний стан, щоб і видалення потім діяло для всіх
        await broadcastSecUpdate({ groupId: payload.group_id, update: { add: [senderPubkeyHex] }, seed, myPubkeyHex, deferBroadcast: true }).catch(() => {});
      } else if (!localVouched.includes(senderPubkeyHex)) {
        gstore.setGroupField(payload.group_id, 'vouched_local', [...localVouched, senderPubkeyHex].slice(-1000));
      }
    }
  } else {
    // Підписаного стану в мене немає (легасі-група або я пропустив розсилку
    // адміна — релей міг її просто не доставити). Списку релею не віримо:
    // ключ лише закріпленому адміну/творцю, тим, хто вже писав у групу
    // (повідомлення, підписані й розшифровані ключем групи, — отже ключ у
    // них і так є), і тим, кого я сам раніше допустив.
    let pin = group.admin_pin || null;
    if (!pin && crypto.isPubkeyHex(group.creator_pubkey_hex)) {
      pin = group.creator_pubkey_hex;
      gstore.setGroupField(payload.group_id, 'admin_pin', pin);
    }
    const wrote = (group.messages || []).some((m) => m.direction === 'in' && m.sender_pubkey === senderPubkeyHex && m.status !== 'undecryptable');
    if (senderPubkeyHex !== pin && !wrote && !localVouched.includes(senderPubkeyHex)) {
      console.warn('group_key_request in a group without signed state from an unproven member, ignoring:', senderPubkeyHex.slice(0, 8));
      return;
    }
  }

  try {
    await sendGroupKeyDM({
      seed, myPubkeyHex,
      peerPubkeyHex: senderPubkeyHex,
      groupId: payload.group_id,
      groupKeyB64: gstore.getGroupKey(payload.group_id) || group.group_key_b64,
      name: group.name || '',
    });
    console.info('Sent group_key in reply to request from', senderPubkeyHex.slice(0, 8));
  } catch (e) {
    console.warn('Failed to send group_key reply:', e);
  }
}

// ────────────────────────────────────────────────────────────
// Send group message
// ────────────────────────────────────────────────────────────

async function sendGroupMessage__impl({
  groupId, text, ttlSeconds = 86400,
  seed, myPubkeyHex, replyTo = null, fwd = null,
}) {
  const reply = replyTo ? sanitizeReplyTo(replyTo) : null;
  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    throw new Error(t('No group key'));
  }
  const groupKey = crypto.base64ToBytes(group.group_key_b64);

  const fw = fwd ? sanitizeFwd(fwd) : null;
  const payload = wrapGroupPayload('group_msg', { text, ...(reply ? { reply_to: reply } : {}), ...(fw ? { fwd: fw } : {}) });
  const blobB64 = crypto.encryptStringWithKey(groupKey, payload);

  const ts = nowSeconds();
  const sig = crypto.signEnvelope({
    seed,
    fromHex: myPubkeyHex,
    toHex: groupId,
    ts,
    ttl: ttlSeconds,
    blobB64,
  });

  const localMsg = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    direction: 'out',
    sender_pubkey: myPubkeyHex,
    text,
    ts,
    ttl: ttlSeconds,
    expires_at: ts + ttlSeconds,
    status: 'sending',
  };
  if (reply) localMsg.reply_to = reply;
  if (fw) localMsg.fwd = fw;
  gstore.appendMessage(groupId, localMsg);

  try {
    const ack = await api.sendGroupMessage(groupId, {
      from: myPubkeyHex,
      to: groupId,
      ts,
      ttl: ttlSeconds,
      blob: blobB64,
      sig,
    });
    gstore.updateMessage(groupId, localMsg.id, {
      envelope_id: ack.envelope_id,
      status: 'sent',
      expires_at: ack.expires_at || (ts + ttlSeconds),
    });
    return { ...localMsg, envelope_id: ack.envelope_id, status: 'sent' };
  } catch (e) {
    gstore.updateMessage(groupId, localMsg.id, {
      status: 'failed',
      error: e.message,
    });
    throw e;
  }
}

/**
 * Правка мого повідомлення в групі. Застосовується в мене одразу, при
 * помилці — відкочується. Іде звичайним груповим конвертом (kind 'edit'):
 * старі клієнти такий kind ігнорують.
 */
async function sendGroupEdit__impl({ groupId, targetEnvelopeId, text, ttlSeconds = 86400, seed, myPubkeyHex }) {
  const body = String(text || '').slice(0, TEXT_MAX);
  if (!targetEnvelopeId || !body.trim()) throw new Error('bad_edit');
  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) throw new Error(t('No group key'));
  const orig = (group.messages || []).find((x) => x.envelope_id === targetEnvelopeId);
  if (!orig || orig.direction !== 'out') throw new Error('not_found');
  const before = { text: orig.text, edited: !!orig.edited, edited_at: orig.edited_at };
  const ts = Math.max(nowSeconds(), (orig.edited_at || orig.ts || 0) + 1);
  // правка живе стільки ж, скільки лишилось оригіналу (не менше хвилини)
  if (Number.isFinite(orig.expires_at)) ttlSeconds = Math.max(60, orig.expires_at - ts);
  if (!gstore.applyEdit(groupId, targetEnvelopeId, { text: body, ts }, 'me')) {
    if (orig.text === body) return { status: 'unchanged' };
    throw new Error('edit_window');
  }
  try {
    const groupKey = crypto.base64ToBytes(group.group_key_b64);
    const blobB64 = crypto.encryptStringWithKey(groupKey, wrapGroupPayload('edit', { target_envelope_id: targetEnvelopeId, text: body }));
    const sig = crypto.signEnvelope({ seed, fromHex: myPubkeyHex, toHex: groupId, ts, ttl: ttlSeconds, blobB64 });
    const ack = await api.sendGroupMessage(groupId, { from: myPubkeyHex, to: groupId, ts, ttl: ttlSeconds, blob: blobB64, sig });
    return { envelope_id: ack?.envelope_id, status: 'sent' };
  } catch (e) {
    gstore.applyEdit(groupId, targetEnvelopeId, before, 'me', { force: true, onlyIfTs: ts });
    throw e;
  }
}

// ────────────────────────────────────────────────────────────
// Process incoming group envelope
// ────────────────────────────────────────────────────────────

async function sendGroupImage__impl({
  groupId, file, caption = '',
  ttlSeconds = 86400,
  seed, myPubkeyHex,
  preEncoded = null, fwd = null,
}) {
  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    throw new Error(t('No group key'));
  }
  const groupKey = crypto.base64ToBytes(group.group_key_b64);

  const compressed = preEncoded?.data_b64 ? preEncoded : await compressImage(file);
  const fw = fwd ? sanitizeFwd(fwd) : null;
  const payload = wrapGroupPayload('image', {
    ...(fw ? { fwd: fw } : {}),
    data_b64: compressed.data_b64,
    mime: compressed.mime,
    w: compressed.w,
    h: compressed.h,
    caption: caption || '',
  });
  const blobB64 = crypto.encryptStringWithKey(groupKey, payload);

  const ts = nowSeconds();
  const sig = crypto.signEnvelope({
    seed,
    fromHex: myPubkeyHex,
    toHex: groupId,
    ts,
    ttl: ttlSeconds,
    blobB64,
  });

  const localMsg = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    direction: 'out',
    sender_pubkey: myPubkeyHex,
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
  gstore.appendMessage(groupId, localMsg);

  try {
    const ack = await api.sendGroupMessage(groupId, {
      from: myPubkeyHex,
      to: groupId,
      ts,
      ttl: ttlSeconds,
      blob: blobB64,
      sig,
    });
    gstore.updateMessage(groupId, localMsg.id, {
      envelope_id: ack.envelope_id,
      status: 'sent',
      expires_at: ack.expires_at || (ts + ttlSeconds),
    });
    return { ...localMsg, envelope_id: ack.envelope_id, status: 'sent' };
  } catch (e) {
    gstore.updateMessage(groupId, localMsg.id, {
      status: 'failed', error: e.message,
    });
    throw e;
  }
}

/**
 * Send a voice note to a group. Wraps the recorded blob as
 * {kind:'voice', ...} JSON inside the group payload, encrypts with
 * the group key and broadcasts via the group endpoint.
 */
async function sendGroupVoice__impl({
  groupId, audioBlob, mimeType, durationMs,
  ttlSeconds = 86400,
  seed, myPubkeyHex,
  preEncoded = null, fwd = null,
}) {
  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    throw new Error(t('No group key'));
  }
  const groupKey = crypto.base64ToBytes(group.group_key_b64);

  if (preEncoded?.data_b64) {
    mimeType = preEncoded.mime || mimeType;
    durationMs = preEncoded.duration_ms ?? durationMs;
  }
  const data_b64 = preEncoded?.data_b64 || await blobToBase64(audioBlob);
  const fw = fwd ? sanitizeFwd(fwd) : null;
  const rawSize = Math.floor(data_b64.length * 0.75);
  if (rawSize > 140 * 1024) {
    throw new Error(
      tp("Voice message too large ({0}KB). Record a shorter one.", [Math.round(rawSize / 1024)]),
    );
  }

  const payload = wrapGroupPayload('voice', {
    ...(fw ? { fwd: fw } : {}),
    data_b64,
    mime: mimeType || 'audio/webm',
    duration_ms: Math.max(0, Math.floor(durationMs || 0)),
  });
  const blobB64 = crypto.encryptStringWithKey(groupKey, payload);

  const ts = nowSeconds();
  const sig = crypto.signEnvelope({
    seed,
    fromHex: myPubkeyHex,
    toHex: groupId,
    ts,
    ttl: ttlSeconds,
    blobB64,
  });

  const localMsg = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    direction: 'out',
    sender_pubkey: myPubkeyHex,
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
  gstore.appendMessage(groupId, localMsg);

  try {
    const ack = await api.sendGroupMessage(groupId, {
      from: myPubkeyHex,
      to: groupId,
      ts,
      ttl: ttlSeconds,
      blob: blobB64,
      sig,
    });
    gstore.updateMessage(groupId, localMsg.id, {
      envelope_id: ack.envelope_id,
      status: 'sent',
      expires_at: ack.expires_at || (ts + ttlSeconds),
    });
    return { ...localMsg, envelope_id: ack.envelope_id, status: 'sent' };
  } catch (e) {
    gstore.updateMessage(groupId, localMsg.id, {
      status: 'failed', error: e.message,
    });
    throw e;
  }
}

/**
 * Send a reaction (or remove one) to a group message.
 *
 * Same model as sendDMReaction — wrapped as kind:'reaction' payload,
 * encrypted with the group key, broadcast via the group endpoint. Not
 * stored as a regular history entry on the sender side; the target
 * message's reactions get updated optimistically before send.
 */
async function sendGroupReaction__impl({
  groupId, targetEnvelopeId, emoji, op = 'add',
  ttlSeconds = 86400,
  seed, myPubkeyHex,
}) {
  if (!groupId || !targetEnvelopeId) throw new Error('no_target');
  if (op !== 'add' && op !== 'remove') throw new Error('bad_op');
  if (op === 'add' && !gstore.ALLOWED_REACTIONS.includes(emoji)) {
    throw new Error('bad_emoji');
  }

  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    throw new Error(t('No group key'));
  }
  const groupKey = crypto.base64ToBytes(group.group_key_b64);

  // Optimistic local update
  const previous = gstore.getMyGroupReaction(groupId, targetEnvelopeId, myPubkeyHex);
  gstore.applyReaction(groupId, targetEnvelopeId, emoji, op, myPubkeyHex);

  const payload = wrapGroupPayload('reaction', {
    target_envelope_id: targetEnvelopeId,
    emoji: op === 'add' ? emoji : '',
    op,
  });
  const blobB64 = crypto.encryptStringWithKey(groupKey, payload);

  const ts = nowSeconds();
  const sig = crypto.signEnvelope({
    seed,
    fromHex: myPubkeyHex,
    toHex: groupId,
    ts,
    ttl: ttlSeconds,
    blobB64,
  });

  try {
    const ack = await api.sendGroupMessage(groupId, {
      from: myPubkeyHex,
      to: groupId,
      ts,
      ttl: ttlSeconds,
      blob: blobB64,
      sig,
    });
    return { envelope_id: ack.envelope_id, status: 'sent', control: true };
  } catch (e) {
    // Roll back optimistic update
    if (previous) {
      gstore.applyReaction(groupId, targetEnvelopeId, previous, 'add', myPubkeyHex);
    } else {
      gstore.applyReaction(groupId, targetEnvelopeId, emoji, 'remove', myPubkeyHex);
    }
    throw e;
  }
}

let _lastMe = null;
let _epoch = 0;          // росте при зміні акаунта: фонові задачі попереднього зупиняються
const KEY_PROOF_MAX_AGE_S = 14 * 86400;
export async function processIncomingGroupEnvelope({ envMeta, myPubkeyHex, seed = null, epoch = null }) {
  if (epoch === null && myPubkeyHex) _lastMe = myPubkeyHex;
  const envelopeId = envMeta.envelope_id;
  const groupId = envMeta.group_id;
  const senderPubkey = envMeta.from;
  const senderUsername = sanitizeIncomingUsername(envMeta.from_username);

  if (!isGroupId(groupId) || !crypto.isPubkeyHex(senderPubkey)) {
    console.warn('group envelope with malformed group_id or sender, dropped');
    return null;
  }

  if (gstore.hasEnvelope(groupId, envelopeId)) return null;
  // Власні конверти (з іншого мого пристрою) не показуємо — але службовий
  // стан групи з них беремо: інакше другий пристрій адміна жив би зі
  // старим станом і розгалужував його (див. нижче, group_sec).
  const fromMe = senderPubkey === myPubkeyHex;

  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    console.warn('No group_key for group', groupId, '— stashing envelope as stub');
    return null;
  }

  let blobBytes;
  try {
    blobBytes = await api.fetchBlob(envelopeId);
  } catch (e) {
    console.warn('fetchBlob failed for group envelope', envelopeId, e);
    // Той самий контракт, що й у messages.processIncoming: мережевий збій
    // → не ack-ати, конверт лишається в черзі до наступної спроби.
    if (e?.code === 'network') return { __retry: true, envelope_id: envelopeId };
    return null;
  }
  const blobB64 = crypto.bytesToBase64(blobBytes);
  if (epoch !== null && epoch !== _epoch) return null;   // фонова повторна обробка, акаунт уже інший

  // ── Автор повідомлення ──
  // Груповий ключ спільний, тож шифротекст сам по собі не каже, ХТО писав.
  // Але кожен конверт підписаний ключем автора над {from,to=group_id,
  // ts,ttl,blob} (релей це перевіряє при прийомі). Перевіряємо й тут —
  // інакше релей міг приписати будь-яке повідомлення будь-якому учаснику.
  if (envMeta.to !== groupId || !crypto.verifyEnvelope({
    fromHex: senderPubkey, toHex: groupId, ts: envMeta.ts, ttl: envMeta.ttl,
    blobB64, sigHex: envMeta.sig,
  })) {
    console.warn('group envelope signature invalid, dropped');
    return null;
  }
  if (!replay.isFresh(envMeta.ts, envMeta.ttl)) {
    console.warn('group envelope outside its lifetime, dropped');
    return null;
  }
  if (replay.seen(envMeta.sig)) return null;

  // Поточний ключ, потім попередні (після перевипуску в дорозі ще можуть
  // бути повідомлення під старим ключем).
  let plaintext = null;
  let keyIdx = -1;
  const keys = gstore.getGroupKeys(groupId);
  for (let i = 0; i < keys.length; i++) {
    try { plaintext = crypto.decryptStringWithKey(crypto.base64ToBytes(keys[i]), blobB64); keyIdx = i; break; } catch { /* next key */ }
  }
  // Старий ключ знає й видалений учасник — від нього під старим ключем не приймаємо.
  if (plaintext !== null && keyIdx > 0 && removedSet(groupId).has(senderPubkey)) {
    console.warn('group message under a retired key from a removed member — dropped');
    replay.remember(envMeta.sig);
    return null;
  }
  if (plaintext === null) {
    // Жоден ключ не підійшов. Найімовірніше, адмін перевипустив ключ, а
    // мій примірник ще не дійшов. Якщо автор — відомий учасник і конверт
    // свіжий, просимо ключ і НЕ ack-аємо: конверт повториться, коли ключ
    // прийде (до 24 год).
    const age = nowSeconds() - (Number(envMeta.ts) || 0);
    if (fromMe) return null;
    if (isTrustedSender(group, senderPubkey) && age < 86400) {
      rememberDeferred(groupId, envMeta);
      requestFreshKey({ groupId, seed, myPubkeyHex }).catch(() => {});
      return { __retry: true, envelope_id: envelopeId };
    }
    replay.remember(envMeta.sig);
    console.warn('Group decrypt failed with all known keys');
    const stub = {
      id: `recv-${envelopeId.slice(0, 16)}`,
      envelope_id: envelopeId,
      direction: 'in',
      sender_pubkey: senderPubkey,
      sender_username: senderUsername,
      text: null,
      ts: envMeta.ts || nowSeconds(),
      ttl: envMeta.ttl,
      expires_at: envMeta.expires_at,
      status: 'undecryptable',
      error: 'Couldn\'t decrypt',
    };
    gstore.appendMessage(groupId, stub);
    return stub;
  }
  replay.remember(envMeta.sig);

  const payload = parseGroupPayload(plaintext);
  if (fromMe && payload?.kind !== 'group_sec') return null;
  if (!payload) {
    console.warn('group payload not JSON / no kind');
    return null;
  }

  // ── Стан захисту групи (див. group_sec.js) — службове, не повідомлення ──
  if (payload.kind === 'group_sec') {
    // Повний стан, підписаний адміном і прив'язаний до ключа групи.
    // Переслати його може будь-хто — важить лише підпис і новіший seq.
    let pin = gstore.getGroupField(groupId, 'admin_pin');
    if (!pin && crypto.isPubkeyHex(group.creator_pubkey_hex)) {
      pin = group.creator_pubkey_hex;   // легасі: TOFU на творця від релею
      gstore.setGroupField(groupId, 'admin_pin', pin);
    }
    const st = gsec.verifySigned(payload.signed, { groupId, groupKeyB64: group.group_key_b64, adminPin: pin });
    const cur = gstore.getGroupSec(groupId);
    if (st && (!cur || st.seq > (cur.state?.seq || 0))) {
      applyNewerState(groupId, st, payload.signed.sig);
    }
    return null;
  }

  if (payload.kind === 'edit') {
    // Правка: лише повідомлення ЦЬОГО ж автора (підписаний конверт).
    const ed = parseEdit(payload, Number(envMeta.ts));
    if (ed && gstore.applyEdit(groupId, ed.target, ed, senderPubkey)) return { __update: true, group_id: groupId };
    return null;
  }

  if (payload.kind === 'group_msg') {
    const msg = {
      id: `recv-${envelopeId.slice(0, 16)}`,
      envelope_id: envelopeId,
      direction: 'in',
      sender_pubkey: senderPubkey,
      sender_username: senderUsername,
      text: typeof payload.text === 'string' ? payload.text : '',
      ts: envMeta.ts || nowSeconds(),
      ttl: envMeta.ttl,
      expires_at: envMeta.expires_at,
      status: 'received',
    };
    const reply = sanitizeReplyTo(payload.reply_to);
    if (reply) msg.reply_to = reply;
    const gf = sanitizeFwd(payload.fwd);
    if (gf) msg.fwd = gf;
    gstore.appendMessage(groupId, msg);
    return msg;
  }

  if (payload.kind === 'image') {
    const msg = {
      id: `recv-${envelopeId.slice(0, 16)}`,
      envelope_id: envelopeId,
      direction: 'in',
      sender_pubkey: senderPubkey,
      sender_username: senderUsername,
      text: payload.caption || '',
      image: {
        data_b64: payload.data_b64,
        mime: payload.mime || 'image/jpeg',
        w: payload.w,
        h: payload.h,
      },
      ts: envMeta.ts || nowSeconds(),
      ttl: envMeta.ttl,
      expires_at: envMeta.expires_at,
      status: 'received',
    };
    const gf = sanitizeFwd(payload.fwd);
    if (gf) msg.fwd = gf;
    gstore.appendMessage(groupId, msg);
    return msg;
  }

  if (payload.kind === 'voice') {
    const msg = {
      id: `recv-${envelopeId.slice(0, 16)}`,
      envelope_id: envelopeId,
      direction: 'in',
      sender_pubkey: senderPubkey,
      sender_username: senderUsername,
      text: '',
      voice: {
        data_b64: payload.data_b64,
        mime: payload.mime || 'audio/webm',
        duration_ms: payload.duration_ms || 0,
      },
      ts: envMeta.ts || nowSeconds(),
      ttl: envMeta.ttl,
      expires_at: envMeta.expires_at,
      status: 'received',
    };
    const gf = sanitizeFwd(payload.fwd);
    if (gf) msg.fwd = gf;
    gstore.appendMessage(groupId, msg);
    return msg;
  }

  if (payload.kind === 'reaction') {
    const target = payload.target_envelope_id;
    const op = payload.op === 'remove' ? 'remove' : 'add';
    const emoji = typeof payload.emoji === 'string' ? payload.emoji : '';
    if (target) {
      // Whitelist + per-user dedupe enforced inside applyReaction
      gstore.applyReaction(groupId, target, emoji, op, senderPubkey);
    }
    return null;
  }

  console.warn('unknown group payload kind:', payload.kind);
  return null;
}

// ────────────────────────────────────────────────────────────
// Join / leave / delete
// ────────────────────────────────────────────────────────────

/**
 * Join a group via invite token, then auto-request the group_key from
 * existing members. Any member who has the key will reply with a
 * group_key DM, which our messages.js dispatcher will pick up
 * automatically.
 *
 * UI sees: tap link → wait 1-2 seconds → group with name appears.
 * No further action needed from the joining user or from the admin.
 */
let _joinsInProgress = 0;

async function joinViaToken__impl({ token, inviteSeedHex = null, adminPk = null, seed, myPubkeyHex }) {
  // Поки приєднання в процесі, ключі для ще невідомих груп відкладаємо
  // (processIncomingGroupKey → __retry): інакше ключ від підставного
  // «учасника» встиг би прийти раніше, ніж ми запам'ятаємо адміна з посилання.
  _joinsInProgress += 1;
  let result;
  try {
    result = await api.joinGroupViaToken(token);
    // Заглушка групи + адмін із посилання — СИНХРОННО, одразу після
    // відповіді релею, без жодного await між ними.
    gstore.upsertGroup({
      group_id: result.group_id,
      name: null,
      member_count: result.member_count,
    });
    if (gsec.isHex64(adminPk)) gstore.setGroupField(result.group_id, 'join_admin', adminPk.toLowerCase());
  } finally {
    _joinsInProgress -= 1;
  }

  // Now fetch the member list and DM key request to all other members.
  // This works whether the admin is online or not — any member with the
  // key will reply.
  try {
    const info = await api.getGroupInfo(result.group_id);
    gstore.upsertGroup({
      group_id: info.group_id,
      name: null,
      creator_pubkey_hex: info.creator_pubkey_hex,
      is_channel: info.is_channel,
      default_ttl_seconds: info.default_ttl_seconds,
      max_members: info.max_members,
      member_count: info.member_count,
      members: info.members,
    });

    const others = (info.members || []).filter(
      (m) => m.pubkey_hex !== myPubkeyHex,
    );
    // DM the request to everyone in parallel — first to respond wins.
    await Promise.all(others.map(async (m) => {
      try {
        await sendGroupKeyRequestDM({
          seed, myPubkeyHex,
          peerPubkeyHex: m.pubkey_hex,
          groupId: result.group_id,
          inviteSeedHex,
        });
      } catch (e) {
        console.warn('group_key_request DM to', m.pubkey_hex.slice(0, 8), 'failed:', e?.message);
      }
    }));
  } catch (e) {
    console.warn('Could not fetch group info after join:', e?.message);
  }

  return result;
}

export async function leaveGroup(groupId, myPubkeyHex) {
  await api.removeGroupMember(groupId, myPubkeyHex);
  gstore.removeGroup(groupId);
}

export async function deleteGroupCompletely(groupId, seed = null) {
  await api.deleteGroup(groupId, seed);
  gstore.removeGroup(groupId);
}

export async function refreshGroup(groupId) {
  const info = await api.getGroupInfo(groupId);
  const existing = gstore.getGroup(groupId);
  gstore.upsertGroup({
    group_id: info.group_id,
    name: existing?.name ?? null,
    creator_pubkey_hex: info.creator_pubkey_hex,
    is_channel: info.is_channel,
    default_ttl_seconds: info.default_ttl_seconds,
    max_members: info.max_members,
    member_count: info.member_count,
    members: info.members,
    group_key_b64: existing?.group_key_b64,
  });
  return gstore.getGroup(groupId);
}

export async function addMemberAndSendKey({
  groupId, newPubkeyHex,
  seed, myPubkeyHex,
}) {
  const group = gstore.getGroup(groupId);
  if (!group || !group.group_key_b64) {
    throw new Error(t('No group key'));
  }
  await api.addGroupMember(groupId, newPubkeyHex);
  // Я адмін захищеної групи → довіряю новому учаснику й кажу про це всім
  // (до відправки ключа — щоб у його копії стану він уже був довіреним).
  if (gstore.getGroupSec(groupId)?.state?.admin === myPubkeyHex) {
    await broadcastSecUpdate({ groupId, update: { add: [newPubkeyHex] }, seed, myPubkeyHex }).catch(() => {});
  }
  await sendGroupKeyDM({
    seed, myPubkeyHex,
    peerPubkeyHex: newPubkeyHex,
    groupId,
    groupKeyB64: group.group_key_b64,
    name: group.name || '',
  });
  return await refreshGroup(groupId);
}

export { parseGroupPayload };

/**
 * Службовий груповий конверт (не з'являється в чаті). Зашифрований ключем
 * групи й підписаний мною — релей не може ні прочитати, ні підробити.
 */
async function sendGroupControl({ groupId, payloadObj, seed, myPubkeyHex, ttlSeconds = 86400 }) {
  const group = gstore.getGroup(groupId);
  if (!group?.group_key_b64) throw new Error(t('No group key'));
  const groupKey = crypto.base64ToBytes(group.group_key_b64);
  const blobB64 = crypto.encryptStringWithKey(groupKey, wrapGroupPayload(payloadObj.kind, payloadObj.data));
  const ts = nowSeconds();
  const sig = crypto.signEnvelope({ seed, fromHex: myPubkeyHex, toHex: groupId, ts, ttl: ttlSeconds, blobB64 });
  return api.sendGroupMessage(groupId, { from: myPubkeyHex, to: groupId, ts, ttl: ttlSeconds, blob: blobB64, sig });
}

/** Я адмін: новий підписаний стан → у себе → розіслати учасникам. */
export async function broadcastSecUpdate({ groupId, update, seed, myPubkeyHex, deferBroadcast = false }) {
  // read-modify-write стану — під замком групи: паралельні зміни (запрошення
  // + видалення) інакше дали б два різні стани з однаковим seq.
  const signed = await withAdminLock(groupId, async () => {
    const cur = gstore.getGroupSec(groupId);
    if (!cur || cur.state?.admin !== myPubkeyHex || !seed) throw new Error('not_admin');
    const next = gsec.nextState(cur.state, update);
    if (!next) throw new Error('bad_update');
    const out = gsec.signState(next, seed);
    gstore.setGroupSec(groupId, out);
    if (Array.isArray(update.add) && update.add.length) {
      const back = new Set(update.add.map((x) => String(x).toLowerCase()));
      gstore.setGroupField(groupId, 'removed', [...removedSet(groupId)].filter((pk) => !back.has(pk)));
    }
    return out;
  });
  if (deferBroadcast) { scheduleSecBroadcast(groupId, seed, myPubkeyHex); return signed; }
  await sendGroupControl({ groupId, payloadObj: { kind: 'group_sec', data: { signed } }, seed, myPubkeyHex });
  gstore.setGroupField(groupId, 'sec_bcast', nowSeconds());
  return signed;
}

const SEC_BCAST_DEBOUNCE_MS = 3 * 60 * 1000;
const _secTimers = new Map();
/** Одна розсилка АКТУАЛЬНОГО стану на групу раз на кілька хвилин. */
function scheduleSecBroadcast(groupId, seed, myPubkeyHex) {
  if (_secTimers.has(groupId)) return;
  const epoch = _epoch;
  _secTimers.set(groupId, setTimeout(() => {
    _secTimers.delete(groupId);
    if (epoch !== _epoch) return;                 // акаунт уже інший
    const cur = gstore.getGroupSec(groupId);
    if (!cur || cur.state?.admin !== myPubkeyHex) return;
    inflight.track(() => sendGroupControl({ groupId, payloadObj: { kind: 'group_sec', data: { signed: cur } }, seed, myPubkeyHex }))
      .then(() => gstore.setGroupField(groupId, 'sec_bcast', nowSeconds()))
      .catch(() => {});
  }, SEC_BCAST_DEBOUNCE_MS));
}

const REBROADCAST_S = 12 * 3600;

/**
 * Викликається при відкритті групи.
 *   • Я творець легасі-групи → переводимо в захищений режим. Довірені — я і
 *     ті, від кого в мене є повідомлення, підписані й розшифровані ключем
 *     групи (тобто хто ТОЧНО має ключ). Список релею НЕ беремо: туди могли
 *     дописати чужих.
 *   • Я адмін захищеної групи → час від часу переповторюю стан, щоб його
 *     отримали й ті, хто був офлайн довше за життя конверта.
 */
export async function ensureProtected({ groupId, seed, myPubkeyHex }) {
  const group = gstore.getGroup(groupId);
  if (!group?.group_key_b64 || !seed) return false;
  const pin = group.admin_pin || group.creator_pubkey_hex;
  if (pin !== myPubkeyHex) return false;
  const cur = group.sec;
  try {
    if (!cur) {
      const writers = (group.messages || [])
        .filter((m) => m.direction === 'in' && m.status !== 'undecryptable' && m.sender_pubkey)
        .map((m) => m.sender_pubkey);
      const signed = gsec.signState(gsec.newState({
        groupId, adminPk: myPubkeyHex, groupKeyB64: group.group_key_b64, vouched: writers,
      }), seed);
      gstore.setGroupField(groupId, 'admin_pin', myPubkeyHex);
      gstore.setGroupSec(groupId, signed);
      await sendGroupControl({ groupId, payloadObj: { kind: 'group_sec', data: { signed } }, seed, myPubkeyHex });
      gstore.setGroupField(groupId, 'sec_bcast', nowSeconds());
      return true;
    }
    const pending = gstore.getGroupField(groupId, 'pending_rekey');
    if (cur.state?.admin === myPubkeyHex && Array.isArray(pending) && pending.length) {
      // видалення, після якого перевипуск не встиг (застосунок закрили / збій)
      await rekeyGroup({ groupId, remove: pending, seed, myPubkeyHex });
      return true;
    }
    if (cur.state?.admin === myPubkeyHex && nowSeconds() - (group.sec_bcast || 0) > REBROADCAST_S) {
      await sendGroupControl({ groupId, payloadObj: { kind: 'group_sec', data: { signed: cur } }, seed, myPubkeyHex });
      gstore.setGroupField(groupId, 'sec_bcast', nowSeconds());
    }
  } catch { return false; }
  return true;
}

/**
 * Запрошення в групу. Якщо я адмін захищеної групи — у посилання йдуть
 * приватний ключ запрошення (s) і мій ключ (a), обидва в #фрагменті (релей їх
 * не бачить), а публічний ключ запрошення — у підписаний стан для учасників.
 */
export async function createInvite({ groupId, seed, myPubkeyHex }) {
  const info = await api.createInviteToken(groupId, null);
  const cur = gstore.getGroupSec(groupId);
  if (!cur || cur.state?.admin !== myPubkeyHex || !seed) return { ...info, secret: null, admin: null };
  const inv = gsec.makeInvite();
  const relExp = Number.isInteger(info?.expires_at) ? info.expires_at : 0;
  const exp = relExp > nowSeconds() ? relExp : nowSeconds() + gsec.DEFAULT_INVITE_TTL_S;
  await broadcastSecUpdate({ groupId, update: { invite: { pk: inv.pk, exp } }, seed, myPubkeyHex });
  return { ...info, secret: inv.seedHex, admin: myPubkeyHex };
}

/**
 * Я адмін і прибрав учасника → перевипускаю ключ групи (видалений більше
 * не прочитає нових повідомлень) і прибираю його з довірених у всіх.
 * Повертає { group, rekeyed }.
 */
export async function removeMember({ groupId, pubkeyHex, seed, myPubkeyHex }) {
  const pk = String(pubkeyHex).toLowerCase();
  await api.removeGroupMember(groupId, pk);
  const local = gstore.getGroupField(groupId, 'vouched_local') || [];
  if (local.includes(pk)) gstore.setGroupField(groupId, 'vouched_local', local.filter((x) => x !== pk));
  addRemoved(groupId, [pk]);
  let rekeyed = false;
  if (seed) {
    // легасі-група, де я творець, — спершу захищаємо (інакше нема чим підписати перевипуск)
    if (!gstore.getGroupSec(groupId)) await ensureProtected({ groupId, seed, myPubkeyHex });
    if (gstore.getGroupSec(groupId)?.state?.admin === myPubkeyHex) {
      // позначка на випадок, якщо застосунок закриють до кінця перевипуску
      const pend = gstore.getGroupField(groupId, 'pending_rekey') || [];
      gstore.setGroupField(groupId, 'pending_rekey', [...new Set([...pend, pk])]);
      try {
        await rekeyGroup({ groupId, remove: [pk], seed, myPubkeyHex });
        rekeyed = true;
      } catch (e) {
        console.warn('rekey failed, will retry when the group is opened:', e?.message);
        await broadcastSecUpdate({ groupId, update: { remove: [pk] }, seed, myPubkeyHex }).catch(() => {});
      }
    }
  }
  const group = await refreshGroup(groupId).catch(() => gstore.getGroup(groupId));
  return { group, rekeyed };
}

const REKEY_BURST = 25;          // скільки ключів шлемо одразу
const REKEY_PACE_MS = 2000;      // далі — 30/хв: разом із першою пачкою вкладаємось у ліміт релею (60/хв)

/**
 * Перевипуск ключа групи (я адмін). Новий ключ + стан із kh нового ключа
 * (seq+1), підписаний мною → у себе → кожному учаснику окремим E2EE-DM.
 *
 * Кому шлемо: лише тим, кого довірено в ПІДПИСАНОМУ стані (і хто ще є в
 * групі за релеєм). «Писав у групу» тут не рахується: старий ключ знає й
 * видалений. Хто не отримав (був офлайн довше за життя DM, «мовчазний»
 * учасник, допущений іншим учасником), попросить ключ сам і доведе, що мав
 * попередній, — див. requestFreshKey і processIncomingGroupKeyRequest.
 * Відкриті запрошення анулюються: секрет із посилання міг бути й у видаленого.
 */
export async function rekeyGroup({ groupId, remove = [], seed, myPubkeyHex }) {
  if (!seed) throw new Error('not_admin');
  let relayMembers = null;
  try {
    const info = await api.getGroupInfo(groupId);
    if (Array.isArray(info?.members)) relayMembers = info.members.map((m) => m?.pubkey_hex);
  } catch { /* беремо локальний список */ }

  const out = await withAdminLock(groupId, async () => {
    const group = gstore.getGroup(groupId);
    const cur = group?.sec;           // перечитуємо ПІСЛЯ await — під замком
    if (!group?.group_key_b64 || !cur || cur.state?.admin !== myPubkeyHex) throw new Error('not_admin');
    const relay = new Set(relayMembers || (group.members || []).map((m) => m?.pubkey_hex));
    const removed = new Set([...remove.map((x) => String(x).toLowerCase()), ...removedSet(groupId)]);
    const recipients = (cur.state.vouched || []).filter((pk) => crypto.isPubkeyHex(pk)
      && pk !== myPubkeyHex && !removed.has(pk) && relay.has(pk));

    const newKeyB64 = crypto.bytesToBase64(crypto.generateSymmetricKey());
    const next = gsec.nextState(cur.state, {
      remove: [...removed].filter((pk) => (cur.state.vouched || []).includes(pk)),
      revoke: (cur.state.invites || []).map((i) => i.pk),
      kh: gsec.keyHash(newKeyB64),
    });
    if (!next) throw new Error('bad_update');
    const signed = gsec.signState(next, seed);
    // Спершу в себе (ключ + стан), потім розсилка — щоб мої нові
    // повідомлення вже йшли під новим ключем.
    gstore.rotateGroupKey(groupId, newKeyB64);
    gstore.setGroupSec(groupId, signed);
    gstore.setGroupField(groupId, 'sec_bcast', nowSeconds());
    gstore.setGroupField(groupId, 'vouched_local', []);
    return { newKeyB64, recipients, name: group.name || '' };
  });
  {
    const done = new Set(remove.map((x) => String(x).toLowerCase()));
    const left = (gstore.getGroupField(groupId, 'pending_rekey') || []).filter((pk) => !done.has(pk));
    gstore.setGroupField(groupId, 'pending_rekey', left.length ? left : null);
  }

  const send = (pk) => sendGroupKeyDM({ seed, myPubkeyHex, peerPubkeyHex: pk, groupId, groupKeyB64: out.newKeyB64, name: out.name });
  // мені самому — для інших моїх пристроїв (веб/телефон того ж акаунта)
  const all = [myPubkeyHex, ...out.recipients];
  const first = all.slice(0, REKEY_BURST);
  const rest = all.slice(REKEY_BURST);
  const res = await Promise.allSettled(first.map(send));
  if (rest.length) {
    // великі групи: решту — у фоні, з паузами (ліміт релею на відправку)
    const epoch = _epoch;
    (async () => {
      for (const pk of rest) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, REKEY_PACE_MS));
        if (epoch !== _epoch) return;            // акаунт перемкнули — зупиняємось
        // eslint-disable-next-line no-await-in-loop
        await inflight.track(() => send(pk)).catch(() => {});
      }
    })();
  }
  return { sent: res.slice(1).filter((r) => r.status === 'fulfilled').length, total: out.recipients.length };
}

// ── Службове: замок адміна, видалені, нові стани, відкладені конверти ──

const _adminLocks = new Map();
/** Послідовне виконання змін стану однієї групи (у межах цього пристрою). */
function withAdminLock(groupId, fn) {
  const prev = _adminLocks.get(groupId) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  _adminLocks.set(groupId, tail);
  tail.then(() => { if (_adminLocks.get(groupId) === tail) _adminLocks.delete(groupId); });
  return run;
}

/** Кого прибрано з групи: моїми діями (адмін) або видно зі змін підписаного стану. */
function removedSet(groupId) {
  return new Set(gstore.getGroupField(groupId, 'removed') || []);
}
function addRemoved(groupId, pks) {
  if (!pks.length) return;
  const cur = gstore.getGroupField(groupId, 'removed') || [];
  gstore.setGroupField(groupId, 'removed', [...new Set([...cur, ...pks])].slice(-1000));
}

/**
 * Прийняти новіший підписаний стан: зберегти, запам'ятати, кого з нього
 * прибрали, і прибрати їх із моїх локальних допусків. При перевипуску ключа
 * локальні допуски скидаються зовсім: хто легітимний, доведе адміну, що мав
 * попередній ключ, і потрапить у підписаний стан.
 */
function applyNewerState(groupId, st, sig, { rotated = false } = {}) {
  const prev = gstore.getGroupSec(groupId)?.state;
  gstore.setGroupSec(groupId, { state: st, sig: String(sig).toLowerCase() });
  if (prev && Array.isArray(prev.vouched)) {
    const now = new Set(st.vouched || []);
    const gone = prev.vouched.filter((pk) => !now.has(pk));
    addRemoved(groupId, gone);
    if (gone.length) {
      const local = gstore.getGroupField(groupId, 'vouched_local') || [];
      gstore.setGroupField(groupId, 'vouched_local', local.filter((pk) => !gone.includes(pk)));
    }
  }
  // повернутий адміном (знову довірений) — більше не «видалений»
  const back = (st.vouched || []).filter((pk) => removedSet(groupId).has(pk));
  if (back.length) gstore.setGroupField(groupId, 'removed', [...removedSet(groupId)].filter((pk) => !back.includes(pk)));
  if (rotated) gstore.setGroupField(groupId, 'vouched_local', []);
  notifyGroupUpdated(groupId);
}

/** Відправник, заради якого варто чекати ключ (а не дрібниця від будь-кого зі списку релею). */
function isTrustedSender(group, pk) {
  if (!crypto.isPubkeyHex(pk)) return false;
  if (group.admin_pin === pk) return true;
  if (group.sec?.state) return (group.sec.state.vouched || []).includes(pk);
  return (group.members || []).some((m) => m?.pubkey_hex === pk);
}

// Конверти, відкладені до приходу ключа (лише в пам'яті). Коли ключ
// приходить, обробляємо їх одразу — не чекаючи наступного перепідключення.
const _deferred = new Map();   // groupId → Map(envelope_id → envMeta)
function rememberDeferred(groupId, envMeta) {
  let m = _deferred.get(groupId);
  if (!m) { m = new Map(); _deferred.set(groupId, m); }
  m.set(envMeta.envelope_id, envMeta);
  while (m.size > 200) m.delete(m.keys().next().value);
}
function reprocessDeferred(groupId) {
  const m = _deferred.get(groupId);
  if (!m || !m.size) return;
  _deferred.delete(groupId);
  const epoch = _epoch;
  const me = _lastMe;
  // inflight: перемикання акаунта дочекається цього циклу (інакше запис
  // міг би потрапити в сховище іншого акаунта)
  inflight.track(async () => {
    for (const env of m.values()) {
      if (epoch !== _epoch) return;
      // eslint-disable-next-line no-await-in-loop
      await processIncomingGroupEnvelope({ envMeta: env, myPubkeyHex: me, epoch }).catch(() => {});
    }
    if (epoch === _epoch) notifyGroupUpdated(groupId);
  }).catch(() => {});
}

const _groupListeners = new Set();
/** Підписка на «група змінилась поза звичайним потоком повідомлень». */
export function subscribeGroupUpdates(fn) { _groupListeners.add(fn); return () => _groupListeners.delete(fn); }
function notifyGroupUpdated(groupId) {
  for (const fn of _groupListeners) { try { fn(groupId); } catch { /* ignore */ } }
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('morok-group-update', { detail: { groupId } }));
    }
  } catch { /* ignore */ }
}

const KEY_REQ_INTERVAL_S = 30 * 60;
const _keyReqInFlight = new Set();

/**
 * Мені бракує актуального ключа групи (прийшло від довіреного те, що жоден
 * мій ключ не розшифровує). Просимо адміна й кількох довірених учасників —
 * не частіше ніж раз на 30 хв для групи. Адміну додаємо доказ, що я мав
 * попередній ключ (якщо я ще не в підписаному стані). Відповідь
 * приймається лише з підписаним адміном перевипуском.
 */
export async function requestFreshKey({ groupId, seed, myPubkeyHex }) {
  if (!seed || !myPubkeyHex || _keyReqInFlight.has(groupId)) return false;
  const group = gstore.getGroup(groupId);
  if (!group) return false;
  if (nowSeconds() - (group.key_req_at || 0) < KEY_REQ_INTERVAL_S) return false;
  _keyReqInFlight.add(groupId);
  try {
    gstore.setGroupField(groupId, 'key_req_at', nowSeconds());
    const relay = new Set((group.members || []).map((m) => m?.pubkey_hex));
    const pin = group.admin_pin;
    const vouched = (group.sec?.state?.vouched || []).filter((pk) => pk !== pin && pk !== myPubkeyHex && relay.has(pk));
    // випадкові 4 довірені, щоб не навантажувати завжди тих самих
    for (let i = vouched.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [vouched[i], vouched[j]] = [vouched[j], vouched[i]]; }
    const targets = [...new Set([pin, ...vouched.slice(0, 4)])].filter((pk) => crypto.isPubkeyHex(pk) && pk !== myPubkeyHex);
    await Promise.allSettled(targets.map((pk) => sendGroupKeyRequestDM({
      seed, myPubkeyHex, peerPubkeyHex: pk, groupId,
      keyProofB64: pk === pin ? group.group_key_b64 : null,
    })));
    return targets.length > 0;
  } finally {
    _keyReqInFlight.delete(groupId);
  }
}

/**
 * Чи означає помилка від релея, що групи більше не існує (видалена
 * адміном) або нас із неї прибрали. У такому разі локальну копію
 * треба знести — інакше "мертва" група висить у списку чатів вічно.
 */
export function isGroupGoneError(e) {
  return !!e && (e.status === 404 || e.status === 403);
}

/**
 * Фонова валідація всіх локальних груп проти релея. Видаляє ті,
 * яких на релеї вже немає. Викликається зі списку чатів (fire &
 * forget). Повертає true якщо щось видалили (треба перемалювати UI).
 *
 * Не частіше ніж раз на VALIDATE_INTERVAL_MS, щоб не довбати relay
 * GET-ами при кожному рендері списку.
 */
let _lastValidateTs = 0;
/** Скинути тротлінг перевірки груп (після зміни акаунта на пристрої). */
export function resetValidateThrottle() {
  _lastValidateTs = 0;
  _epoch += 1;
  for (const t of _secTimers.values()) clearTimeout(t);
  _secTimers.clear();
  // стан у пам'яті, прив'язаний до попереднього акаунта
  _deferred.clear();
  _keyReqInFlight.clear();
  _lastMe = null;
}
const VALIDATE_INTERVAL_MS = 20 * 1000;

export async function validateGroupsAgainstRelay() {
  const now = Date.now();
  if (now - _lastValidateTs < VALIDATE_INTERVAL_MS) return false;
  _lastValidateTs = now;

  const groups = gstore.listGroups ? gstore.listGroups() : [];
  let removedAny = false;
  await Promise.allSettled(groups.map(async (g) => {
    // Залишки підкинутих раніше «груп» з некоректним id (до фіксу
    // api.seg) — прибираємо одразу, без запитів до релею.
    if (!isGroupId(g.group_id)) {
      gstore.removeGroup(g.group_id);
      removedAny = true;
      return;
    }
    try {
      await api.getGroupInfo(g.group_id);
    } catch (e) {
      if (isGroupGoneError(e)) {
        gstore.removeGroup(g.group_id);
        removedAny = true;
      }
      // Мережеві/інші помилки ігноруємо — не видаляємо групу через
      // відсутність інтернету.
    }
  }));
  return removedAny;
}

export const sendGroupMessage = (...args) => inflight.track(() => sendGroupMessage__impl(...args));
export const sendGroupImage = (...args) => inflight.track(() => sendGroupImage__impl(...args));
export const sendGroupVoice = (...args) => inflight.track(() => sendGroupVoice__impl(...args));
export const sendGroupReaction = (...args) => inflight.track(() => sendGroupReaction__impl(...args));
export const sendGroupEdit = (...args) => inflight.track(() => sendGroupEdit__impl(...args));
export const createGroup = (...args) => inflight.track(() => createGroup__impl(...args));
export const joinViaToken = (...args) => inflight.track(() => joinViaToken__impl(...args));
