/**
 * msgfx.js — дрібна логіка повідомлень, спільна для екранів і протоколу:
 * спойлери, позначка «Переслано», правила редагування, пошук у чаті.
 *
 * Без залежностей від React / RN — однаковий файл у morok-rn/lib і
 * morok-web/src/lib (має збігатися).
 *
 * ── Спойлер ────────────────────────────────────────────────
 *   ||прихований текст||  — показується закритим, відкривається дотиком.
 *   Це лише розмітка в тексті: старі клієнти побачать ||…|| як є, нічого
 *   не ламається. У превʼю (список чатів, цитата) прихований текст
 *   замінюється на ▒▒▒ — щоб не розкрити його збоку.
 *
 * ── Пересилання ────────────────────────────────────────────
 *   fwd: { name: "@нік" | null }  у зашифрованому payload.
 *   Імʼя автора — лише ЗАЯВА того, хто переслав (перевірити її неможливо),
 *   тому за замовчуванням не додається, а в UI підписується як є.
 *
 * ── Редагування ────────────────────────────────────────────
 *   { kind: 'edit', target_envelope_id, text }
 *   Одержувач застосовує лише до повідомлення ЦЬОГО ж автора, лише до
 *   текстового, лише в межах EDIT_WINDOW_S від оригіналу і лише якщо
 *   правка новіша за попередню (edited_at).
 */

export const EDIT_WINDOW_S = 48 * 3600;
export const TEXT_MAX = 8000;

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
// керівні та «невидимі» символи (bidi-override, zero-width) — геть з імен
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g;

// ── Спойлери ─────────────────────────────────────────────

const SPOILER_RE = /\|\|([\s\S]+?)\|\|/g;

/** Розбити текст на шматки: [{ t, spoiler }]. */
export function splitSpoilers(text) {
  const s = typeof text === 'string' ? text : '';
  const out = [];
  let last = 0;
  SPOILER_RE.lastIndex = 0;
  let m;
  while ((m = SPOILER_RE.exec(s)) !== null) {
    if (!m[1].trim()) continue;
    if (m.index > last) out.push({ t: s.slice(last, m.index), spoiler: false });
    out.push({ t: m[1], spoiler: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: s.slice(last), spoiler: false });
  return out.length ? out : [{ t: s, spoiler: false }];
}

export function hasSpoiler(text) {
  return splitSpoilers(text).some((p) => p.spoiler);
}

/** Текст без розмітки (для копіювання й пошуку). */
export function stripSpoilers(text) {
  return splitSpoilers(text).map((p) => p.t).join('');
}

/** Текст для превʼю: приховане → ▒▒▒ (довжина не розкриває вміст). */
export function maskSpoilers(text) {
  return splitSpoilers(text).map((p) => (p.spoiler ? '▒▒▒▒' : p.t)).join('');
}

/**
 * Обгорнути виділення (або весь текст) у ||…||. Якщо виділення вже
 * всередині спойлера — розгорнути назад. Повертає { text, selection }.
 */
export function toggleSpoiler(text, sel) {
  const s = typeof text === 'string' ? text : '';
  let start = Math.max(0, Math.min(sel?.start ?? 0, s.length));
  let end = Math.max(0, Math.min(sel?.end ?? 0, s.length));
  if (start > end) [start, end] = [end, start];
  if (start === end) { start = 0; end = s.length; }
  // обрізаємо пробіли по краях виділення
  while (start < end && /\s/.test(s[start])) start += 1;
  while (end > start && /\s/.test(s[end - 1])) end -= 1;
  if (start === end) return { text: s, selection: { start: sel?.start ?? 0, end: sel?.end ?? 0 } };
  // вже обгорнуто → розгорнути
  if (s.slice(Math.max(0, start - 2), start) === '||' && s.slice(end, end + 2) === '||') {
    const t = s.slice(0, start - 2) + s.slice(start, end) + s.slice(end + 2);
    return { text: t, selection: { start: start - 2, end: end - 2 } };
  }
  const inner = s.slice(start, end);
  if (inner.startsWith('||') && inner.endsWith('||') && inner.length > 4) {
    const t = s.slice(0, start) + inner.slice(2, -2) + s.slice(end);
    return { text: t, selection: { start, end: end - 4 } };
  }
  const t = `${s.slice(0, start)}||${inner}||${s.slice(end)}`;
  return { text: t, selection: { start: start + 2, end: end + 2 } };
}

// ── Пересилання ──────────────────────────────────────────

/** Перевірити fwd, що прийшов ззовні. null — не переслане. */
export function sanitizeFwd(f) {
  if (f === true) return { name: null };
  if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
  let name = typeof f.name === 'string' ? f.name.replace(BAD_CHARS, '').replace(/\s+/g, ' ').trim() : '';
  if (name.length > 64) name = `${name.slice(0, 63)}…`;
  return { name: name || null };
}

/**
 * Що переслати з повідомлення (null — не можна).
 * Копія живе не довше, ніж лишилось оригіналу — див. forwardTtl.
 */
export function forwardableOf(m) {
  if (!m || m.status === 'undecryptable' || m.status === 'sending' || m.dms_trigger) return null;
  // «зникне після прочитання» — переслати = врятувати від зникнення; не можна
  if (m.read_burn_at) return null;
  if (m.voice?.data_b64) {
    return { kind: 'voice', voice: { data_b64: m.voice.data_b64, mime: m.voice.mime || 'audio/webm', duration_ms: m.voice.duration_ms || 0 } };
  }
  if (m.image?.data_b64) {
    return { kind: 'image', image: { data_b64: m.image.data_b64, mime: m.image.mime || 'image/jpeg', w: m.image.w, h: m.image.h }, caption: m.text || '' };
  }
  if (typeof m.text === 'string' && m.text.trim()) return { kind: 'text', text: m.text };
  return null;
}

/** TTL пересланої копії: не довше за залишок оригіналу (і за типовий). */
export function forwardTtl(m, defaultTtl = 86400, now = Math.floor(Date.now() / 1000)) {
  const left = Number.isFinite(m?.expires_at) ? m.expires_at - now : defaultTtl;
  return Math.max(300, Math.min(defaultTtl, left));
}

// ── Редагування ──────────────────────────────────────────

/** Чи можна мені редагувати це повідомлення. */
export function canEdit(m, now = Math.floor(Date.now() / 1000)) {
  return !!m && m.direction === 'out' && !!m.envelope_id && m.status === 'sent'
    && !m.image && !m.voice && typeof m.text === 'string' && m.text.length > 0
    && Number.isFinite(m.ts) && now - m.ts < EDIT_WINDOW_S;
}

/**
 * Перевірити вхідну правку. Повертає { target, text } або null.
 *   payload  — {kind:'edit', target_envelope_id, text}
 *   editTs   — час правки (підписаний / з sealed-конверта)
 */
export function parseEdit(payload, editTs) {
  if (!payload || typeof payload !== 'object') return null;
  const target = payload.target_envelope_id;
  if (typeof target !== 'string' || !ID_RE.test(target)) return null;
  if (typeof payload.text !== 'string') return null;
  const text = payload.text.slice(0, TEXT_MAX);
  if (!text.trim()) return null;
  if (!Number.isFinite(editTs)) return null;
  return { target, text, ts: Math.floor(editTs) };
}

/**
 * Застосувати правку до знайденого повідомлення (мутує m). true — змінено.
 *   authorOk — викликач уже перевірив, що правку надіслав автор оригіналу.
 */
export function applyEditTo(m, { text, ts }) {
  if (!m || m.image || m.voice || m.status === 'undecryptable') return false;
  if (!Number.isFinite(m.ts) || ts < m.ts || ts - m.ts > EDIT_WINDOW_S) return false;
  if (Number.isFinite(m.edited_at) && ts <= m.edited_at) return false;   // старіша правка
  if (m.text === text) { m.edited_at = ts; return false; }
  m.text = text;
  m.edited = true;
  m.edited_at = ts;
  return true;
}

// ── Пошук у чаті ─────────────────────────────────────────

function norm(s) {
  return String(s || '').toLocaleLowerCase().normalize('NFC');
}

/** id повідомлень, що містять запит (у порядку стрічки). */
export function searchMessages(messages, query) {
  const q = norm(query).trim();
  if (q.length < 1) return [];
  const out = [];
  for (const m of messages || []) {
    if (!m || m.status === 'undecryptable') continue;
    const hay = norm(stripSpoilers(m.text || ''));
    if (hay && hay.includes(q)) out.push(m.id);
  }
  return out;
}
