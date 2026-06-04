/* Morok Service Worker — handles web push notifications. */

const APP_URL = '/web/';

// ── IndexedDB lookup for muted chats ──
// Schema mirror of src/lib/muted.js — keep in sync.
const MUTED_DB = 'morok_muted';
const MUTED_STORE = 'muted';

function openMutedDB() {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(MUTED_DB, 1); }
    catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains(MUTED_STORE)) {
          db.createObjectStore(MUTED_STORE, { keyPath: 'key' });
        }
      } catch { /* swallow */ }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function isChatMuted(chatKey) {
  if (!chatKey) return Promise.resolve(false);
  return new Promise(async (resolve) => {
    const db = await openMutedDB();
    if (!db) { resolve(false); return; }
    try {
      const tx = db.transaction(MUTED_STORE, 'readonly');
      const store = tx.objectStore(MUTED_STORE);
      const req = store.get(chatKey);
      req.onsuccess = () => {
        const e = req.result;
        if (!e) { resolve(false); return; }
        if (e.until === 'forever') { resolve(true); return; }
        resolve(typeof e.until === 'number' && e.until > Date.now());
      };
      req.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}

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
  const title = 'Morok';
  const body = from
    ? (isGroup
        ? `@${from} у групі`
        : `Нове повідомлення від @${from}`)
    : (isGroup ? 'Нове повідомлення у групі' : 'Нове повідомлення');

  // Mute key matches the format used by src/lib/muted.js:
  //   group:<uuid> for groups
  //   dm:<username> for DMs (we don't have peer pubkey in the payload)
  // If from_username is missing on a DM, there's nothing to mute against
  // and we'll just notify — anonymous senders intentionally bypass mute.
  const chatKey = isGroup
    ? `group:${data.group_id}`
    : (from ? `dm:${from}` : null);

  event.waitUntil((async () => {
    // If any tab is currently focused, the user is reading right now —
    // skip the OS notification, the live UI will surface it.
    const clientList = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true,
    });
    const focused = clientList.some((c) => c.focused);
    if (focused) return;

    // Honor the user's per-chat mute setting.
    if (await isChatMuted(chatKey)) return;

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
