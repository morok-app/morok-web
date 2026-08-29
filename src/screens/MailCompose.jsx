import { useState, useEffect } from 'react';
import * as api from '../lib/api.js';
import * as crypto from '../lib/crypto.js';
import * as vault from '../lib/vault.js';
import * as mailStore from '../lib/mail_store.js';
import { compressImage } from '../lib/images.js';
import { TopBar } from '../components/ui.jsx';
import { t, tp } from '../lib/i18n.js';

const ACCENT = '#7B96FF';
const BG = '#0A0A0B';
const SURFACE = '#16161B';
const BORDER = '#232329';
const TEXT = '#F5F5F7';
const MUTED = '#A8AAB5';

const MAIL_DOMAIN = 'morok.email';

// Ліміт вкладень — ОДИН для обох гілок, і ось чому.
// Вузьке місце не в застосунку, а в nginx: client_max_body_size 8M на
// релеї. Сервер для внутрішньої пошти дозволяє 25MB, але такий лист
// однаково не долетить — nginx відріже його 413-кою ДО FastAPI, і юзер
// побачить незрозумілу помилку після довгого очікування.
// 6MB base64 (~4.5MB сирих файлів) + JSON-обгортка комфортно влазять у 8M.
// Якщо колись піднімемо nginx — піднімемо і цю константу разом із ним.
const ATT_B64_LIMIT = 6 * 1024 * 1024;

function attsB64Total(atts) {
  return atts.reduce((s, a) => s + (a.b64 ? a.b64.length : 0), 0);
}

// «нік», «нік@morok.email» → внутрішній; «хтось@gmail.com» → зовнішній
function parseRecipient(input) {
  const v = (input || '').trim().toLowerCase();
  if (!v) return null;
  if (v.includes('@')) {
    const [local, dom] = v.split('@');
    if (dom === MAIL_DOMAIN) return { kind: 'internal', local };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { error: t('Invalid address') };
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
      setStatus({ type: 'err', msg: t('5 images max') });
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
      setStatus({ type: 'err', msg: e?.message || 'Couldn\'t add the image' });
    } finally { setAttBusy(false); }
  }

  async function addFiles(ev) {
    const files = Array.from(ev.target.files || []);
    ev.target.value = '';
    if (!files.length) return;
    if (atts.length + files.length > 5) {
      setStatus({ type: 'err', msg: t('5 attachments max') });
      return;
    }
    setAttBusy(true);
    try {
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) {
          setStatus({ type: 'err', msg: tp("{0}: file >10MB", [f.name]) });
          continue;
        }
        const b64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(',')[1]);
          r.onerror = rej;
          r.readAsDataURL(f);
        });
        setAtts((prev) => {
          const next = [...prev, {
            filename: f.name || 'file',
            content_type: f.type || 'application/octet-stream',
            b64,
            size: f.size,
            isImage: (f.type || '').startsWith('image/'),
          }];
          // М'яке попередження ОДРАЗУ, якщо адресат уже зовнішній і сумарний
          // розмір перевищив ліміт зовнішньої пошти (для внутрішніх — ок).
          if (attsB64Total(next) > ATT_B64_LIMIT) {
            setStatus({ type: 'err',
              msg: t('Attachments up to ~4.5MB total — remove the extras') });
          }
          return next;
        });
      }
    } catch (e) {
      setStatus({ type: 'err', msg: 'Couldn\'t add the file' });
    } finally { setAttBusy(false); }
  }

  function removeAtt(i) {
    setAtts((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function send() {
    setStatus(null);
    const parsed = parseRecipient(to);
    if (!parsed || parsed.error) {
      setStatus({ type: 'err', msg: parsed?.error || 'Enter the recipient\'s address' });
      return;
    }
    if (!text.trim()) {
      setStatus({ type: 'err', msg: t('Empty email') });
      return;
    }
    setBusy(true);
    try {
      const seed = vault.getUnlockedSeed();
      if (!seed) { setStatus({ type: 'err', msg: t('Unlock your account') }); setBusy(false); return; }

      // ── ЗОВНІШНІЙ лист: у чергу відправки (не E2E) ──
      // Ліміт вкладень перевіряємо ДО розгалуження: обмеження створює nginx
      // (client_max_body_size), а він однаковий для внутрішніх і зовнішніх.
      // Раніше перевірка стояла лише в зовнішній гілці, тож великий файл
      // «своєму» проходив клієнта і ловив незрозумілу 413 від nginx.
      {
        const b64Total = attsB64Total(atts);
        if (b64Total > ATT_B64_LIMIT) {
          const mb = (b64Total * 0.75 / (1024 * 1024)).toFixed(1);
          setStatus({ type: 'err',
            msg: tp("Attachments ~{0}MB — the limit is ~4.5MB. Remove some files.", [mb]) });
          setBusy(false); return;
        }
      }

      if (parsed.kind === 'external') {
        if (!fromAlias) {
          setStatus({ type: 'err', msg: 'For external mail pick a \u201cFrom\u201d address (can\'t send anonymously)' });
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
                subject: subject.trim() || t('(no subject)'),
                date: new Date().toUTCString(),
                text, html: null,
                attachments: atts.map(({ filename, content_type, b64 }) => ({ filename, content_type, b64 })),
                received_at: now,
              },
            });
            window.dispatchEvent(new CustomEvent('morok-mail-update'));
          } catch { /* не критично */ }
          setStatus({ type: 'ok', msg: tp("Email queued for delivery to {0}", [parsed.addr]) });
          setTimeout(() => onNavigate('mail'), 900);
        } else {
          setStatus({ type: 'err', msg: 'Couldn\'t queue it' });
        }
        setBusy(false); return;
      }

      // ── ВНУТРІШНІЙ (E2EE) ──
      // 1) резолв адресата → його pubkey
      let res;
      try {
        res = await api.mailResolve(parsed.local);
      } catch (e) {
        setStatus({ type: 'err', msg: tp("Address {0}@{1} not found or not accepting mail", [parsed.local, MAIL_DOMAIN]) });
        setBusy(false); return;
      }

      // 2) payload. from — обраний аліас або «анонім». УВАГА: серверний
      //    mail_from (перевірений) все одно переб'є це поле в отримувача,
      //    тут from лише для локальної копії «Відправлені».
      const fromAddr = fromAlias ? `${fromAlias}@${MAIL_DOMAIN}` : t('Anonymous sender');
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        kind: 'email',
        v: 1,
        to_alias: parsed.local,
        from: fromAddr,
        subject: subject.trim() || t('(no subject)'),
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
        setStatus({ type: 'ok', msg: tp("Sent to {0}@{1}", [parsed.local, MAIL_DOMAIN]) });
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
        setStatus({ type: 'err', msg: 'Couldn\'t send' });
      }
    } catch (e) {
      setStatus({ type: 'err', msg: e?.message || t('Sending failed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ background: BG, minHeight: '100%' }}>
      <TopBar
        title={t("New email")}
        subtitle={tp("from {0}", [myPrimaryAddress || t('you')])}
        onBack={() => onNavigate('mail')}
        backIcon="arrow"
      />

      <style>{`
        .mk-in:focus { border-color: #7B96FF !important; outline: none; }
        .mk-in { transition: border-color 0.15s; }
        .mk-sel { appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23A8AAB5' stroke-width='1.8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 14px center; padding-right: 36px !important; }
      `}</style>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 32px' }}>

        <div style={{
          fontSize: 12, color: MUTED, lineHeight: 1.5, marginBottom: 16,
          background: 'rgba(123,150,255,0.06)', border: `1px solid ${BORDER}`,
          borderRadius: 12, padding: '10px 14px',
        }}>
          {parseRecipient(to)?.kind === 'external'
            ? <>{t('🔓 An external email travels as regular mail (SMTP+TLS). It is')} <b style={{ color: TEXT }}>{t('not end-to-end encrypted')}</b> {t('— the server sees the content until delivery, then erases it.')}</>
            : <>{t('🔒 Morok→Morok mail is end-to-end encrypted. External addresses (Gmail etc.) work too — just without E2E.')}</>}
        </div>

        <Field label={t("From")}>
          <select
            className="mk-in mk-sel"
            value={fromAlias ?? ''}
            onChange={(e) => setFromAlias(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {aliases.map((a) => (
              <option key={a.alias} value={a.alias}>
                {a.alias}@{MAIL_DOMAIN}{a.primary ? ' (primary)' : ''}
              </option>
            ))}
            <option value="">{t('Anonymously (no address)')}</option>
          </select>
        </Field>

        <Field label={t("To")}>
          <input
            className="mk-in"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={tp("nick@{0}", [MAIL_DOMAIN])}
            spellCheck={false}
            autoCapitalize="none"
            style={inputStyle}
          />
        </Field>

        <Field label={t("Subject")}>
          <input
            className="mk-in"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("No subject")}
            style={inputStyle}
          />
        </Field>

        <Field label={t("Text")}>
          <textarea
            className="mk-in"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("Your email…")}
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
              🖼 {attBusy ? t('Processing…') : t('Photo')}
              <input type="file" accept="image/*" multiple onChange={addImages}
                     disabled={attBusy} style={{ display: 'none' }} />
            </label>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`,
              borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', opacity: attBusy ? 0.6 : 1,
            }}>
              {t('📎 File')}
              <input type="file" multiple onChange={addFiles}
                     disabled={attBusy} style={{ display: 'none' }} />
            </label>
            {atts.length > 0 && (
              <span style={{ fontSize: 12, color: MUTED }}>
                {(() => {
                  const nImg = atts.filter((a) => a.isImage).length;
                  const nFile = atts.length - nImg;
                  const parts = [];
                  if (nImg) parts.push(tp("{0} photo{1}", [nImg, nImg > 1 ? 's' : '']));
                  if (nFile) parts.push(tp("{0} file{1}", [nFile, nFile > 1 ? 's' : '']));
                  const kb = Math.round(atts.reduce((s, a) => s + a.size, 0) / 1024);
                  return `${parts.join(' + ')} · ~${kb}KB`;
                })()}
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
        >{busy ? t('Sending…') : t('Send')}</button>
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
