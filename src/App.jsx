import { useEffect, useRef, useState } from 'react';
import * as api from './lib/api.js';
import * as store from './lib/storage.js';
import * as msgs from './lib/messages.js';
import * as convs from './lib/conversations.js';
import { hexToBytes } from './lib/crypto.js';
import { InboxClient } from './lib/inbox.js';

import Splash from './screens/Splash.jsx';
import Welcome from './screens/Welcome.jsx';
import CreateAccount from './screens/CreateAccount.jsx';
import LoginByMnemonic from './screens/LoginByMnemonic.jsx';
import ClaimUsername from './screens/ClaimUsername.jsx';
import ChatsList from './screens/ChatsList.jsx';
import NewChat from './screens/NewChat.jsx';
import ChatRoom from './screens/ChatRoom.jsx';
import Profile from './screens/Profile.jsx';

const PENDING_KEY = 'morok.pending_route.v1';

/**
 * If user lands on a deep-link like #newchat?u=kaban@relay1.morok.app but
 * isn't authed yet, save the intent and restore after claim.
 */
function savePendingIfDeepLink(hash) {
  if (!hash) return;
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  if (cleaned.startsWith('newchat?')) {
    try { sessionStorage.setItem(PENDING_KEY, cleaned); } catch {}
  }
}

function consumePending() {
  try {
    const v = sessionStorage.getItem(PENDING_KEY);
    if (v) sessionStorage.removeItem(PENDING_KEY);
    return v;
  } catch { return null; }
}

export default function App() {
  const [route, setRoute] = useState('splash');
  const [routeArg, setRouteArg] = useState(null);
  const [bootError, setBootError] = useState(null);
  const inboxRef = useRef(null);

  // Parse hash
  useEffect(() => {
    function parseHash() {
      const raw = (window.location.hash || '#splash').slice(1);
      const [path, qs] = raw.split('?');
      const parts = path.split('/');
      setRoute(parts[0] || 'splash');
      setRouteArg(parts[1] || qs || null);
    }
    parseHash();
    window.addEventListener('hashchange', parseHash);
    return () => window.removeEventListener('hashchange', parseHash);
  }, []);

  // Boot: restore session, fetch profile, set route
  useEffect(() => {
    // Capture pending deep-link BEFORE we overwrite the hash
    savePendingIfDeepLink(window.location.hash);

    (async () => {
      try {
        const identity = store.loadIdentity();
        if (!identity) { navigate('welcome'); return; }

        const seed = hexToBytes(identity.seed_hex);
        const session = await api.login({
          seed, pubkeyHex: identity.pubkey_hex,
        });
        store.saveSession({
          token: session.session_token,
          pubkeyHex: session.pubkey_hex,
          expiresAt: session.expires_at,
          relayUrl: api.getRelayUrl(),
        });

        const me = await api.getMe();
        store.saveProfile({
          username: me.username, tier: me.tier, homeRelay: me.home_relay,
        });

        if (!me.username) {
          navigate('claim');
        } else {
          startInbox(seed, identity.pubkey_hex);
          // Restore deep-link if any
          const pending = consumePending();
          if (pending) {
            window.location.hash = `#${pending}`;
          } else {
            navigate('chats');
          }
        }
      } catch (e) {
        console.error('Boot failed:', e);
        setBootError(e.message || String(e));
        if (e.status === 401 || e.status === 403) {
          store.clearSession();
          navigate('welcome');
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => inboxRef.current?.stop(), []);

  function startInbox(seed, myPubkeyHex) {
    if (inboxRef.current) inboxRef.current.stop();
    const client = new InboxClient({
      onCatchup: async (envelopes) => {
        for (const env of envelopes) {
          try {
            await msgs.processIncoming({ envMeta: env, seed, myPubkeyHex });
            client.ack(env.envelope_id);
          } catch (e) {
            console.warn('catchup processing failed:', e);
          }
        }
      },
      onNew: async (env) => {
        try {
          await msgs.processIncoming({ envMeta: env, seed, myPubkeyHex });
          client.ack(env.envelope_id);
        } catch (e) {
          console.warn('new processing failed:', e);
        }
      },
      onStateChange: (s) => console.info('inbox state:', s),
    });
    client.start();
    inboxRef.current = client;
  }

  function navigate(to) {
    window.location.hash = `#${to}`;
  }

  // After ClaimUsername redirects to 'chats', honor pending deep-link instead
  useEffect(() => {
    if (route !== 'chats') return;
    const pending = consumePending();
    if (pending) {
      window.location.hash = `#${pending}`;
    }
  }, [route]);

  if (bootError && route === 'splash') {
    return (
      <div className="screen splash">
        <div className="logo">M</div>
        <div className="name">morok</div>
        <div style={{ color: 'var(--danger)', fontSize: 13, padding: '0 24px', textAlign: 'center' }}>
          {bootError}
        </div>
        <button
          className="btn btn-secondary"
          style={{ maxWidth: 240, marginTop: 8 }}
          onClick={() => { setBootError(null); window.location.reload(); }}
        >
          Спробувати ще
        </button>
      </div>
    );
  }

  // Defer inbox start if just landed on chats
  if (route === 'chats' && !inboxRef.current) {
    const identity = store.loadIdentity();
    if (identity?.seed_hex && identity?.pubkey_hex) {
      Promise.resolve().then(() => {
        if (!inboxRef.current) {
          startInbox(hexToBytes(identity.seed_hex), identity.pubkey_hex);
        }
      });
    }
  }

  switch (route) {
    case 'splash': return <Splash />;
    case 'welcome': return <Welcome onNavigate={navigate} />;
    case 'create': return <CreateAccount onNavigate={navigate} />;
    case 'login': return <LoginByMnemonic onNavigate={navigate} />;
    case 'claim': return <ClaimUsername onNavigate={navigate} />;
    case 'chats': return <ChatsList onNavigate={navigate} />;
    case 'newchat': return <NewChat onNavigate={navigate} routeArg={routeArg} />;
    case 'profile': return <Profile onNavigate={navigate} />;
    case 'chat':
      if (!routeArg) { navigate('chats'); return <Splash />; }
      return <ChatRoom peerPubkey={routeArg} onNavigate={navigate} />;
    default: return <Splash />;
  }
}
