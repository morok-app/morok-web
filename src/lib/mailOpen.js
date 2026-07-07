// ДОДАТИ у src/lib/crypto.js (поряд із sealedEncrypt/sealedDecrypt).
// Відкриває поштовий конверт формату morok-mail-v1.
// БЕЗ перевірки підпису: автентичність конверта гарантує relay (лист
// формує тільки SMTP-приймач релея, не публічний API). JSON.parse стійкий
// до будь-якого валідного вмісту листа.

const MAIL_INFO = utf8('morok-mail-v1');

export function mailOpen({ seed, blobB64 }) {
  const raw = base64ToBytes(blobB64);
  if (raw.length < 56 + 16) throw new Error('mail blob too short');
  const ephPub = raw.slice(0, 32);
  const nonce = raw.slice(32, 56);
  const ct = raw.slice(56);

  const myX25519Priv = x25519PrivFromSeed(seed);          // вже є в crypto.js
  const shared = x25519.getSharedSecret(myX25519Priv, ephPub);
  const key = hkdf(sha256, shared, ephPub, MAIL_INFO, 32);

  const json = utf8Decode(xchacha20poly1305(key, nonce).decrypt(ct));
  const payload = JSON.parse(json);
  if (payload.kind !== 'email') throw new Error('not an email payload');
  return payload;   // { kind:'email', from, subject, text, html, attachments, spf, ... }
}
