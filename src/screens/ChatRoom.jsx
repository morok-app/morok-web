import { useEffect, useRef, useState } from 'react';
import * as convs from '../lib/conversations.js';
import * as msgs from '../lib/messages.js';
import * as store from '../lib/storage.js';
import { hexToBytes } from '../lib/crypto.js';

const TTL_OPTIONS = [
  { label: '1 година', seconds: 3600 },
  { label: '1 день', seconds: 86400 },
  { label: '7 днів', seconds: 7 * 86400 },
  { label: '30 днів', seconds: 30 * 86400 },
];

function fmtClock(unix) {
  const d = new Date(unix * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtTTLLeft(expires_at) {
  if (!expires_at) return '';
  const left = expires_at - Math.floor(Date.now() / 1000);
  if (left <= 0) return 'зник';
  if (left < 60) return `${left}с`;
  if (left < 3600) return `${Math.floor(left / 60)}хв`;
  if (left < 86400) return `${Math.floor(left / 3600)}г`;
  return `${Math.floor(left / 86400)}д`;
}

export default function ChatRoom({ peerPubkey, onNavigate }) {
  const me = store.loadIdentity();
  const profile = store.loadProfile();
  const [conv, setConv] = useState(() => convs.getConversation(peerPubkey));
  const [draft, setDraft] = useState('');
  const [ttlSeconds, setTtlSeconds] = useState(86400); // default 24h
  const [sending, setSending] = useState(false);
  const [showTtlMenu, setShowTtlMenu] = useState(false);
  const messagesEnd = useRef(null);

  // Refresh every 2s — picks up incoming messages stored by App-level WS handler
  useEffect(() => {
    const id = setInterval(() => {
      setConv(convs.getConversation(peerPubkey));
    }, 2000);
    return () => clearInterval(id);
  }, [peerPubkey]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conv?.messages?.length]);

  async function sendClicked() {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await msgs.sendDM({
        seed: hexToBytes(me.seed_hex),
        myPubkeyHex: me.pubkey_hex,
        peerPubkeyHex: peerPubkey,
        plaintext: draft.trim(),
        ttlSeconds,
      });
      setDraft('');
      setConv(convs.getConversation(peerPubkey));
    } catch (e) {
      alert(`Помилка надсилання: ${e.message}`);
    } finally {
      setSending(false);
    }
  }

  if (!conv) {
    return (
      <div className="screen">
        <div className="topbar">
          <div className="back" onClick={() => onNavigate('chats')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </div>
          <div className="title">Чат</div>
        </div>
        <div className="empty-state">
          <div className="desc">Чат не знайдено</div>
        </div>
      </div>
    );
  }

  const messages = conv.messages || [];

  return (
    <div className="screen">
      <div className="topbar">
        <div className="back" onClick={() => onNavigate('chats')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
            @{conv.peer_username || conv.peer_pubkey.slice(0, 12) + '…'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {conv.peer_home_relay || 'невідомий relay'}
          </div>
        </div>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '14px 12px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, marginTop: 32 }}>
            Поки немає повідомлень.<br/>Напишіть перше повідомлення нижче.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              maxWidth: '78%',
              alignSelf: m.direction === 'out' ? 'flex-end' : 'flex-start',
              display: 'flex', flexDirection: 'column', gap: 3,
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 16,
                fontSize: 13.5,
                lineHeight: 1.4,
                wordWrap: 'break-word',
                background: m.direction === 'out' ? 'var(--bubble-out)' : 'var(--bubble-in)',
                color: m.direction === 'out' ? '#FFF' : 'var(--text)',
                borderBottomRightRadius: m.direction === 'out' ? 5 : 16,
                borderBottomLeftRadius: m.direction === 'in' ? 5 : 16,
              }}
            >
              {m.status === 'undecryptable' ? <span style={{ opacity: 0.7 }}>⚠ {m.error}</span> : m.text}
            </div>
            <div style={{
              fontSize: 10, color: 'var(--text-faint)',
              fontFamily: 'var(--mono)', padding: '0 4px',
              display: 'flex', gap: 4,
              alignSelf: m.direction === 'out' ? 'flex-end' : 'flex-start',
            }}>
              <span>{fmtClock(m.ts)}</span>
              {m.expires_at && <span>· ⏱ {fmtTTLLeft(m.expires_at)}</span>}
              {m.direction === 'out' && (
                <span style={{ color: 'var(--accent)' }}>
                  · {m.status === 'sending' ? '...' : m.status === 'sent' ? '✓' : m.status === 'failed' ? '✗' : ''}
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEnd} />
      </div>

      {/* TTL selector */}
      {showTtlMenu && (
        <div
          onClick={() => setShowTtlMenu(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 50,
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', background: 'var(--surface)',
              borderTopLeftRadius: 22, borderTopRightRadius: 22,
              padding: '12px 0 28px',
            }}
          >
            <div style={{ width: 32, height: 4, background: 'var(--text-faint)', borderRadius: 2, margin: '6px auto 14px', opacity: 0.4 }} />
            <div style={{ fontSize: 15, fontWeight: 700, padding: '0 18px 14px' }}>
              Як довго зберігати повідомлення?
            </div>
            {TTL_OPTIONS.map((opt) => (
              <div
                key={opt.seconds}
                onClick={() => { setTtlSeconds(opt.seconds); setShowTtlMenu(false); }}
                style={{
                  padding: '14px 18px',
                  display: 'flex', justifyContent: 'space-between',
                  cursor: 'pointer',
                  color: ttlSeconds === opt.seconds ? 'var(--accent)' : 'var(--text)',
                }}
              >
                <span>{opt.label}</span>
                {ttlSeconds === opt.seconds && <span>✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Composer */}
      <div style={{
        padding: '10px 10px',
        display: 'flex', gap: 7, alignItems: 'flex-end',
        borderTop: '1px solid var(--border)',
      }}>
        <button
          onClick={() => setShowTtlMenu(true)}
          style={{
            background: 'transparent', border: 'none',
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-dim)', cursor: 'pointer',
            fontSize: 10, fontFamily: 'var(--mono)',
          }}
          title="Час життя повідомлення"
        >
          ⏱{ttlSeconds < 86400 ? `${ttlSeconds / 3600}г` : `${ttlSeconds / 86400}д`}
        </button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendClicked();
            }
          }}
          placeholder="Повідомлення..."
          rows={1}
          style={{
            flex: 1, minHeight: 36, maxHeight: 100,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: '8px 14px',
            color: 'var(--text)',
            fontSize: 14, fontFamily: 'var(--font)',
            outline: 'none', resize: 'none',
          }}
        />
        <button
          onClick={sendClicked}
          disabled={!draft.trim() || sending}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--accent)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: draft.trim() && !sending ? 1 : 0.5,
            cursor: draft.trim() && !sending ? 'pointer' : 'not-allowed',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
