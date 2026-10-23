/**
 * alarm_cert.js — сертифікат тривожного ключа (див. morok-rn/lib/alarm.js).
 *
 *   cert = sign(основний ключ, canonicalJson({morok_alarm_cert:'v2', alarm, main, exp}))
 *
 * exp — строк дії (unix-секунди): ключ, скопійований із телефона, не працює
 * вічно; застосунок поновлює сертифікат, коли основний акаунт відкрито.
 *
 * Однаковий файл у morok-rn/lib і morok-web/src/lib (має збігатися).
 */

import { ed25519 } from '@noble/curves/ed25519';
import { canonicalJson, hexToBytes } from './crypto.js';

export const ALARM_CERT_DAYS = 365;
const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

export function alarmCertBytes(alarmPk, mainPk, exp) {
  return canonicalJson({ morok_alarm_cert: 'v2', alarm: alarmPk, main: mainPk, exp });
}

/**
 * Перевірити поле alarm у sealed-повідомленні від `senderPk` (тривожний
 * ключ). Повертає { main, test } або null.
 */
export function verifyAlarm(alarm, senderPk, now = Math.floor(Date.now() / 1000)) {
  try {
    if (!alarm || typeof alarm !== 'object' || Array.isArray(alarm)) return null;
    const main = String(alarm.main || '').toLowerCase();
    const cert = String(alarm.cert || '').toLowerCase();
    const sender = String(senderPk || '').toLowerCase();
    const exp = alarm.exp;
    if (!isHex64(main) || !isHex64(sender) || !/^[0-9a-f]{128}$/.test(cert) || main === sender) return null;
    if (!Number.isInteger(exp) || exp <= now || exp > now + (ALARM_CERT_DAYS + 1) * 86400) return null;
    if (!ed25519.verify(hexToBytes(cert), alarmCertBytes(sender, main, exp), hexToBytes(main))) return null;
    return { main, test: alarm.test === true };
  } catch { return null; }
}
