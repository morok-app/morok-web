import { getLang, setLang } from '../lib/i18n.js';

/**
 * Перемикач мови UA|EN — плаваючий пілл. Використовується на екранах
 * входу/реєстрації (правий верхній кут) і в Налаштуваннях (inline).
 * Зміна мови перезавантажує сторінку (див. i18n.js) — стан цих екранів
 * втратити не шкода, вони початкові.
 */
export default function LangSwitch({ inline = false }) {
  const lang = getLang();
  const opt = (code, label) => (
    <button
      key={code}
      onClick={() => { if (lang !== code) setLang(code); }}
      style={{
        border: 'none',
        background: lang === code ? 'var(--accent, #6B8AFE)' : 'transparent',
        color: lang === code ? '#fff' : 'var(--text-dim, #A4A6B2)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
        padding: '5px 10px',
        borderRadius: 7,
        cursor: 'pointer',
      }}
    >{label}</button>
  );
  return (
    <div
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 3,
        borderRadius: 10,
        background: 'rgba(128,128,150,0.12)',
        border: '1px solid rgba(128,128,150,0.18)',
        ...(inline ? {} : {
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
          right: 14,
          zIndex: 5,
        }),
      }}
      aria-label="Language"
    >
      {opt('uk', 'УКР')}
      {opt('en', 'EN')}
    </div>
  );
}
