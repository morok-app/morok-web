/**
 * morok.email — локальна скринька (IndexedDB).
 *
 * Філософія: сервер зберігає НІЧОГО (конверт видаляється після ack) —
 * скринька живе ТІЛЬКИ на пристрої користувача. Це те саме місце
 * зберігання, що й чати (пристрій користувача), лише в IndexedDB,
 * бо листи більші (html, вкладення) і їх з часом багато.
 *
 * Схема БД morok_mail (v1):
 *   store "messages", keyPath "envelope_id"
 *     { envelope_id, ts, read: bool, email: {from, subject, date,
 *       text, html, attachments[], spf, to_alias, received_at} }
 *     індекси: by_ts (ts), by_alias (email.to_alias)
 *
 * Дедуплікація: put з тим самим envelope_id просто перезаписує —
 * повторний catchup того ж конверта не плодить копій.
 *
 * API (усі async):
 *   addEmail({envelopeId, ts, email}) → true якщо НОВИЙ, false якщо дубль
 *   listEmails({limit, beforeTs})     → [msg] новіші перші
 *   getEmail(envelopeId)              → msg | null
 *   markRead(envelopeId, read=true)
 *   removeEmail(envelopeId)
 *   unreadCount()                     → number
 *   clearAll()                        → знести все (використовує wipe акаунта)
 */

const DB_NAME = 'morok_mail';
const DB_VER = 1;
const STORE = 'messages';

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const st = db.createObjectStore(STORE, { keyPath: 'envelope_id' });
        st.createIndex('by_ts', 'ts');
        st.createIndex('by_alias', 'email.to_alias');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { _dbPromise = null; reject(req.error); };
  });
  return _dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addEmail({ envelopeId, ts, email }) {
  const db = await openDb();
  const store = tx(db, 'readwrite');
  const existing = await reqAsPromise(store.get(envelopeId));
  if (existing) return false; // дубль (повторний catchup)
  await reqAsPromise(store.put({
    envelope_id: envelopeId,
    ts: ts || Math.floor(Date.now() / 1000),
    read: false,
    email,
  }));
  return true;
}

export async function listEmails({ limit = 50, beforeTs = null } = {}) {
  const db = await openDb();
  const store = tx(db, 'readonly');
  const idx = store.index('by_ts');
  // новіші перші: курсор prev; beforeTs — для пагінації «старіші»
  const range = beforeTs ? IDBKeyRange.upperBound(beforeTs, true) : null;
  return new Promise((resolve, reject) => {
    const out = [];
    const cur = idx.openCursor(range, 'prev');
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c || out.length >= limit) return resolve(out);
      out.push(c.value);
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
}

export async function getEmail(envelopeId) {
  const db = await openDb();
  return (await reqAsPromise(tx(db, 'readonly').get(envelopeId))) || null;
}

export async function markRead(envelopeId, read = true) {
  const db = await openDb();
  const store = tx(db, 'readwrite');
  const msg = await reqAsPromise(store.get(envelopeId));
  if (!msg) return;
  msg.read = !!read;
  await reqAsPromise(store.put(msg));
}

export async function removeEmail(envelopeId) {
  const db = await openDb();
  await reqAsPromise(tx(db, 'readwrite').delete(envelopeId));
}

export async function unreadCount() {
  const db = await openDb();
  const store = tx(db, 'readonly');
  return new Promise((resolve, reject) => {
    let n = 0;
    const cur = store.openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return resolve(n);
      if (!c.value.read) n++;
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
}

export async function clearAll() {
  const db = await openDb();
  await reqAsPromise(tx(db, 'readwrite').clear());
}
