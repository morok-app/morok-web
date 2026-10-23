/**
 * ChatExtras.jsx — дзеркало morok-rn/components/{RichText,ChatExtras}.js
 * + ForwardModal (у RN це окремий екран ForwardPicker).
 *
 *   <RichText>     текст зі спойлерами ||…|| (клік відкриває)
 *   <ForwardLabel> «↪ Переслано (від @нік)»
 *   <EditBar>      смужка «Редагування» над полем вводу
 *   <SearchBar>    шапка пошуку в чаті (Enter — старіший, Shift+Enter — новіший, Esc — закрити)
 *   <SpoilerButton>кнопка «приховати виділене»
 *   <ForwardModal> вибір чату для пересилання
 */

import { useMemo, useState } from 'react';
import { t, tp } from '../lib/i18n.js';
import { splitSpoilers, maskSpoilers, forwardableOf, forwardTtl } from '../lib/msgfx.js';
import * as convs from '../lib/conversations.js';
import * as gstore from '../lib/group_storage.js';
import * as contacts from '../lib/contacts.js';
import * as msgs from '../lib/messages.js';
import * as groups from '../lib/groups.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { hexToBytes } from '../lib/crypto.js';

export function RichText({ text, out }) {
  const [open, setOpen] = useState(false);
  const parts = splitSpoilers(text || '');
  if (!parts.some((p) => p.spoiler)) return <>{text}</>;
  const veil = out ? 'rgba(255,255,255,0.34)' : 'rgba(236,236,240,0.22)';
  return (
    <>
      {parts.map((p, i) => {
        if (!p.spoiler) return <span key={i}>{p.t}</span>;
        if (open) return <span key={i} style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>{p.t}</span>;
        const n = Math.min(24, Math.max(4, [...p.t].length));
        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            aria-label={t('Hidden text. Click to show')}
            title={t('Hidden text. Click to show')}
            className="spoiler"
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(true); } }}
            style={{ background: veil, color: 'transparent', borderRadius: 4, cursor: 'pointer', letterSpacing: 1, userSelect: 'none' }}
          >
            {'░'.repeat(n)}
          </span>
        );
      })}
    </>
  );
}

export function ForwardLabel({ fwd, out, pad }) {
  if (!fwd) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4,
      padding: pad ? '4px 6px 0' : 0,
      fontSize: 12, fontWeight: 600, fontStyle: 'italic',
      color: out ? 'rgba(255,255,255,0.78)' : '#A8A8B0',
    }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" /></svg>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {fwd.name ? tp('Forwarded from {0}', [fwd.name]) : t('Forwarded')}
      </span>
    </div>
  );
}

export function EditBar({ original, onClose }) {
  return (
    <div className="reply-bar" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px 0' }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7B96FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      <div style={{ width: 2, alignSelf: 'stretch', borderRadius: 1, background: '#7B96FF', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#7B96FF', fontSize: 12.5, fontWeight: 700 }}>{t('Editing')}</div>
        <div style={{ color: '#9494A0', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
          {maskSpoilers(original?.text || '')}
        </div>
      </div>
      <button onClick={onClose} title={t('Cancel editing')} style={closeBtn}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
  );
}

const closeBtn = {
  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
  background: '#1A1B23', border: '1px solid #24242E', color: '#9494A0',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};

const roundBtn = {
  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
  background: '#16161B', border: '1px solid #232329', color: '#A8A8B0', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export function SearchButton({ onClick }) {
  return (
    <button onClick={onClick} title={t('Search in chat (Ctrl+F)')} aria-label={t('Search in chat (Ctrl+F)')} style={roundBtn}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
    </button>
  );
}

export function SearchBar({ query, onChange, index, total, onPrev, onNext, onClose }) {
  const has = total > 0;
  return (
    <div className="dt-chat-header" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #1E1E27', background: '#0A0A0B' }}>
      <button onClick={onClose} title={t('Close search')} style={roundBtn}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <input
        autoFocus
        data-chat-search
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
          if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) onNext(); else onPrev(); }
        }}
        placeholder={t('Search in chat')}
        style={{
          flex: 1, minWidth: 0, height: 34, background: '#13131A', border: '1px solid #232329', borderRadius: 17,
          padding: '0 14px', color: '#F5F5F7', fontSize: 14.5, fontFamily: 'inherit', outline: 'none',
        }}
      />
      <span style={{ minWidth: 40, textAlign: 'center', fontSize: 12.5, fontFamily: 'var(--mono, monospace)', color: query && !has ? '#FF6B7A' : '#A8A8B0' }}>
        {query ? (has ? `${Math.min(index, total - 1) + 1}/${total}` : '0') : ''}
      </span>
      <button onClick={onPrev} disabled={!has} title={t('Older')} style={{ ...roundBtn, opacity: has ? 1 : 0.35 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
      </button>
      <button onClick={onNext} disabled={!has} title={t('Newer')} style={{ ...roundBtn, opacity: has ? 1 : 0.35 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
    </div>
  );
}

export function SpoilerButton({ onClick }) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}   /* не забирати фокус і виділення з поля */
      onClick={onClick}
      title={t('Hide selected text (spoiler)')}
      aria-label={t('Hide selected text (spoiler)')}
      style={{
        background: '#13131A', border: '1px solid #232329', width: 38, height: 38, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7B96FF', cursor: 'pointer', flexShrink: 0,
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    </button>
  );
}

function getSeed() {
  const v = vault.getUnlockedSeed();
  if (v) return v;
  const id = store.loadIdentity();
  if (id && !id.encrypted && id.seed_hex) return hexToBytes(id.seed_hex);
  return null;
}

/**
 * Переслати повідомлення. message — локальне повідомлення; authorName —
 * «@нік» автора (якщо відомий). Автор за замовчуванням НЕ показується.
 * onDone(route) — куди перейти після відправки (`chat/<pk>` / `group/<id>`).
 */
export function ForwardModal({ message, authorName, onClose, onDone }) {
  const item = useMemo(() => forwardableOf(message), [message]);
  const [query, setQuery] = useState('');
  const [showAuthor, setShowAuthor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const targets = useMemo(() => {
    const out = [];
    for (const c of convs.listConversations()) {
      if (!c.peer_pubkey || String(c.peer_username || '').startsWith('🔥burner')) continue;
      if (contacts.isBlocked(c.peer_pubkey)) continue;
      out.push({ key: `dm:${c.peer_pubkey}`, kind: 'dm', id: c.peer_pubkey, name: c.peer_username ? `@${c.peer_username}` : `${c.peer_pubkey.slice(0, 10)}…`, ts: c.updated_at || 0 });
    }
    for (const g of gstore.listGroups()) {
      if (!g.group_key_b64) continue;
      const last = g.messages?.[g.messages.length - 1];
      out.push({ key: `g:${g.group_id}`, kind: 'group', id: g.group_id, name: g.name || t('Group'), ts: last?.ts || g.updated_at || 0, ttl: g.default_ttl_seconds });
    }
    out.sort((a, b) => b.ts - a.ts);
    const q = query.trim().toLowerCase();
    return q ? out.filter((x) => x.name.toLowerCase().includes(q)) : out;
  }, [query]);

  async function send(tg) {
    if (!item || busy) return;
    const seed = getSeed();
    const myPubkeyHex = store.loadProfile()?.pubkey_hex || store.loadIdentity()?.pubkey_hex;
    if (!seed || !myPubkeyHex) { setErr(t('Session expired. Reload the page.')); return; }
    const fwd = showAuthor && authorName ? { name: authorName } : true;
    setBusy(true); setErr(null);
    try {
      if (tg.kind === 'dm') {
        const base = { seed, myPubkeyHex, peerPubkeyHex: tg.id, ttlSeconds: forwardTtl(message, 86400), fwd };
        if (item.kind === 'text') await msgs.sendDM({ ...base, plaintext: item.text });
        else if (item.kind === 'image') await msgs.sendDMImage({ ...base, file: null, caption: item.caption, preEncoded: item.image });
        else await msgs.sendDMVoice({ ...base, audioBlob: null, preEncoded: item.voice });
      } else {
        const base = { groupId: tg.id, seed, myPubkeyHex, ttlSeconds: forwardTtl(message, tg.ttl || 86400), fwd };
        if (item.kind === 'text') await groups.sendGroupMessage({ ...base, text: item.text });
        else if (item.kind === 'image') await groups.sendGroupImage({ ...base, file: null, caption: item.caption, preEncoded: item.image });
        else await groups.sendGroupVoice({ ...base, audioBlob: null, preEncoded: item.voice });
      }
      vault.refreshSession();
      onDone(tg.kind === 'dm' ? `chat/${tg.id}` : `group/${tg.id}`);
    } catch (e) {
      setBusy(false);
      setErr(tp('Could not forward: {0}', [e?.message || '']));
    }
  }

  const preview = !item ? '' : item.kind === 'voice' ? t('🎤 Voice message')
    : item.kind === 'image' ? (item.caption ? `📷 ${maskSpoilers(item.caption)}` : t('📷 Image'))
    : maskSpoilers(item.text);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
        style={{ width: '100%', maxWidth: 420, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: '#13131A', border: '1px solid #232329', borderRadius: 16, overflow: 'hidden' }}
      >
        <div style={{ padding: '16px 18px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 700, color: '#F5F5F7' }}>{t('Forward')}</div>
          <button onClick={onClose} title={t('Close')} style={closeBtn}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        {!item ? (
          <div style={{ padding: 20, color: '#A8A8B0', fontSize: 14 }}>{t('This message cannot be forwarded.')}</div>
        ) : (
          <>
            <div style={{ margin: '0 16px 10px', padding: '10px 12px', borderRadius: 12, background: '#0E0E12', border: '1px solid #232329', color: '#A8A8B0', fontSize: 13.5, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {preview}
            </div>
            {authorName && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 18px 10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={showAuthor} onChange={(e) => setShowAuthor(e.target.checked)} />
                <span style={{ fontSize: 13.5, color: '#F5F5F7' }}>
                  {t('Show the author')}
                  <span style={{ display: 'block', fontSize: 12, color: '#9EA0AC', marginTop: 2 }}>
                    {showAuthor ? tp('The recipient will see "Forwarded from {0}"', [authorName]) : t('The recipient will only see "Forwarded"')}
                  </span>
                </span>
              </label>
            )}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Forward to…')}
              style={{ margin: '0 16px 8px', height: 36, background: '#0E0E12', border: '1px solid #232329', borderRadius: 18, padding: '0 14px', color: '#F5F5F7', fontSize: 14.5, fontFamily: 'inherit', outline: 'none' }}
            />
            {err && <div style={{ margin: '0 18px 8px', color: '#FF6B7A', fontSize: 13 }}>{err}</div>}
            <div style={{ overflowY: 'auto', paddingBottom: 8 }}>
              {targets.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#9EA0AC', fontSize: 13.5 }}>{t('Nobody found')}</div>}
              {targets.map((tg) => (
                <button
                  key={tg.key}
                  disabled={busy}
                  onClick={() => send(tg)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', background: 'transparent', border: 'none', color: '#F5F5F7', fontSize: 14.5, fontWeight: 600, textAlign: 'left', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#1A1A22'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, background: `hsl(${parseInt(tg.id.replace(/-/g, '').slice(0, 6), 16) % 360} 50% 40%)` }}>
                    {tg.kind === 'group' ? '👥' : (tg.name.replace('@', '')[0] || '?').toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tg.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
