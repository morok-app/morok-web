import { useEffect, useState } from 'react';
import * as api from './lib/api.js';
import * as store from './lib/storage.js';
import { hexToBytes } from './lib/crypto.js';

import Splash from './screens/Splash.jsx';
import Welcome from './screens/Welcome.jsx';
import CreateAccount from './screens/CreateAccount.jsx';
import LoginByMnemonic from './screens/LoginByMnemonic.jsx';
import ClaimUsername from './screens/ClaimUsername.jsx';
import ChatsList from './screens/ChatsList.jsx';

/**
 * Routes (using hash-based routing, no react-router for now):
 *   #splash       — initial loading screen
 *   #welcome      — pre-auth landing
 *   #create       — generate new identity
 *   #login        — restore identity from 24-word mnemonic
 *   #claim        — first-time username claim
 *   #chats        — main app, post-auth
 */

export default function App() {
  const [route, setRoute] = useState('splash');
  const [bootError, setBootError] = useState(null);

  // Hash-based router
  useEffect(() => {
    function onHashChange() {
      const h = (window.location.hash || '#splash').slice(1).split('?')[0];
      setRoute(h || 'splash');
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Boot: try to restore session; if no identity → welcome
  useEffect(() => {
    (async () => {
      try {
        const identity = store.loadIdentity();
        if (!identity) {
          navigate('welcome');
          return;
        }

        // We have an identity. Try to re-login and fetch profile.
        const seed = hexToBytes(identity.seed_hex);
        const session = await api.login({
          seed,
          pubkeyHex: identity.pubkey_hex,
        });
        store.saveSession({
          token: session.session_token,
          pubkeyHex: session.pubkey_hex,
          expiresAt: session.expires_at,
          relayUrl: api.getRelayUrl(),
        });

        const me = await api.getMe();
        store.saveProfile({
          username: me.username,
          tier: me.tier,
          homeRelay: me.home_relay,
        });

        if (!me.username) {
          navigate('claim');
        } else {
          navigate('chats');
        }
      } catch (e) {
        console.error('Boot failed:', e);
        setBootError(e.message || String(e));
        // If auth specifically failed (401/403), wipe and start over.
        if (e.status === 401 || e.status === 403) {
          store.clearSession();
          navigate('welcome');
        } else {
          // Network error: stay on splash with retry button
          // (handled below in render)
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function navigate(to) {
    window.location.hash = `#${to}`;
    setRoute(to);
  }

  // Boot error → show splash with retry
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

  switch (route) {
    case 'splash':
      return <Splash />;
    case 'welcome':
      return <Welcome onNavigate={navigate} />;
    case 'create':
      return <CreateAccount onNavigate={navigate} />;
    case 'login':
      return <LoginByMnemonic onNavigate={navigate} />;
    case 'claim':
      return <ClaimUsername onNavigate={navigate} />;
    case 'chats':
      return <ChatsList onNavigate={navigate} />;
    default:
      return <Splash />;
  }
}
