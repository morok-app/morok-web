import { useState, useEffect } from 'react';
import * as api from '../lib/api.js';
import * as crypto from '../lib/crypto.js';
import * as vault from '../lib/vault.js';
import * as mailStore from '../lib/mail_store.js';
import { compressImage } from '../lib/images.js';
import { TopBar } from '../components/ui.jsx';

const ACCENT = '#7B96FF';
const BG = '#0A0A0B';
const SURFACE = '#16161B';
const BORDER = '#232329';
const TEXT = '#F5F5F7';
const MUTED = '#8A8A96';

const MAIL_DOMAIN = 'morok.email';

// «нік», «нік@morok.email» → внутрішній; «хтось@gmail.com» → зовнішній
function parseRecipient(input) {
  const v = (input || '').trim().toLowerCase();
  if (!v) return null;
  if (v.includes('@')) {
    const [local, dom] = v.split('@');
    if (dom === MAIL_DOMAIN) return { kind: 'internal', local };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { error: 'Некоректна адреса' };
    return { kind: 'external', addr: v };
  }
  return { kind: 'internal', local: v };
}

export default function MailCompose({ onNavigate, myPrimaryAddress }) {
  const _draft = typeof window !== 'undefined' ? window.__morokMailDraft : null;
  if (typeof window !== 'undefined') window.__morokMailDraft = null;
  const [to, setTo] = useState(_draft?.to || '');
  const [subject, setSubject] = useState(_draft?.subject || '');
  const [text, setText] = useState(_draft?.text || '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);   // {type:'ok'|'err', msg}
  const [atts, setAtts] = useState([]);         // [{filename, content_type, b64, size}]
  const [attBusy, setAttBusy] = useState(false);
  const [aliases, setAliases] = useState([]);   // активні аліаси відправника
  const [fromAlias, setFromAlias] = useState(null); // null=завантаж; ''=анонім

  useEffect(() => {
    api.mailListAliases()
      .then((d) => {
        const active = (d.aliases || []).filter((a) => a.status === 'active');
        setAliases(active);
        // Reply-чернетка може диктувати «Від» — аліас, на який прийшов лист
        const wanted = _draft?.fromAlias && active.find((a) => a.alias === _draft.fromAlias);
        const primary = active.find((a) => a.primary) || active[0];
        setFromAlias(wanted ? wanted.alias : (primary ? primary.alias : ''));
      })
      .catch(() => { setAliases([]); setFromAlias(''); });
  }, []);

  async function addImages(ev) {
    const files = Array.from(ev.target.files || []);
    ev.target.value = '';
    if (!files.length) return;
    if (atts.length + files.length > 5) {
      setStatus({ type: 'err', msg: 'Максимум 5 зображень' });
      return;
    }
    setAttBusy(true);
    try {
      for (const f of files) {
        // компресія як у месенджері, але з поштовим бюджетом (~800KB)
        const c = await compressImage(f, { maxDim: 2048, rawBudgetBytes: 800 * 1024 });
        setAtts((prev) => [...prev, {
          filename: (f.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg',
          content_type: c.mime || 'image/jpeg',
          b64: c.data_b64,
          size: Math.round(c.data_b64.length * 0.75),
          isImage: true,
        }]);
      }
    } catch (e) {
      setStatus({ type: 'err', msg: e?.message || 'Не вдалося додати зображення' });
    } finally { setAttBusy(false); }
  }

  async function addFiles(ev) {
    const files = Array.from(ev.target.files || []);
    ev.target.value = '';
    if (!files.length) return;
    if (atts.length + files.length > 5) {
      setStatus({ type: 'err', msg: 'Максимум 5 вкладень' });
      return;
    }
    setAttBusy(true);
    try {
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) {
          setStatus({ type: 'err', msg: `${f.name}: файл >10MB` });
          continue;
        }
        const b64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(',')[1]);
          r.onerror = rej;
          r.readAsDataURL(f);
        });
        setAtts((prev) => [...prev, {
          filename: f.name || 'file',
          content_type: f.type || 'application/octet-stream',
          b64,
          size: f.size,
          isImage: (f.type || '').startsWith('image/'),
        }]);
      }
    } catch (e) {
      setStatus({ type: 'err', msg: 'Не вдалося додати файл' });
    } finally { setAttBusy(false); }
  }

  function removeAtt(i) {
    setAtts((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function send() {
    setStatus(null);
    const parsed = parseRecipient(to);
    if (!parsed || parsed.error) {
      setStatus({ type: 'err', msg: parsed?.error || 'Вкажіть адресу отримувача' });
      return;
    }
    if (!text.trim()) {
      setStatus({ type: 'err', msg: 'Порожній лист' });
      return;
    }
    setBusy(true);
    try {
      const seed = vault.getUnlockedSeed();
      if (!seed) { setStatus({ type: 'err', msg: 'Розблокуйте акаунт' }); setBusy(false); return; }

      // ── ЗОВНІШНІЙ лист: у чергу відправки (не E2E) ──
      if (parsed.kind === 'external') {
        if (!fromAlias) {
          setStatus({ type: 'err', msg: 'Для зовнішніх листів оберіть адресу «Від» (анонімно не можна)' });
          setBusy(false); return;
        }
        const r = await api.mailSendExternal({
          toAddr: parsed.addr, fromAlias,
          subject: subject.trim(), text,
          attachments: atts.map(({ filename, content_type, b64 }) => ({ filename, content_type, b64 })),
          inReplyTo: _draft?.inReplyTo || null,
          references: _draft?.references || null,
        });
        if (r?.status === 'queued') {
          const now = Math.floor(Date.now() / 1000);
          try {
            await mailStore.addEmail({
              envelopeId: `out-${r.ref}`,
              ts: now,
              email: {
                kind: 'email', v: 1, out: true, external: true,
                ext_ref: r.ref, ext_status: 'queued',
                to_addr: parsed.addr,
                from: `${fromAlias}@${MAIL_DOMAIN}`,
                subject: subject.trim() || '(без теми)',
                date: new Date().toUTCString(),
                text, html: null,
                attachments: atts.map(({ filename, content_type, b64 }) => ({ filename, content_type, b64 })),
                received_at: now,
              },
            });
            window.dispatchEvent(new CustomEvent('morok-mail-update'));
          } catch { /* не критично */ }
          setStatus({ type: 'ok', msg: `Лист у черзі відправки на ${parsed.addr}` });
          setTimeout(() => onNavigate('mail'), 900);
        } else {
          setStatus({ type: 'err', msg: 'Не вдалося поставити в чергу' });
        }
        setBusy(false); return;
      }

      // ── ВНУТРІШНІЙ (E2EE) ──
      // 1) резолв адресата → його pubkey
      let res;
      try {
        res = await api.mailResolve(parsed.local);
      } catch (e) {
        setStatus({ type: 'err', msg: `Адресу ${parsed.local}@${MAIL_DOMAIN} не знайдено або вона не приймає пошту` });
        setBusy(false); return;
      }

      // 2) payload. from — обраний аліас або «анонім». УВАГА: серверний
      //    mail_from (перевірений) все одно переб'є це поле в отримувача,
      //    тут from лише для локальної копії «Відправлені».
      const fromAddr = fromAlias ? `${fromAlias}@${MAIL_DOMAIN}` : 'Анонімний відправник';
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        kind: 'email',
        v: 1,
        to_alias: parsed.local,
        from: fromAddr,
        subject: subject.trim() || '(без теми)',
        date: new Date().toUTCString(),
        text: text,
        html: null,
        attachments: atts.map(({ filename, content_type, b64 }) => ({ filename, content_type, b64 })),
        spf: 'internal',
        received_at: now,
      };

      // 3) шифруємо на pubkey адресата (E2EE) і відправляємо
      const blobB64 = crypto.mailSeal({ recipientPubkeyHex: res.pubkey_hex, payload });
      const r = await api.mailSendInternal({ toAlias: parsed.local, blobB64, fromAlias: fromAlias || null });

      if (r?.status === 'sent' || r?.status === 'duplicate') {
        setStatus({ type: 'ok', msg: `Надіслано на ${parsed.local}@${MAIL_DOMAIN}` });
        // локальна копія відправленого у власну скриньку
        try {
          await mailStore.addEmail({
            envelopeId: `sent-${now}-${Math.random().toString(36).slice(2, 8)}`,
            ts: now,
            email: { ...payload, out: true },
          });
          window.dispatchEvent(new CustomEvent('morok-mail-update'));
        } catch { /* не критично */ }
        setTimeout(() => onNavigate('mail'), 900);
      } else {
        setStatus({ type: 'err', msg: 'Не вдалося надіслати' });
      }
    } catch (e) {
      setStatus({ type: 'err', msg: e?.message || 'Помилка надсилання' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ background: BG, minHeight: '100%' }}>
      <TopBar
        title="Новий лист"
        subtitle={`від ${myPrimaryAddress || 'вас'}`}
        onBack={() => onNavigate('mail')}
        backIcon="arrow"
      />

      <style>{`
        .mk-in:focus { border-color: #7B96FF !important; outline: none; }
        .mk-in { transition: border-color 0.15s; }
        .mk-sel { appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238A8A96' stroke-width='1.8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 14px center; padding-right: 36px !important; }
      `}</style>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 32px' }}>

        <div style={{
          fontSize: 12, color: MUTED, lineHeight: 1.5, marginBottom: 16,
          background: 'rgba(123,150,255,0.06)', border: `1px solid ${BORDER}`,
          borderRadius: 12, padding: '10px 14px',
        }}>
          {parseRecipient(to)?.kind === 'external'
            ? <>🔓 Зовнішній лист піде звичайною поштою (SMTP+TLS). Він <b style={{ color: TEXT }}>не наскрізно шифрований</b> — сервер бачить вміст до моменту доставки, після чого стирає його.</>
            : <>🔒 Листи Morok→Morok шифруються наскрізно. Зовнішні адреси (Gmail тощо) теж працюють — але без E2E.</>}
        </div>

        <Field label="Від">
          <select
            className="mk-in mk-sel"
            value={fromAlias ?? ''}
            onChange={(e) => setFromAlias(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {aliases.map((a) => (
              <option key={a.alias} value={a.alias}>
                {a.alias}@{MAIL_DOMAIN}{a.primary ? ' (основна)' : ''}
              </option>
            ))}
            <option value="">Анонімно (без адреси)</option>
          </select>
        </Field>

        <Field label="Кому">
          <input
            className="mk-in"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={`нік@${MAIL_DOMAIN}`}
            spellCheck={false}
            autoCapitalize="none"
            style={inputStyle}
          />
        </Field>

        <Field label="Тема">
          <input
            className="mk-in"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Без теми"
            style={inputStyle}
          />
        </Field>

        <Field label="Текст">
          <textarea
            className="mk-in"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ваш лист…"
            rows={10}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 180, lineHeight: 1.5 }}
          />
        </Field>

        {/* вкладення */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`,
              borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', opacity: attBusy ? 0.6 : 1,
            }}>
              🖼 {attBusy ? 'Обробка…' : 'Фото'}
              <input type="file" accept="image/*" multiple onChange={addImages}
                     disabled={attBusy} style={{ display: 'none' }} />
            </label>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`,
              borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', opacity: attBusy ? 0.6 : 1,
            }}>
              📎 Файл
              <input type="file" multiple onChange={addFiles}
                     disabled={attBusy} style={{ display: 'none' }} />
            </label>
            {atts.length > 0 && (
              <span style={{ fontSize: 12, color: MUTED }}>
                {atts.length} фото · ~{Math.round(atts.reduce((s, a) => s + a.size, 0) / 1024)}KB
              </span>
            )}
          </div>
          {atts.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {atts.map((a, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  {a.isImage ? (
                    <img
                      src={`data:${a.content_type};base64,${a.b64}`}
                      alt={a.filename}
                      style={{ width: 72, height: 72, objectFit: 'cover',
                        borderRadius: 10, border: `1px solid ${BORDER}`, display: 'block' }}
                    />
                  ) : (
                    <div style={{
                      width: 72, height: 72, borderRadius: 10, border: `1px solid ${BORDER}`,
                      background: BG, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', padding: 6, gap: 4,
                    }}>
                      <span style={{ fontSize: 22 }}>📄</span>
                      <span style={{ fontSize: 9, color: MUTED, textAlign: 'center',
                        overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
                        whiteSpace: 'nowrap' }}>{a.filename.split('.').pop().toUpperCase()}</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeAtt(i)}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20,
                      borderRadius: '50%', background: '#FF6B6B', color: '#fff',
                      border: 'none', fontSize: 12, lineHeight: 1, cursor: 'pointer' }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {status && (
          <div style={{
            fontSize: 13, marginBottom: 14, padding: '10px 14px', borderRadius: 12,
            background: status.type === 'ok' ? 'rgba(74,222,128,0.1)' : 'rgba(255,90,90,0.08)',
            border: `1px solid ${status.type === 'ok' ? 'rgba(74,222,128,0.3)' : 'rgba(255,90,90,0.25)'}`,
            color: status.type === 'ok' ? '#4ADE80' : '#FF8787',
          }}>{status.msg}</div>
        )}

        <button
          onClick={send}
          disabled={busy}
          style={{
            width: '100%', background: ACCENT, color: '#0A0A0B', border: 'none',
            borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 700,
            cursor: 'pointer', opacity: busy ? 0.6 : 1,
          }}
        >{busy ? 'Надсилаю…' : 'Надіслати'}</button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`,
  borderRadius: 10, padding: '11px 13px', fontSize: 14.5, outline: 'none',
  fontFamily: 'inherit',
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}
