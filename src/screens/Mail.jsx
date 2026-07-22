import { useEffect, useState, useCallback } from 'react';
import * as mailStore from '../lib/mail_store.js';
import * as backup from '../lib/mail_backup.js';
import * as vault from '../lib/vault.js';
import * as api from '../lib/api.js';
import { TopBar } from '../components/ui.jsx';

const ACCENT = '#7B96FF';
const BG = '#0A0A0B';
const SURFACE = '#16161B';
const BORDER = '#232329';
const TEXT = '#F5F5F7';
const MUTED = '#A8AAB5';

function fmtDate(ts) {
  const d = new Date((ts || 0) * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('uk-UA', sameYear
    ? { day: '2-digit', month: 'short' }
    : { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// «Ім'я <addr>» → { name, addr }
function parseFrom(from) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from || '');
  if (m) return { name: m[1] || m[2], addr: m[2] };
  return { name: from || '', addr: from || '' };
}

// у списку показуємо: вхідні → відправник; відправлені → кому
function counterpart(msg) {
  const e = msg.email || {};
  if (e.out) {
    const to = e.to_addr || (e.to_alias ? `${e.to_alias}@morok.email` : 'отримувач');
    return { title: to, initialSrc: to };
  }
  const { name, addr } = parseFrom(e.from);
  return { title: name || addr || 'Невідомий', initialSrc: name || addr };
}

function avatarColor(s) {
  let h = 0;
  for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 42%)`;
}
function initial(s) {
  const c = (s || '?').trim()[0] || '?';
  return c.toUpperCase();
}

export default function Mail({ onNavigate }) {
  const [all, setAll] = useState(null);       // null = завантаження
  const [tab, setTab] = useState('in');       // 'in' | 'out'
  const [openId, setOpenId] = useState(null);
  const [backupMsg, setBackupMsg] = useState(null);

  const reload = useCallback(async () => {
    try {
      setAll(await mailStore.listEmails({ limit: 500 }));
    } catch (e) {
      console.warn('mail list failed:', e);
      setAll([]);
    }
  }, []);

  useEffect(() => {
    reload();
    mailStore.sweepTombstones().catch(() => {});
    const onUpdate = () => reload();
    window.addEventListener('morok-mail-update', onUpdate);
    return () => window.removeEventListener('morok-mail-update', onUpdate);
  }, [reload]);

  // статуси зовнішніх вихідних (⏳/✓/✗) — підтягуємо при відкритті «Відправлених»
  useEffect(() => {
    if (tab !== 'out') return;
    (async () => {
      try {
        const { items } = await api.mailOutboundStatus();
        if (!items?.length) return;
        let changed = false;
        for (const it of items) {
          const rec = await mailStore.getEmail(`out-${it.ref}`).catch(() => null);
          if (rec?.email && rec.email.ext_status !== it.status) {
            rec.email.ext_status = it.status;
            rec.email.ext_error = it.error || null;
            await mailStore.updateEmail(rec);
            changed = true;
          }
        }
        if (changed) reload();
      } catch { /* тихо */ }
    })();
  }, [tab, reload]);

  const inbox = (all || []).filter((m) => !m.email?.out);
  const sent = (all || []).filter((m) => m.email?.out);
  const list = tab === 'in' ? inbox : sent;
  const unread = inbox.filter((m) => !m.read).length;
  const open = all?.find((m) => m.envelope_id === openId) || null;

  async function handleOpen(msg) {
    setOpenId(msg.envelope_id);
    if (!msg.read) { await mailStore.markRead(msg.envelope_id, true); reload(); }
  }
  async function handleDelete(id) {
    await mailStore.removeEmail(id);
    if (openId === id) setOpenId(null);
    reload();
  }

  async function handleExport() {
    try {
      const seed = vault.getUnlockedSeed();
      if (!seed) { setBackupMsg('Розблокуйте акаунт'); return; }
      const n = await backup.exportToFile(seed);
      setBackupMsg(`Експортовано: ${n}`);
    } catch (e) { setBackupMsg('Помилка експорту'); }
    setTimeout(() => setBackupMsg(null), 2500);
  }
  async function handleImportFile(ev) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const seed = vault.getUnlockedSeed();
      if (!seed) { setBackupMsg('Розблокуйте акаунт'); return; }
      const obj = await backup.readBackupFile(file);
      const r = await backup.importBackup(seed, obj);
      setBackupMsg(`Імпортовано: ${r.imported}`);
      reload();
    } catch (e) { setBackupMsg('Помилка імпорту'); }
    setTimeout(() => setBackupMsg(null), 3000);
  }

  if (open) {
    return <MailReader
      msg={open}
      onBack={() => setOpenId(null)}
      onDelete={() => handleDelete(open.envelope_id)}
      onNavigate={onNavigate}
    />;
  }

  return (
    <div className="screen" style={{ background: BG, minHeight: '100%', position: 'relative' }}>
      <TopBar
        title="Пошта"
        subtitle={unread ? `${unread} нових` : null}
        onBack={() => onNavigate('tools')}
        backIcon="arrow"
        right={
          <button
            onClick={() => onNavigate('mail-aliases')}
            aria-label="Адреси"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(123,150,255,0.12)', color: ACCENT,
              border: `1px solid ${BORDER}`, borderRadius: 10,
              padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" />
            </svg>
            Адреси
          </button>
        }
      />

      {/* вкладки */}
      <div style={{ display: 'flex', gap: 4, padding: '0 14px', marginBottom: 6 }}>
        {[['in', 'Вхідні', inbox.length], ['out', 'Відправлені', sent.length]].map(([k, label, n]) => {
          const active = tab === k;
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                flex: 1, background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '10px 0 12px', fontSize: 14, fontWeight: active ? 700 : 500,
                color: active ? TEXT : MUTED,
                borderBottom: `2px solid ${active ? ACCENT : 'transparent'}`,
              }}
            >
              {label}{n > 0 && <span style={{ color: MUTED, fontWeight: 500 }}> · {n}</span>}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 32px' }}>
        {all === null && <div style={{ color: MUTED, textAlign: 'center', padding: 40 }}>Завантаження…</div>}

        {all !== null && list.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 24px', color: MUTED }}>
            <div style={{ fontSize: 15, color: TEXT, marginBottom: 6 }}>
              {tab === 'in' ? 'Вхідних листів немає' : 'Ви ще нічого не надсилали'}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              {tab === 'in'
                ? 'Створіть адресу в «Адреси» й дайте її комусь.'
                : 'Натисніть ✎, щоб написати листа.'}
            </div>
          </div>
        )}

        {list.map((m) => {
          const cp = counterpart(m);
          const unreadRow = !m.email?.out && !m.read;
          return (
            <button
              key={m.envelope_id}
              onClick={() => handleOpen(m)}
              style={{
                width: '100%', textAlign: 'left', display: 'flex', gap: 11, alignItems: 'center',
                background: 'transparent', border: 'none', borderBottom: `1px solid ${BORDER}`,
                padding: '10px 4px', cursor: 'pointer',
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                background: avatarColor(cp.initialSrc), color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700,
              }}>{initial(cp.initialSrc)}</div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                  <span style={{
                    fontSize: 14.5, fontWeight: unreadRow ? 700 : 600, color: TEXT,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {tab === 'out' && <span style={{ color: MUTED, fontWeight: 500 }}>Кому: </span>}
                    {cp.title}
                  </span>
                  <span style={{ fontSize: 12, color: unreadRow ? ACCENT : MUTED, flexShrink: 0 }}>{fmtDate(m.ts)}</span>
                </div>
                <div style={{
                  fontSize: 13.5, color: unreadRow ? TEXT : MUTED, fontWeight: unreadRow ? 600 : 400,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1,
                }}>
                  {m.email?.external && (
                    <span style={{ marginRight: 6 }} title={m.email.ext_error || ''}>
                      {m.email.ext_status === 'delivered' ? '✓'
                        : m.email.ext_status === 'failed' ? '✗'
                        : '⏳'}
                    </span>
                  )}
                  {m.email?.subject || '(без теми)'}
                </div>
                <div style={{
                  fontSize: 12.5, color: MUTED,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{(m.email?.text || '').slice(0, 120).replace(/\s+/g, ' ')}</div>
              </div>

              {unreadRow && <div style={{ width: 8, height: 8, borderRadius: '50%', background: ACCENT, flexShrink: 0 }} />}
            </button>
          );
        })}

        {/* бекап — тихий футер */}
        {all !== null && (
          <div style={{ marginTop: 20, paddingTop: 12, borderTop: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={handleExport} style={footBtn}>Експорт</button>
            <label style={footBtn}>
              Імпорт
              <input type="file" accept=".morokmail,application/json" onChange={handleImportFile} style={{ display: 'none' }} />
            </label>
            <span style={{ fontSize: 11.5, color: MUTED, flex: 1, minWidth: 140 }}>
              {backupMsg || 'Пошта лише на цьому пристрої — робіть бекап.'}
            </span>
          </div>
        )}
      </div>

      <button
        onClick={() => onNavigate('mail-compose')}
        aria-label="Написати лист"
        style={{
          position: 'absolute', right: 20, bottom: 20, width: 56, height: 56,
          borderRadius: 28, background: ACCENT, color: '#0A0A0B', border: 'none',
          fontSize: 24, cursor: 'pointer', lineHeight: 1,
          boxShadow: '0 6px 20px rgba(107,138,254,0.4)',
        }}
      >✎</button>
    </div>
  );
}

const footBtn = {
  background: 'transparent', color: MUTED, border: `1px solid ${BORDER}`,
  borderRadius: 8, padding: '6px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
};

// ─────────────────────────────────────────── читання
function MailReader({ msg, onBack, onDelete, onNavigate }) {
  const e = msg.email || {};
  const out = !!e.out;
  const { name, addr } = parseFrom(e.from);
  const [showHtml, setShowHtml] = useState(!!e.html);

  // адреса для відповіді: тільки внутрішні @morok.email (зовнішня відправка — Фаза 3)
  // Відповідь: вхідні — адресa відправника (внутрішня чи зовнішня — слати вміємо);
  // свої відправлені — адресат.
  const replyAddr = out
    ? (e.to_addr || (e.to_alias ? `${e.to_alias}@morok.email` : ''))
    : (parseFrom(e.from).addr || '');
  const canReply = !!replyAddr && replyAddr.includes('@');
  // відповідаємо тим аліасом, на який прийшов лист (не палимо основну адресу)
  const replyFromAlias = !out && e.to_alias ? e.to_alias : null;

  function openDraft(draft) {
    window.__morokMailDraft = draft;
    onNavigate('mail-compose');
  }
  function handleReply() {
    const subj = (e.subject || '').replace(/^\s*re:\s*/i, '');
    openDraft({
      to: replyAddr,
      fromAlias: replyFromAlias,
      inReplyTo: e.message_id || null,
      references: e.references || null,
      subject: `Re: ${subj}`,
      text: `\n\n----- ${out ? 'Ваш лист' : 'Оригінал'} -----\n${(e.text || '').split('\n').map(l => '> ' + l).join('\n')}`,
    });
  }
  function handleForward() {
    const subj = (e.subject || '').replace(/^\s*fwd:\s*/i, '');
    openDraft({
      to: '',
      subject: `Fwd: ${subj}`,
      text: `\n\n----- Переслано -----\nВід: ${out ? 'ви' : (parseFrom(e.from).name || parseFrom(e.from).addr)}\nТема: ${e.subject || '(без теми)'}\n\n${e.text || ''}`,
    });
  }

  const who = out
    ? { label: 'Кому', name: e.to_addr || (e.to_alias ? `${e.to_alias}@morok.email` : '—'), addr: '' }
    : { label: 'Від', name: name || addr || 'Невідомий', addr: name && addr && name !== addr ? addr : '' };

  return (
    <div className="screen" style={{ background: BG, minHeight: '100%' }}>
      <TopBar
        title={e.subject || '(без теми)'}
        subtitle={out ? 'надіслано вами' : `на ${e.to_alias || '—'}@morok.email`}
        onBack={onBack}
        backIcon="arrow"
        right={
          <button
            onClick={onDelete}
            style={{
              background: 'rgba(255,90,90,0.1)', color: '#FF6B6B',
              border: `1px solid ${BORDER}`, borderRadius: 10,
              padding: '8px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >Видалити</button>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px 40px' }}>
        <div style={{
          background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14,
          padding: '12px 14px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
              background: avatarColor(who.name), color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700,
            }}>{initial(who.name)}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 1 }}>{who.label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis' }}>{who.name}</div>
              {who.addr && <div style={{ fontSize: 12.5, color: MUTED, wordBreak: 'break-all' }}>{who.addr}</div>}
            </div>
            <div style={{ fontSize: 12, color: MUTED, flexShrink: 0 }}>{fmtDate(msg.ts)}</div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {e.spf === 'internal'
              ? <Tag label="🔒 Morok" ok />
              : <Tag label={`SPF: ${e.spf || 'none'}`} ok={e.spf === 'pass'} />}
            {e.html && (
              <button
                onClick={() => setShowHtml((v) => !v)}
                style={{
                  fontSize: 12, color: ACCENT, background: 'transparent',
                  border: `1px solid ${BORDER}`, borderRadius: 8, padding: '4px 10px', cursor: 'pointer',
                }}
              >{showHtml ? 'Текст' : 'HTML'}</button>
            )}
          </div>
        </div>

        {showHtml && e.html ? (
          <EmailHtml html={e.html} />
        ) : (
          <EmailText text={e.text} />
        )}

        {/* дії */}
        <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
          {canReply && (
            <button onClick={handleReply} style={actBtn(true)}>↩ Відповісти</button>
          )}
          <button onClick={handleForward} style={actBtn(false)}>↪ Переслати</button>
        </div>

        {Array.isArray(e.attachments) && e.attachments.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 8, fontWeight: 600 }}>
              Вкладення ({e.attachments.length})
            </div>
            {e.attachments.map((att, i) => (
              <a
                key={i}
                href={`data:${att.content_type || 'application/octet-stream'};base64,${att.b64}`}
                download={att.filename || `attachment-${i}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12,
                  padding: '11px 14px', marginBottom: 8, textDecoration: 'none', color: TEXT,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.filename || `attachment-${i}`}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// HTML-лист: пісочниця без скриптів, авто-висота по вмісту, типографіка всередині.
// sandbox="allow-same-origin" (БЕЗ allow-scripts): скрипти листа не виконуються,
// але ми можемо виміряти висоту вмісту; allow-popups — посилання у нову вкладку.
// Чи є у листі зовнішній контент (потенційні трекери/пікселі)?
function hasRemoteContent(html) {
  return /(?:src|background|href)\s*=\s*["']?https?:\/\//i.test(html || '')
    || /url\(\s*["']?https?:\/\//i.test(html || '');
}

function EmailHtml({ html }) {
  const [h, setH] = useState(240);
  const [showRemote, setShowRemote] = useState(false);
  const remote = hasRemoteContent(html);

  // CSP: за замовчуванням БЛОКУЄМО будь-який зовнішній ресурс (img/стилі/шрифти/
  // fetch) — це вбиває трекінг-пікселі («лист прочитано + твій IP»). Коли юзер
  // натискає «показати зображення» — дозволяємо тільки картинки по https.
  const csp = showRemote
    ? "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src data:;"
    : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;";

  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  html,body{margin:0;padding:0;background:#fff}
  body{padding:18px 20px;font:14px/1.55 -apple-system,'Segoe UI',Roboto,sans-serif;
       color:#1a1a1e;word-break:break-word;overflow-wrap:anywhere}
  img{max-width:100%!important;height:auto!important}
  table{max-width:100%!important}
  a{color:#4a6cf7}
  blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid #d0d4ff;color:#555}
</style></head><body>${html}</body></html>`;

  return (
    <div>
      {remote && !showRemote && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          background: 'rgba(255,169,77,0.08)', border: `1px solid rgba(255,169,77,0.25)`,
          borderRadius: 12, padding: '9px 12px', marginBottom: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12.5, color: '#FFA94D' }}>
            🛡 Зовнішні зображення заблоковано (захист від трекінгу)
          </span>
          <button
            onClick={() => setShowRemote(true)}
            style={{
              fontSize: 12.5, fontWeight: 600, color: TEXT, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${BORDER}`,
              borderRadius: 8, padding: '5px 12px',
            }}
          >Показати</button>
        </div>
      )}
      <iframe
        key={showRemote ? 'remote' : 'blocked'}
        title="email-html"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        onLoad={(ev) => {
          try {
            const b = ev.target.contentDocument?.body;
            if (b) setH(Math.min(Math.max(b.scrollHeight + 8, 120), 1400));
          } catch { /* opaque — лишаємо дефолт */ }
        }}
        style={{
          width: '100%', height: h, border: `1px solid ${BORDER}`,
          borderRadius: 14, background: '#fff', display: 'block',
        }}
      />
    </div>
  );
}

// Текстовий лист: цитати ("> ...") — приглушені з рискою, решта — звичайний текст.
function EmailText({ text }) {
  const lines = (text || '').split('\n');
  const blocks = [];
  let buf = [], quoted = null;
  for (const ln of lines) {
    const q = /^\s*>/.test(ln);
    if (quoted === null) quoted = q;
    if (q !== quoted) { blocks.push({ quoted, body: buf.join('\n') }); buf = []; quoted = q; }
    buf.push(q ? ln.replace(/^\s*>\s?/, '') : ln);
  }
  if (buf.length) blocks.push({ quoted, body: buf.join('\n') });
  if (!blocks.length) return <div style={{ color: MUTED, fontSize: 14 }}>(порожній лист)</div>;
  return (
    <div>
      {blocks.map((b, i) => b.quoted ? (
        <div key={i} style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: MUTED,
          fontSize: 13.5, lineHeight: 1.55, borderLeft: `3px solid ${BORDER}`,
          paddingLeft: 12, margin: '10px 0',
        }}>{b.body}</div>
      ) : (
        <div key={i} style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: TEXT,
          fontSize: 14.5, lineHeight: 1.65,
        }}>{b.body}</div>
      ))}
    </div>
  );
}

function actBtn(primary) {
  return {
    background: primary ? 'rgba(123,150,255,0.12)' : 'transparent',
    color: primary ? ACCENT : TEXT,
    border: `1px solid ${primary ? 'rgba(123,150,255,0.3)' : BORDER}`,
    borderRadius: 10, padding: '10px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
  };
}

function Tag({ label, ok }) {
  return (
    <span style={{
      fontSize: 12, padding: '4px 10px', borderRadius: 8,
      background: ok ? 'rgba(74,222,128,0.12)' : 'rgba(255,169,77,0.12)',
      color: ok ? '#4ADE80' : '#FFA94D', border: `1px solid ${BORDER}`,
    }}>{label}</span>
  );
}
