/*
 * Визначення напрямку навігації для slide-переходів.
 *
 * App.jsx роутить через window.location.hash. Щоб знати, чи екран
 * "заходить" вперед (slide справа) чи це "назад" (slide вліво), ведемо
 * легкий стек відвіданих хешів. Це чисто візуальна підказка — на саму
 * навігацію (hashchange) не впливає.
 *
 * Логіка:
 *   - новий хеш, якого нема в стеку → push (вперед, +1)
 *   - хеш збігається з попереднім у стеку → back (назад, -1)
 *   - корінь (chats/welcome/splash) скидає стек — це "домашні" екрани,
 *     зайшовши на них, історію переходів далі тримати немає сенсу.
 */

const ROOT_ROUTES = new Set(['chats', 'welcome', 'splash']);

let stack = [];

function routeOf(hash) {
  const raw = (hash || '#splash').slice(1);
  return raw.split('?')[0].split('/')[0] || 'splash';
}

/**
 * Викликається на КОЖЕН hashchange ДО рендера.
 * Повертає 'forward' | 'back' | 'none'.
 */
export function resolveDirection(prevHash, nextHash) {
  const nextRoute = routeOf(nextHash);
  const fullNext = (nextHash || '#splash').slice(1);

  // Домашній екран — скидаємо стек, без напрямку (це не «крок назад»,
  // а повернення в корінь; cross-fade приємніший за slide).
  if (ROOT_ROUTES.has(nextRoute)) {
    stack = [fullNext];
    return 'none';
  }

  const idx = stack.lastIndexOf(fullNext);
  if (idx !== -1 && idx < stack.length - 1) {
    // Цей екран уже глибше в стеку → користувач пішов назад.
    stack = stack.slice(0, idx + 1);
    return 'back';
  }

  // Новий екран → крок уперед.
  if (stack[stack.length - 1] !== fullNext) {
    stack.push(fullNext);
  }
  return 'forward';
}

export function resetNavStack() {
  stack = [];
}
