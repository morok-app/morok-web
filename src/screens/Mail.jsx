import { useEffect, useState, useCallback } from 'react';
import * as mailStore from '../lib/mail_store.js';
import * as backup from '../lib/mail_backup.js';
import * as vault from '../lib/vault.js';
import { TopBar } from '../components/ui.jsx';

const ACCENT = '#7B96FF';
const BG = '#0A0A0B';
const SURFACE = '#16161B';
const BORDER = '#232329';
const TEXT = '#F5F5F7';
const MUTED = '#8A8A96';

function fmtDate(ts) {
  const d = new Date((ts || 0) * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// «Ім'я <addr>» → показуємо ім'я, а адресу окремо
function parseFrom(from) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from || '');
  if (m) return { name: m[1] || m[2], addr: m[2] };
  return { name: from || 'Невідомий відправник', addr: from || '' };
}

export default function Mail({ onNavigate }) {
  const [emails, setEmails] = useState(null);   // null = завантаження
  const [openId, setOpenId] = useState(null);   // відкритий лист (envelope_id)
  const [backupMsg, setBackupMsg] = useState(null);

  async function handleExport() {
    try {
      const seed = vault.getUnlockedSeed();
      if (!seed) { setBackupMsg('Спершу розблокуйте акаунт'); return; }
      const n = await backup.exportToFile(seed);
      setBackupMsg(`Експортовано листів: ${n}`);
    } catch (e) {
      setBackupMsg('Помилка експорту: ' + (e?.message || e));
    }
    setTimeout(() => setBackupMsg(null), 3000);
  }

  async function handleImportFile(ev) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const seed = vault.getUnlockedSeed();
      if (!seed) { setBackupMsg('Спершу розблокуйте акаунт'); return; }
      const obj = await backup.readBackupFile(file);
      const r = await backup.importBackup(seed, obj);
      setBackupMsg(`Імпортовано нових: ${r.imported} (пропущено дублів: ${r.skipped})`);
      reload();
    } catch (e) {
      setBackupMsg('Помилка імпорту: ' + (e?.message || e));
    }
    setTimeout(() => setBackupMsg(null), 4000);
  }

  const reload = useCallback(async () => {
    try {
      const list = await mailStore.listEmails({ limit: 200 });
      setEmails(list);
    } catch (e) {
      console.warn('mail list failed:', e);
      setEmails([]);
    }
  }, []);

  useEffect(() => {
    reload();
    const onUpdate = () => reload();
    window.addEventListener('morok-mail-update', onUpdate);
    return () => window.removeEventListener('morok-mail-update', onUpdate);
  }, [reload]);

  const open = emails?.find((e) => e.envelope_id === openId) || null;

  async function handleOpen(msg) {
    setOpenId(msg.envelope_id);
    if (!msg.read) {
      await mailStore.markRead(msg.envelope_id, true);
      reload();
    }
  }

  async function handleDelete(id) {
    await mailStore.removeEmail(id);
    if (openId === id) setOpenId(null);
    reload();
  }

  // ── ЧИТАННЯ ЛИСТА ──
  if (open) {
    return <MailReader msg={open} onBack={() => setOpenId(null)} onDelete={() => handleDelete(open.envelope_id)} />;
  }

  // ── СПИСОК ──
  const unread = (emails || []).filter((e) => !e.read).length;
  return (
    <div className="screen" style={{ background: BG, minHeight: '100%' }}>
      <TopBar
        title="Пошта"
        subtitle={
          emails === null ? 'Завантаження…'
            : emails.length === 0 ? 'Порожньо'
            : `${emails.length} лист(ів)${unread ? ` · ${unread} нових` : ''}`
        }
        onBack={() => onNavigate('tools')}
        backIcon="arrow"
        right={
          <button
            onClick={() => onNavigate('mail-aliases')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(123,150,255,0.12)', color: ACCENT,
              border: `1px solid ${BORDER}`, borderRadius: 10,
              padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>
            </svg>
            Адреси
          </button>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 32px' }}>
        {emails === null && (
          <div style={{ color: MUTED, textAlign: 'center', padding: 40 }}>Завантаження…</div>
        )}

        {emails?.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: MUTED }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 15, color: TEXT, marginBottom: 6 }}>Скринька порожня</div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              Створіть адресу в розділі «Адреси» й дайте її комусь —<br />
              листи з'являться тут, зашифровані лише для вас.
            </div>
          </div>
        )}

        {emails?.map((m) => {
          const { name } = parseFrom(m.email?.from);
          const spfBad = m.email?.spf && m.email.spf !== 'pass' && m.email.spf !== 'none';
          return (
            <button
              key={m.envelope_id}
              onClick={() => handleOpen(m)}
              style={{
                width: '100%', textAlign: 'left', display: 'flex', gap: 12,
                alignItems: 'flex-start', background: m.read ? 'transparent' : 'rgba(123,150,255,0.06)',
                border: `1px solid ${m.read ? BORDER : 'rgba(123,150,255,0.25)'}`,
                borderRadius: 14, padding: '13px 14px', marginBottom: 8, cursor: 'pointer',
              }}
            >
              <div style={{
                width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0,
                background: m.read ? 'transparent' : ACCENT,
              }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                  <span style={{
                    fontSize: 14.5, fontWeight: m.read ? 500 : 700, color: TEXT,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{name}</span>
                  <span style={{ fontSize: 12, color: MUTED, flexShrink: 0 }}>{fmtDate(m.ts)}</span>
                </div>
                <div style={{
                  fontSize: 13.5, color: m.read ? MUTED : TEXT, fontWeight: m.read ? 400 : 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
                }}>{m.email?.subject || '(без теми)'}</div>
                <div style={{
                  fontSize: 12.5, color: MUTED,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {spfBad && (
                    <span style={{ color: '#FFA94D', marginRight: 6 }} title={`SPF: ${m.email.spf}`}>⚠ неперевірений</span>
                  )}
                  {(m.email?.text || '').slice(0, 120).replace(/\s+/g, ' ')}
                </div>
              </div>
            </button>
          );
        })}

        {/* ── Бекап скриньки ── */}
        {emails && emails.length >= 0 && (
          <div style={{
            marginTop: 24, borderTop: `1px solid ${BORDER}`, paddingTop: 16,
          }}>
            {backupMsg && (
              <div style={{ fontSize: 12.5, color: ACCENT, marginBottom: 10 }}>{backupMsg}</div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleExport}
                style={{
                  flex: 1, background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`,
                  borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >⤓ Експорт скриньки</button>
              <label
                style={{
                  flex: 1, background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`,
                  borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                ⤒ Імпорт
                <input type="file" accept=".morokmail,application/json" onChange={handleImportFile} style={{ display: 'none' }} />
              </label>
            </div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
              Пошта зберігається лише на цьому пристрої. Робіть бекап — файл
              зашифрований вашим ключем, відкрити його зможете тільки ви.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Читання одного листа ──
function MailReader({ msg, onBack, onDelete }) {
  const e = msg.email || {};
  const { name, addr } = parseFrom(e.from);
  const [showHtml, setShowHtml] = useState(!!e.html);

  return (
    <div className="screen" style={{ background: BG, minHeight: '100%' }}>
      <TopBar
        title={e.subject || '(без теми)'}
        subtitle={`на ${e.to_alias || '—'}@morok.email`}
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
        {/* мета відправника */}
        <div style={{
          background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14,
          padding: '14px 16px', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{name}</div>
              {addr && <div style={{ fontSize: 13, color: MUTED, wordBreak: 'break-all' }}>{addr}</div>}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, textAlign: 'right', flexShrink: 0 }}>
              {e.date || fmtDate(msg.ts)}
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Tag label={`SPF: ${e.spf || 'none'}`} ok={e.spf === 'pass'} />
            {e.html && (
              <button
                onClick={() => setShowHtml((v) => !v)}
                style={{
                  fontSize: 12, color: ACCENT, background: 'transparent',
                  border: `1px solid ${BORDER}`, borderRadius: 8, padding: '4px 10px', cursor: 'pointer',
                }}
              >{showHtml ? 'Показати текст' : 'Показати HTML'}</button>
            )}
          </div>
        </div>

        {/* тіло */}
        {showHtml && e.html ? (
          <iframe
            title="email-html"
            sandbox=""
            srcDoc={e.html}
            style={{
              width: '100%', minHeight: 320, border: `1px solid ${BORDER}`,
              borderRadius: 14, background: '#fff',
            }}
          />
        ) : (
          <div style={{
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: TEXT,
            fontSize: 14.5, lineHeight: 1.6,
          }}>{e.text || '(порожній лист)'}</div>
        )}

        {/* вкладення */}
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
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
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

function Tag({ label, ok }) {
  return (
    <span style={{
      fontSize: 12, padding: '4px 10px', borderRadius: 8,
      background: ok ? 'rgba(74,222,128,0.12)' : 'rgba(255,169,77,0.12)',
      color: ok ? '#4ADE80' : '#FFA94D',
      border: `1px solid ${BORDER}`,
    }}>{label}</span>
  );
}
