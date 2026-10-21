/**
 * Reply.jsx — відповідь на повідомлення (дзеркало morok-rn/components/Reply.js).
 *
 *   <ReplyBar>   смужка над полем вводу: «Відповідь @ім'я» + уривок + ✕
 *   <ReplyQuote> цитата всередині бульбашки; клік → прокрутка до оригіналу
 *
 * Текст і автор цитати — ЛИШЕ з моєї локальної копії оригіналу
 * (див. lib/reply.js). Нема копії — «Повідомлення недоступне» без автора.
 */

import { quotePreview } from '../lib/reply.js';
import { t, tp } from '../lib/i18n.js';

export function ReplyBar({ authorLabel, original, onClose }) {
  return (
    <div className="reply-bar" style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 14px 0',
    }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7B96FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" />
      </svg>
      <div style={{ width: 2, alignSelf: 'stretch', borderRadius: 1, background: '#7B96FF', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#7B96FF', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {tp('Replying to {0}', [authorLabel])}
        </div>
        <div style={{ color: '#9494A0', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
          {quotePreview(original)}
        </div>
      </div>
      <button
        onClick={onClose}
        title={t('Cancel reply')}
        style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: '#1A1B23', border: '1px solid #24242E', color: '#9494A0',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
  );
}

export function ReplyQuote({ original, authorLabel, out, onClick }) {
  const missing = !original;
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
      style={{
        display: 'flex', gap: 8, cursor: missing ? 'default' : 'pointer',
        borderRadius: 8, padding: '5px 10px 5px 6px', marginBottom: 6,
        background: out ? 'rgba(255,255,255,0.14)' : 'rgba(123,150,255,0.14)',
        maxWidth: '100%', opacity: missing ? 0.6 : 1,
      }}
    >
      <div style={{ width: 2, borderRadius: 1, flexShrink: 0, background: out ? 'rgba(255,255,255,0.85)' : '#7B96FF' }} />
      <div style={{ minWidth: 0 }}>
        {!missing && authorLabel && (
          <div style={{ fontSize: 12, fontWeight: 700, color: out ? '#FFF' : '#7B96FF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {authorLabel}
          </div>
        )}
        <div style={{
          fontSize: 13, lineHeight: 1.3, marginTop: 1,
          color: out ? 'rgba(255,255,255,0.82)' : '#9494A0',
          fontStyle: missing ? 'italic' : 'normal',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {quotePreview(original)}
        </div>
      </div>
    </div>
  );
}

/** Плавно прокрутити до повідомлення в контейнері (підсвітку робить екран через стан). */
export function scrollToMessage(scroller, messageId) {
  if (!scroller || !messageId) return false;
  const el = scroller.querySelector(`[data-mid="${CSS.escape(messageId)}"]`);
  if (!el) return false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  return true;
}
