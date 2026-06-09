/**
 * Хептика для нативного застосунку. No-op у вебі.
 * Викликається на long-press (відкриття контекстної шторки) —
 * один короткий "тук" робить відчуття одразу нативним.
 */
export async function hapticTap() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch { /* плагін недоступний — тихо ігноруємо */ }
}
