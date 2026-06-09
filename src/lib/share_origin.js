/**
 * Канонічний origin для share-лінків (QR, запрошення в групи, burner).
 *
 * У нативному застосунку (Capacitor) window.location.origin =
 * "https://localhost" — такі лінки нікому не відкриються. Тому в
 * нативі беремо поточний relay користувача (relay1.morok.app тощо),
 * а у вебі — як і раніше, origin сторінки.
 */
import { getRelayUrl } from './api.js';

export function shareOrigin() {
  const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
  if (!origin || /^https?:\/\/localhost/.test(origin) || origin.startsWith('capacitor://')) {
    return getRelayUrl().replace(/\/+$/, '');
  }
  return origin;
}
