# Створи папку public якщо її ще немає
mkdir public -Force | Out-Null

# Створи sw.js одним блоком
@'
/* Morok Service Worker — handles web push notifications. */

const APP_URL = '/web/';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
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
  const title = 'Morok';
  const body = from
    ? (isGroup
        ? `@${from} у групі`
        : `Нове повідомлення від @${from}`)
    : (isGroup ? 'Нове повідомлення у групі' : 'Нове повідомлення');

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true,
    });
    const focused = clientList.some((c) => c.focused);
    if (focused) return;

    await self.registration.showNotification(title, {
      body,
      tag: data.group_id ? `group-${data.group_id}` : 'dm',
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
'@ | Out-File -FilePath public\sw.js -Encoding UTF8