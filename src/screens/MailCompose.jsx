import { useState } from 'react';
import * as api from '../lib/api.js';
import * as crypto from '../lib/crypto.js';
import * as vault from '../lib/vault.js';
import * as mailStore from '../lib/mail_store.js';
import { TopBar } from '../components/ui.jsx';

const ACCENT = '#7B96FF';
const BG = '#0A0A0B';
const SURFACE = '#16161B';
const BORDER = '#232329';
const TEXT = '#F5F5F7';
const MUTED = '#8A8A96';

const MAIL_DOMAIN = 'morok.email';

// «щось@morok.email» або «щось» → local-part; чужі домени відсікаємо
function extractLocal(input) {
  const v = (input || '').trim().toLowerCase();
  if (!v) return null;
  if (v.includes('@')) {
    const [local, dom] = v.split('@');
    if (dom !== MAIL_DOMAIN) return { error: `Внутрішня пошта — тільки @${MAIL_DOMAIN}. Для зовнішніх адрес відправка зʼявиться пізніше.` };
    return { local };
  }
  return { local: v };
}

export default function MailCompose({ onNavigate, myPrimaryAddress }) {
  const _draft = typeof window !== 'undefined' ? window.__morokMailDraft : null;
  if (typeof window !== 'undefined') window.__morokMailDraft = null;
  const [to, setTo] = useState(_draft?.to || '');
  const [subject, setSubject] = useState(_draft?.subject || '');
  const [text, setText] = useState(_draft?.text || '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);   // {type:'ok'|'err', msg}

  async function send() {
    setStatus(null);
    const parsed = extractLocal(to);
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

      // 1) резолв адресата → його pubkey
      let res;
      try {
        res = await api.mailResolve(parsed.local);
      } catch (e) {
        setStatus({ type: 'err', msg: `Адресу ${parsed.local}@${MAIL_DOMAIN} не знайдено або вона не приймає пошту` });
        setBusy(false); return;
      }

      // 2) payload у форматі скриньки (як зовнішній лист)
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        kind: 'email',
        v: 1,
        to_alias: parsed.local,
        from: myPrimaryAddress || 'Morok',
        subject: subject.trim() || '(без теми)',
        date: new Date().toUTCString(),
        text: text,
        html: null,
        attachments: [],
        spf: 'internal',           // внутрішній лист — довірений за визначенням
        received_at: now,
      };

      // 3) шифруємо на pubkey адресата (E2EE) і відправляємо
      const blobB64 = crypto.mailSeal({ recipientPubkeyHex: res.pubkey_hex, payload });
      const r = await api.mailSendInternal({ toAlias: parsed.local, blobB64 });

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

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 32px' }}>

        <div style={{
          fontSize: 12, color: MUTED, lineHeight: 1.5, marginBottom: 16,
          background: 'rgba(123,150,255,0.06)', border: `1px solid ${BORDER}`,
          borderRadius: 12, padding: '10px 14px',
        }}>
          🔒 Внутрішні листи Morok→Morok шифруються наскрізно й ідуть без
          зовнішньої пошти. Наразі доступні лише адреси <b style={{ color: TEXT }}>@{MAIL_DOMAIN}</b>.
        </div>

        <Field label="Кому">
          <input
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
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Без теми"
            style={inputStyle}
          />
        </Field>

        <Field label="Текст">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ваш лист…"
            rows={10}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 180, lineHeight: 1.5 }}
          />
        </Field>

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
