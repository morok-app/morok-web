/**
 * morok — універсальний бекап пристрою (.morok).
 *
 * Проблема: сід відновлює ОСОБУ, але історія чатів/груп/пошта живуть лише на
 * пристрої. Загубив телефон = загубив історію. Цей модуль пакує ВСЕ локальне
 * в один файл, шифрований ключем із сіда (HKDF, info=morok-backup-v1).
 * Розшифрує лише власник того ж сіда. Сервер не бере участі.
 *
 * ЩО ВСЕРЕДИНІ: чати (conv), групи, контакти/блок/верифікації, профіль,
 * налаштування, sealed-токени, вся пошта (IndexedDB).
 * ЩО НІКОЛИ НЕ ВСЕРЕДИНІ: сід/мнемоніка/identity, сесія, PIN-стан,
 * push-токени — це або секрети відновлення (їх дає мнемоніка), або
 * прив'язане до конкретного пристрою.
 *
 * Формат: { magic:"morok-backup", v:1, created_at, blob }
 *   blob = XChaCha20-Poly1305(deviceBackupKey(seed), JSON({ls, mail}))
 *
 * Імпорт = ЗЛИТТЯ, не заміна: наявне на пристрої завжди виграє;
 * повідомлення об'єднуються з дедупом за id. Імпорт бекапу не може
 * стерти чи перезаписати те, що вже є, — лише додати відсутнє.
 */
import * as crypto from './crypto.js';
import * as mailStore from './mail_store.js';

const MAGIC = 'morok-backup';
const VERSION = 1;

// localStorage-ключі, які пакуємо. Секретів тут НЕМА (див. шапку).
const LS_MERGE_MESSAGES = ['morok.conv.v1', 'morok.groups.v1'];
const LS_MERGE_MAPS = [
  'morok.contacts.v1', 'morok.contacts_explicit.v1', 'morok.blocked.v1',
  'morok.verified.v1', 'morok.profile.v1', 'morok.prefs.v1',
  'morok.sealed.my_token.v1', 'morok.sealed.my_tokens.v2',
  'morok.sealed.peer_tokens.v1', 'morok.sealed.token_sent.v1',
];
const LS_SCALARS = [
  'morok.read_burn.v1', 'morok.notif_enabled.v1', 'morok.notif_sound.v1',
];
const ALL_LS = [...LS_MERGE_MESSAGES, ...LS_MERGE_MAPS, ...LS_SCALARS];

export async function buildBackup(seed) {
  const ls = {};
  for (const k of ALL_LS) {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) ls[k] = v;
    } catch { /* ignore */ }
  }
  const mail = await mailStore.listEmails({ limit: 100000 });
  const key = crypto.deviceBackupKey(seed);
  const blob = crypto.encryptStringWithKey(key, JSON.stringify({ ls, mail }));
  return {
    magic: MAGIC, v: VERSION,
    created_at: Math.floor(Date.now() / 1000),
    chats: countChats(ls['morok.conv.v1']),
    mails: mail.length,
    blob,
  };
}

function countChats(raw) {
  try { return Object.keys(JSON.parse(raw || '{}')).length; } catch { return 0; }
}

export async function exportToFile(seed) {
  const b = await buildBackup(seed);
  const fileBlob = new Blob([JSON.stringify(b)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(fileBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `morok-${new Date().toISOString().slice(0, 10)}.morok`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return b;
}

export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try { resolve(JSON.parse(r.result)); }
      catch { reject(new Error('Файл пошкоджено або це не бекап')); }
    };
    r.onerror = () => reject(new Error('Не вдалося прочитати файл'));
    r.readAsText(file);
  });
}

/** Об'єднати messages-сховище (conv/groups): наявне виграє, повідомлення —
 *  union із дедупом за id (fallback envelope_id). */
function mergeMessageStore(curRaw, bakRaw) {
  let cur, bak;
  try { cur = JSON.parse(curRaw || '{}'); } catch { cur = {}; }
  try { bak = JSON.parse(bakRaw || '{}'); } catch { return { merged: curRaw, added: 0 }; }
  let added = 0;
  for (const key of Object.keys(bak)) {
    const b = bak[key];
    if (!cur[key]) {
      cur[key] = b;
      added += (b?.messages || []).length;
      continue;
    }
    const c = cur[key];
    // відсутні поля розмови — доливаємо, наявні НЕ чіпаємо
    for (const f of Object.keys(b)) {
      if (f !== 'messages' && c[f] === undefined) c[f] = b[f];
    }
    const have = new Set(
      (c.messages || []).map((m) => m?.id || m?.envelope_id).filter(Boolean),
    );
    for (const m of (b.messages || [])) {
      const mid = m?.id || m?.envelope_id;
      if (mid && have.has(mid)) continue;
      (c.messages = c.messages || []).push(m);
      if (mid) have.add(mid);
      added++;
    }
    (c.messages || []).sort((a, z) => (a?.ts || 0) - (z?.ts || 0));
  }
  return { merged: JSON.stringify(cur), added };
}

/** Об'єднати map-сховище: ключі з бекапу додаються, наявні НЕ перезаписуються. */
function mergeMap(curRaw, bakRaw) {
  let cur, bak;
  try { cur = JSON.parse(curRaw || '{}'); } catch { cur = {}; }
  try { bak = JSON.parse(bakRaw || '{}'); } catch { return { merged: curRaw, added: 0 }; }
  if (Array.isArray(cur) || Array.isArray(bak)) {
    // масив (напр. список) — якщо в нас порожньо, беремо з бекапу; інакше не чіпаємо
    if ((!cur || cur.length === 0) && Array.isArray(bak)) {
      return { merged: JSON.stringify(bak), added: bak.length };
    }
    return { merged: JSON.stringify(cur), added: 0 };
  }
  let added = 0;
  for (const k of Object.keys(bak)) {
    if (cur[k] === undefined) { cur[k] = bak[k]; added++; }
  }
  return { merged: JSON.stringify(cur), added };
}

export async function importBackup(seed, obj) {
  if (!obj || obj.magic !== MAGIC) throw new Error('Це не файл бекапу Morok (.morok)');
  const key = crypto.deviceBackupKey(seed);
  let data;
  try {
    data = JSON.parse(crypto.decryptStringWithKey(key, obj.blob));
  } catch {
    throw new Error('Не вдалося розшифрувати — бекап належить іншому акаунту');
  }
  const ls = data?.ls || {};
  let msgsAdded = 0, mapsAdded = 0, mailsAdded = 0;

  for (const k of LS_MERGE_MESSAGES) {
    if (ls[k] === undefined) continue;
    const { merged, added } = mergeMessageStore(localStorage.getItem(k), ls[k]);
    if (added > 0) localStorage.setItem(k, merged);
    msgsAdded += added;
  }
  for (const k of LS_MERGE_MAPS) {
    if (ls[k] === undefined) continue;
    const { merged, added } = mergeMap(localStorage.getItem(k), ls[k]);
    if (added > 0) localStorage.setItem(k, merged);
    mapsAdded += added;
  }
  for (const k of LS_SCALARS) {
    if (ls[k] === undefined) continue;
    if (localStorage.getItem(k) === null) localStorage.setItem(k, ls[k]);
  }
  for (const m of (data?.mail || [])) {
    if (!m?.envelope_id || !m?.email) continue;
    const isNew = await mailStore.addEmail({
      envelopeId: m.envelope_id, ts: m.ts, email: m.email,
    });
    if (isNew) mailsAdded++;
  }
  return { msgsAdded, mapsAdded, mailsAdded };
}
