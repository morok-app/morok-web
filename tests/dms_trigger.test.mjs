/**
 * Спрацьований цифровий заповіт не розшифровувався у одержувача.
 *
 * ЩО БУЛО ЗЛАМАНО. Заповіт шифрується статичним ECDH між АВТОРОМ і
 * одержувачем (dms.js → encryptForPeer). Релей, доставляючи його,
 * ставить `from = pubkey релею` — ключа автора в нього немає і не
 * має бути. Клієнт брав `peer = envMeta.from` і рахував
 * ECDH(мій_приват, релей_pub). Ключ не той → AEAD падав → людина
 * бачила «⚠ Не вдалось розшифрувати» в розмові з невідомим ключем.
 * Замість останніх слів — сміття. Функція не працювала НІКОЛИ.
 *
 * Релей тепер віддає `kind: "dms_trigger"` і `dms_creator_pubkey` у
 * метаданих конверта, і клієнт бере автора звідти.
 *
 * ЯК ДОВЕСТИ РЕГРЕСІЮ. Повернути в messages.js resolveIncomingPeer до
 * `envMeta.sender_pubkey_hex || envMeta.from_pubkey || envMeta.from` —
 * впаде і test_dms_envelope_resolves_to_creator, і головний
 * test_payload_decrypts_with_resolved_peer (на `invalid tag`).
 *
 * Запуск: npm test
 * Фреймворка в репо немає — це вбудований node:test, без нових
 * залежностей.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519';

import * as crypto from '../src/lib/crypto.js';
import { resolveIncomingPeer } from '../src/lib/messages.js';

const bytesToHex = (b) => Buffer.from(b).toString('hex');

// Три учасники: автор заповіту, одержувач, релей.
const creatorSeed = new Uint8Array(32).fill(7);
const recipientSeed = new Uint8Array(32).fill(9);
const relaySeed = new Uint8Array(32).fill(3);

const CREATOR = bytesToHex(ed25519.getPublicKey(creatorSeed));
const RECIPIENT = bytesToHex(ed25519.getPublicKey(recipientSeed));
const RELAY = bytesToHex(ed25519.getPublicKey(relaySeed));

const LAST_WORDS = 'Якщо ти це читаєш — мене вже немає. Слова від сейфа: ...';

/** Конверт у тому вигляді, в якому релей віддає спрацьований заповіт. */
function dmsEnvelopeMeta() {
  return {
    envelope_id: 'ab'.repeat(32),
    from: RELAY,              // релей підписує СВОЇМ ключем — інакше не може
    to: RECIPIENT,
    ts: 1785355471,
    ttl: 86400,
    kind: 'dms_trigger',
    dms_creator_pubkey: CREATOR,
    dms_id: 'd7153d6b-9ed4-4784-8b84-ddc32bfc83f5',
  };
}

// ── ГОЛОВНИЙ ТЕСТ ────────────────────────────────────────────────────
test('payload decrypts with the resolved peer, not with the relay key', () => {
  // Автор шифрує так само, як це робить dms.js.
  const blobB64 = crypto.encryptForPeer({
    seed: creatorSeed,
    myPubkeyHex: CREATOR,
    peerPubkeyHex: RECIPIENT,
    plaintext: LAST_WORDS,
  });

  const { peer } = resolveIncomingPeer(dmsEnvelopeMeta());

  // Те, що робить клієнт після фікса — має розшифрувати.
  const opened = crypto.decryptFromPeer({
    seed: recipientSeed,
    myPubkeyHex: RECIPIENT,
    peerPubkeyHex: peer,
    blobB64,
  });
  assert.equal(opened, LAST_WORDS);

  // А те, що робив клієнт ДО фікса (ключ релею) — падає. Це і є та
  // «⚠ Не вдалось розшифрувати», яку бачив одержувач.
  assert.throws(() => crypto.decryptFromPeer({
    seed: recipientSeed,
    myPubkeyHex: RECIPIENT,
    peerPubkeyHex: RELAY,
    blobB64,
  }));
});

test('dms envelope resolves to the creator, not the relay', () => {
  const { peer, isDmsTrigger } = resolveIncomingPeer(dmsEnvelopeMeta());
  assert.equal(isDmsTrigger, true);
  assert.equal(peer, CREATOR);
  assert.notEqual(peer, RELAY);
});

// ── нічого іншого не зламано ─────────────────────────────────────────
test('ordinary DM still resolves to its sender', () => {
  const { peer, isDmsTrigger } = resolveIncomingPeer({
    envelope_id: 'cd'.repeat(32),
    from: CREATOR,
    from_username: 'kaban',
  });
  assert.equal(isDmsTrigger, false);
  assert.equal(peer, CREATOR);
});

test('sender_pubkey_hex still wins over from, as before', () => {
  const { peer } = resolveIncomingPeer({
    sender_pubkey_hex: CREATOR,
    from: RELAY,
  });
  assert.equal(peer, CREATOR);
});

test('envelope with no sender resolves to null', () => {
  const { peer, isDmsTrigger } = resolveIncomingPeer({ envelope_id: 'x' });
  assert.equal(peer, null);
  assert.equal(isDmsTrigger, false);
});

// ── метадані від релею — підказка, не доказ ──────────────────────────
test('kind alone, without a valid creator pubkey, is ignored', () => {
  // Захист від напівзаповненого / підробленого конверта: якщо `kind`
  // є, а pubkey автора кривий або відсутній — поводимось як зі
  // звичайним DM, а не намагаємось щось вигадати.
  for (const bad of [undefined, null, '', 'не-hex', 'ab', CREATOR + 'ff']) {
    const { peer, isDmsTrigger } = resolveIncomingPeer({
      kind: 'dms_trigger',
      dms_creator_pubkey: bad,
      from: RELAY,
    });
    assert.equal(isDmsTrigger, false, `mishandled creator=${bad}`);
    assert.equal(peer, RELAY);
  }
});

test('a lying relay cannot forge the will — wrong creator fails to decrypt', () => {
  // Релей НЕ підписує `dms_creator_pubkey`, тож теоретично може
  // збрехати. Але брехня самоперевірна: ECDH дасть інший спільний
  // ключ і AEAD впаде на автентифікації. Підробити ЗМІСТ заповіту
  // релей не може — лише не доставити його.
  const blobB64 = crypto.encryptForPeer({
    seed: creatorSeed,
    myPubkeyHex: CREATOR,
    peerPubkeyHex: RECIPIENT,
    plaintext: LAST_WORDS,
  });

  const lying = { ...dmsEnvelopeMeta(), dms_creator_pubkey: RELAY };
  const { peer } = resolveIncomingPeer(lying);
  assert.equal(peer, RELAY);

  assert.throws(() => crypto.decryptFromPeer({
    seed: recipientSeed,
    myPubkeyHex: RECIPIENT,
    peerPubkeyHex: peer,
    blobB64,
  }));
});

test('creator pubkey is normalised to lowercase', () => {
  const { peer } = resolveIncomingPeer({
    kind: 'dms_trigger',
    dms_creator_pubkey: CREATOR.toUpperCase(),
    from: RELAY,
  });
  assert.equal(peer, CREATOR);
});
