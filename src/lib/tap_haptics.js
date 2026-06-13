/*
 * Глобальний тактильний відгук на тапи.
 *
 * Замість розставляння hapticLight() по сотні onClick у кожному екрані —
 * один делегований listener на document. На pointerdown по будь-якому
 * інтерактивному елементі (кнопка, рядок, таб, посилання) даємо легкий
 * "тук". pointerdown, а не click — щоб відгук був МИТТЄВИЙ, під пальцем,
 * до навігації. Це і є відчуття "живого" нативного інтерфейсу.
 *
 * No-op у вебі (hapticLight сам перевіряє Capacitor). Listener пасивний,
 * не блокує скрол.
 */
import { hapticLight } from './haptics.js';

const INTERACTIVE_SELECTOR = [
  '.lin-chat-row',
  '.btn',
  '.tab',
  '.topbar .back',
  '[role="button"]',
  'button',
  'a[href]',
].join(',');

let installed = false;

export function installTapHaptics() {
  if (installed) return;
  installed = true;

  document.addEventListener(
    'pointerdown',
    (e) => {
      // Тільки реальний дотик пальцем — миша/трекпад на десктопі не
      // мають вібрувати (та й Capacitor там no-op, але економимо виклики).
      if (e.pointerType !== 'touch') return;
      const el = e.target?.closest?.(INTERACTIVE_SELECTOR);
      if (!el) return;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      hapticLight();
    },
    { passive: true },
  );
}
