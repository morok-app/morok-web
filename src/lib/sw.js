/* Morok Service Worker — handles web push notifications. */

const APP_URL = '/web/';

self.addEventListener('install', () => {
  // Activate immediately on first install / new SW
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of any clients without reload
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (_) {
    data = {};
  }

  const from = data.from_username || null;
  const isGroup = !!data.group_id;
  const isMail = data.kind === 'mail';
  const title = 'Morok';
  const body = isMail
    ? 'Новий лист · morok.email'
    : from
      ? (isGroup ? `@${from} у групі` : `Нове повідомлення від @${from}`)
      : (isGroup ? 'Нове повідомлення у групі' : 'Нове повідомлення');

  event.waitUntil((async () => {
    // If any tab is currently focused, the user is reading right now —
    // skip the OS notification, the live UI will surface it.
    const clientList = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true,
    });
    const focused = clientList.some((c) => c.focused);
    if (focused) return;

    await self.registration.showNotification(title, {
      body,
      tag: isMail ? 'mail' : (data.group_id ? `group-${data.group_id}` : 'dm'),
      renotify: false,
      requireInteraction: false,
      data: {
        group_id: data.group_id || null,
        url: APP_URL,
      },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || APP_URL;

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window' });
    for (const client of clientList) {
      if (client.url.includes('/web/')) {
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
