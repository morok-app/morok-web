/*
 * Єдиний компонент аватара для всього застосунку.
 *
 * Було: плоский hsl(hue,45%,45%) — тьмяний, "пласкі кружечки 2010-го".
 * Стало: діагональний градієнт із двох відтінків, виведених з pubkey.
 * Колір детермінований (один і той самий юзер завжди має той самий
 * аватар), але тепер це градієнт, а не заливка — миттєво сучасніше,
 * нуль додаткових залежностей.
 *
 * Палітра відтінків підібрана так, щоб лягати на темний фон Morok:
 * насиченість і світлота фіксовані, крутиться лише hue → кольори
 * завжди "свої", ніколи не кислотні й не брудні.
 */

function gradientFor(pubkey, isGroup) {
  if (isGroup) {
    // Групи — фірмовий акцентний градієнт (синій), щоб візуально
    // відрізнятись від різнокольорових особистих аватарів.
    return 'linear-gradient(140deg, #6B8AFE 0%, #4A5FB0 100%)';
  }
  const seed = pubkey ? parseInt(pubkey.slice(0, 6), 16) : 0;
  const hue = seed % 360;
  // Зсув +60° і помітна різниця світлоти (58%→38%) — щоб градієнт читався
  // навіть у "монохромних" діапазонах (зелений/синій), де менший зсув
  // виглядав плоско.
  const h2 = (hue + 60) % 360;
  return `linear-gradient(145deg, hsl(${hue} 62% 58%) 0%, hsl(${h2} 58% 38%) 100%)`;
}

export default function Avatar({ username, pubkey, size = 40, isGroup = false }) {
  const displayName = username || `anon_${pubkey?.slice(0, 8) || ''}`;
  const initial = isGroup ? null : (displayName[0] || '?').toUpperCase();

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: gradientFor(pubkey, isGroup),
        color: '#fff',
        fontWeight: 700,
        fontSize: isGroup ? size * 0.5 : size * 0.42,
        flexShrink: 0,
        // Тонкий внутрішній блік згори — об'єм, як у нативних аватарів iOS.
        boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.22), inset 0 -3px 8px rgba(0,0,0,0.22)',
        // М'яка літера, щоб не "дзвеніла" на градієнті.
        textShadow: isGroup ? 'none' : '0 1px 2px rgba(0,0,0,0.25)',
        userSelect: 'none',
      }}
    >
      {isGroup ? '👥' : initial}
    </div>
  );
}
