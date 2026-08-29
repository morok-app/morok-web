/**
 * morok.email — бекап скриньки.
 *
 * Експорт: уся локальна пошта (mail_store) → JSON → шифрування ключем,
 * виведеним із сіда (crypto.mailBackupKey) → файл `.morokmail`.
 * Розшифрувати може ЛИШЕ власник того ж сіда. Сервер не бере участі.
 *
 * Імпорт: файл → розшифрування → злиття у скриньку (дедуплікація по
 * envelope_id — наявні листи не перезаписуються, нові додаються).
 *
 * Формат файлу (JSON):
 *   { magic:"morok-mail-backup", v:1, created_at, blob }
 *   blob = encryptWithKey(mailBackupKey(seed), utf8(JSON(messages[])))
 */
import * as crypto from './crypto.js';
import * as mailStore from './mail_store.js';
import { t } from './i18n.js';

const MAGIC = 'morok-mail-backup';
const VERSION = 1;

/** Зібрати всю скриньку у зашифрований об'єкт бекапу. */
export async function buildBackup(seed) {
  const messages = await mailStore.listEmails({ limit: 100000 });
  const key = crypto.mailBackupKey(seed);
  const blob = crypto.encryptStringWithKey(key, JSON.stringify(messages));
  return {
    magic: MAGIC,
    v: VERSION,
    created_at: Math.floor(Date.now() / 1000),
    count: messages.length,
    blob,
  };
}

/** Експорт → завантаження файлу .morokmail у браузері. */
export async function exportToFile(seed) {
  const backup = await buildBackup(seed);
  const json = JSON.stringify(backup);
  const fileBlob = new Blob([json], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(fileBlob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `morok-mail-${stamp}.morokmail`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return backup.count;
}

/**
 * Імпорт із розпарсеного об'єкта бекапу.
 * Повертає { imported, skipped, total }.
 * Кидає помилку, якщо файл не той або сід не підходить (auth tag).
 */
export async function importBackup(seed, backupObj) {
  if (!backupObj || backupObj.magic !== MAGIC) {
    throw new Error('This isn\'t a Morok Mail backup file');
  }
  const key = crypto.mailBackupKey(seed);
  let messages;
  try {
    const json = crypto.decryptStringWithKey(key, backupObj.blob);
    messages = JSON.parse(json);
  } catch {
    throw new Error('Couldn\'t decrypt — this backup belongs to another account');
  }
  if (!Array.isArray(messages)) throw new Error(t('Corrupted backup'));

  let imported = 0, skipped = 0;
  for (const m of messages) {
    if (!m?.envelope_id || !m?.email) { skipped++; continue; }
    const isNew = await mailStore.addEmail({
      envelopeId: m.envelope_id,
      ts: m.ts,
      email: m.email,
    });
    if (isNew) imported++; else skipped++;
  }
  return { imported, skipped, total: messages.length };
}

/** Прочитати File (з <input type=file>) → об'єкт бекапу. */
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); }
      catch { reject(new Error('The file is corrupted or isn\'t a backup')); }
    };
    reader.onerror = () => reject(new Error('Couldn\'t read the file'));
    reader.readAsText(file);
  });
}
