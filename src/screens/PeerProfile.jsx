/**
 * Peer profile screen.
 *
 * Shown when the user taps a peer's header in ChatRoom or a peer's name
 * in a group chat (in a later track). Displays whatever we know about
 * the peer locally, and if we know their username, opportunistically
 * refreshes via /users/lookup to fill in missing fields (e.g. home_relay).
 *
 * Does NOT require an existing conversation — works for "discovered"
 * peers (e.g. from groups) too. "Написати" creates a local conversation
 * stub so the chat shows up in ChatsList.
 */
import { useEffect, useState } from 'react';
import * as convs from '../lib/conversations.js';
import * as api from '../lib/api.js';
import * as contacts from '../lib/contacts.js';
import * as safety from '../lib/safety.js';
import Avatar from '../components/Avatar.jsx';
import { t } from '../lib/i18n.js';

export default function PeerProfile({ peerPubkey, onNavigate }) {
  const [conv, setConv] = useState(() => convs.getConversation(peerPubkey));
  const [copied, setCopied] = useState(false);
  const [lookupTried, setLookupTried] = useState(false);
  const [inContacts, setInContacts] = useState(() => contacts.isInContacts(peerPubkey));
  const [blocked, setBlocked] = useState(() => contacts.isBlocked(peerPubkey));
  const [confirmBlock, setConfirmBlock] = useState(false);

  // Opportunistic background lookup: if we have a username, refresh
  // profile info (home_relay especially) so the page completes itself.
  useEffect(() => {
    if (lookupTried) return;
    const username = conv?.peer_username;
    if (!username) return;
    // Already complete — nothing to refresh
    if (conv?.peer_home_relay) return;

    setLookupTried(true);
    api.lookupUsername(username, conv?.peer_home_relay || undefined)
      .then((profile) => {
        if (!profile) return;
        // Only trust if pubkey matches what we already know
        if (profile.pubkey_hex && profile.pubkey_hex !== peerPubkey) return;
        convs.ensureConversation({
          peerPubkey,
          peerUsername: profile.username || username,
          peerHomeRelay: profile.home_relay,
        });
        setConv(convs.getConversation(peerPubkey));
      })
      .catch(() => { /* best-effort */ });
  }, [peerPubkey, conv, lookupTried]);

  const username = conv?.peer_username;
  const homeRelay = conv?.peer_home_relay;

  async function copyPubkey() {
    try {
      await navigator.clipboard.writeText(peerPubkey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Old-school fallback
      const ta = document.createElement('textarea');
      ta.value = peerPubkey;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  function writeMessage() {
    // Make sure the conversation exists so it shows in ChatsList even
    // before the first message is sent.
    if (!conv) {
      convs.ensureConversation({
        peerPubkey,
        peerUsername: username,
        peerHomeRelay: homeRelay,
      });
    }
    onNavigate(`chat/${peerPubkey}`);
  }

  function toggleContact() {
    if (inContacts) {
      contacts.removeFromContacts(peerPubkey);
      setInContacts(false);
    } else {
      contacts.addToContacts({
        pubkey_hex: peerPubkey,
        username,
        home_relay: homeRelay,
      });
      setInContacts(true);
      // If we had blocked them earlier, adding to contacts implicitly
      // unblocks (blockPeer/addContact are mutually exclusive states).
      if (blocked) {
        contacts.unblockPeer(peerPubkey);
        setBlocked(false);
      }
    }
  }

  // Auto-disarm block confirmation after 5s
  useEffect(() => {
    if (!confirmBlock) return undefined;
    const t = setTimeout(() => setConfirmBlock(false), 5000);
    return () => clearTimeout(t);
  }, [confirmBlock]);

  function blockClicked() {
    if (blocked) {
      // Unblock — single click, no confirmation needed
      contacts.unblockPeer(peerPubkey);
      setBlocked(false);
      return;
    }
    if (!confirmBlock) {
      setConfirmBlock(true);
      return;
    }
    contacts.blockPeer(peerPubkey);
    setBlocked(true);
    setInContacts(false);   // blockPeer cascades a removeContact
    setConfirmBlock(false);

    // Відкликати sealed-токен, виданий цьому контакту: тепер він
    // криптографічно не зможе слати мені sealed (релей відкине його
    // конверти). Інші контакти не зачеплені. Fire-and-forget.
    import('../lib/sealed_tokens.js')
      .then((m) => m.revokeMyTokenFor(peerPubkey))
      .catch(() => {});
  }

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>
      {/* Top bar */}
      <div style={{
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: '1px solid #1E1E27',
        background: '#0A0A0B',
      }}>
        <button
          onClick={() => onNavigate('chats')}
          style={{
            width: 34, height: 34, borderRadius: '50%',
            background: '#16161B', border: '1px solid #232329',
            color: '#A8A8B0', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
          aria-label={t("Back")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div style={{
          fontSize: 14.5, fontWeight: 700, color: '#F5F5F7',
          letterSpacing: '-0.01em',
        }}>
          {t('Profile')}
        </div>
      </div>

      {/* Hero: avatar + name */}
      <div style={{
        padding: '36px 24px 24px',
        textAlign: 'center',
      }}>
        <div style={{ margin: '0 auto 18px', width: 96 }}>
          <Avatar username={username} pubkey={peerPubkey} size={96} />
        </div>

        <div style={{
          fontSize: 22, fontWeight: 700, color: '#F5F5F7',
          letterSpacing: '-0.01em',
          wordBreak: 'break-word',
        }}>
          {username ? `@${username}` : t('Anonymous')}
        </div>

        {homeRelay && (
          <div style={{
            fontSize: 13, color: '#ABADB8',
            marginTop: 6,
            letterSpacing: '-0.005em',
          }}>
            {homeRelay}
          </div>
        )}
      </div>

      {/* Pubkey card */}
      <div style={{ padding: '0 20px' }}>
        <div style={{
          background: '#13131A',
          border: '1px solid #232329',
          borderRadius: 12,
          padding: '14px 16px',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 10,
          }}>
            <div style={{
              fontSize: 12.5, color: '#A4A6B2',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
            }}>
              {t('Public key')}
            </div>
            <button
              onClick={copyPubkey}
              style={{
                background: copied ? 'rgba(67, 209, 122, 0.12)' : '#1C1C21',
                border: copied ? '1px solid rgba(67, 209, 122, 0.3)' : '1px solid #2A2A33',
                color: copied ? '#43D17A' : '#A8A8B0',
                fontSize: 12, fontWeight: 600,
                padding: '5px 10px', borderRadius: 7,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
                letterSpacing: '0.02em',
              }}
            >
              {copied ? t('Copied') : t('Copy')}
            </button>
          </div>
          <div
            onClick={copyPubkey}
            style={{
              fontSize: 12, fontFamily: 'var(--mono, monospace)',
              color: '#D5D5DA', wordBreak: 'break-all',
              cursor: 'pointer',
              lineHeight: 1.5,
              letterSpacing: '0.01em',
            }}
            title={t("Tap to copy")}
          >
            {peerPubkey}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{
        padding: '24px 20px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <button
          onClick={writeMessage}
          style={{
            height: 48, borderRadius: 12,
            background: '#6B8AFE', color: '#fff',
            border: 'none', cursor: 'pointer',
            fontSize: 14.5, fontWeight: 600,
            letterSpacing: '-0.005em',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          {t('Write a message')}
        </button>

        <button
          onClick={toggleContact}
          disabled={blocked}
          style={{
            height: 44, borderRadius: 12,
            background: inContacts ? 'rgba(74, 222, 128, 0.08)' : '#13131A',
            border: '1px solid ' + (inContacts ? 'rgba(74, 222, 128, 0.3)' : '#232329'),
            color: inContacts ? '#4ADE80' : (blocked ? '#5A5A65' : '#F5F5F7'),
            cursor: blocked ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 600,
            fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: blocked ? 0.6 : 1,
          }}
        >
          {inContacts ? t('✓ In contacts') : t('+ Add to contacts')}
        </button>

        <button
          onClick={() => onNavigate(`safety/${peerPubkey}`)}
          style={{
            height: 44, borderRadius: 12,
            background: safety.isVerified(peerPubkey) ? 'rgba(74, 222, 128, 0.08)' : '#13131A',
            border: '1px solid ' + (safety.isVerified(peerPubkey) ? 'rgba(74, 222, 128, 0.3)' : '#232329'),
            color: safety.isVerified(peerPubkey) ? '#4ADE80' : '#F5F5F7',
            cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            {safety.isVerified(peerPubkey) && <polyline points="9 12 11 14 15 10" />}
          </svg>
          {safety.isVerified(peerPubkey) ? t('Keys verified') : t('Safety number (verify keys)')}
        </button>

        <button
          onClick={blockClicked}
          style={{
            height: 44, borderRadius: 12,
            background: confirmBlock ? '#FF4A5C' : 'transparent',
            border: '1px solid ' + (confirmBlock ? '#FF4A5C' : (blocked ? 'rgba(255, 107, 122, 0.3)' : '#232329')),
            color: confirmBlock ? '#FFFFFF' : (blocked ? '#4ADE80' : '#FF6B7A'),
            cursor: 'pointer',
            fontSize: 13.5, fontWeight: 600,
            fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {confirmBlock
            ? t('🚫 Tap again to block')
            : (blocked ? t('✓ Unlock') : t('🚫 Block'))}
        </button>
      </div>
    </div>
  );
}
