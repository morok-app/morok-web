import { useEffect, useRef, useState } from 'react';

/*
 * ScreenTransition — slide-перехід між екранами.
 *
 * Тримає в DOM ДВА шари під час анімації: екран, що йде (outgoing), і
 * екран, що заходить (incoming). Після завершення анімації outgoing
 * прибирається. Напрямок ('forward'|'back'|'none') керує тим, з якого
 * боку в'їжджає новий і куди з'їжджає старий.
 *
 * `routeKey` — унікальний ключ поточного екрана (повний hash). Коли він
 * змінюється — запускаємо перехід. children — вже відрендерений екран
 * для поточного routeKey.
 *
 * Без зовнішніх залежностей: два абсолютно спозиційовані шари + CSS
 * transition на transform. prefers-reduced-motion вимикає рух (миттєва
 * заміна), що поважає системне налаштування доступності.
 */
export default function ScreenTransition({ routeKey, direction, children }) {
  const [current, setCurrent] = useState({ key: routeKey, node: children });
  const [prev, setPrev] = useState(null);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'enter'
  const reduceMotion = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (routeKey === current.key) {
      // Той самий екран, оновився лише вміст (напр. новий стан) —
      // підміняємо без анімації.
      setCurrent({ key: routeKey, node: children });
      return;
    }

    if (reduceMotion.current || direction === 'none') {
      // Без руху: cross-fade лишимо тільки для 'none' (домашні екрани),
      // reduced-motion — миттєво.
      if (direction === 'none' && !reduceMotion.current) {
        setPrev({ ...current, fading: true });
        setCurrent({ key: routeKey, node: children });
        const t = setTimeout(() => setPrev(null), 200);
        return () => clearTimeout(t);
      }
      setPrev(null);
      setCurrent({ key: routeKey, node: children });
      return;
    }

    // Slide-перехід: старий екран стає prev, новий — current,
    // на наступний кадр вмикаємо 'enter' (CSS зробить рух).
    setPrev(current);
    setCurrent({ key: routeKey, node: children });
    setPhase('enter');

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase('idle'));
    });
    const cleanup = setTimeout(() => setPrev(null), 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(cleanup);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, children]);

  const fwd = direction === 'forward';

  // Стартова трансформація нового екрана (звідки він в'їжджає).
  const enterFrom = fwd ? 'translateX(100%)' : 'translateX(-28%)';
  // Кінцева трансформація старого екрана (куди він з'їжджає).
  const exitTo = fwd ? 'translateX(-28%)' : 'translateX(100%)';

  const layerBase = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    willChange: 'transform',
    background: 'var(--bg)',
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {prev && (
        <div
          key={`prev-${prev.key}`}
          style={{
            ...layerBase,
            zIndex: fwd ? 1 : 3,
            transform: prev.fading ? 'none' : (phase === 'enter' ? 'translateX(0)' : exitTo),
            opacity: prev.fading ? 0 : 1,
            transition: prev.fading
              ? 'opacity 0.2s ease'
              : 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
            // Старий екран під час back трохи затемнюємо знизу (як iOS).
            boxShadow: fwd ? 'none' : '0 0 24px rgba(0,0,0,0.4)',
          }}
        >
          {prev.node}
        </div>
      )}
      <div
        key={`cur-${current.key}`}
        style={{
          ...layerBase,
          zIndex: fwd ? 3 : 1,
          transform: phase === 'enter' ? enterFrom : 'translateX(0)',
          transition: phase === 'enter'
            ? 'none'
            : 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
          boxShadow: fwd && prev ? '-8px 0 24px rgba(0,0,0,0.35)' : 'none',
        }}
      >
        {current.node}
      </div>
    </div>
  );
}
