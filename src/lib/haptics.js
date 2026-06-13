/**
 * Хептика для нативного застосунку. No-op у вебі (тихо ігнорується).
 *
 * Рівні підібрані під контекст:
 *   - hapticLight()   — легкий тап по інтерактивному елементу (рядок, кнопка)
 *   - hapticTap()     — стандартна дія (medium), напр. long-press / шторка
 *   - hapticSuccess() — підтвердження (повідомлення відправлено, дію виконано)
 *   - hapticWarning() — обережна дія / помилка вводу
 *
 * Усі функції безпечні до виклику будь-де: якщо плагіна немає або це
 * веб — нічого не станеться.
 */

async function impact(style) {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle[style] });
  } catch { /* плагін недоступний — тихо ігноруємо */ }
}

async function notify(type) {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType[type] });
  } catch { /* no-op */ }
}

export function hapticLight() { return impact('Light'); }
export function hapticTap() { return impact('Medium'); }
export function hapticSuccess() { return notify('Success'); }
export function hapticWarning() { return notify('Warning'); }
