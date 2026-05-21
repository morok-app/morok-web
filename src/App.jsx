import { useEffect, useRef, useState } from 'react';
import * as api from './lib/api.js';
import * as store from './lib/storage.js';
import * as msgs from './lib/messages.js';
import * as vault from './lib/vault.js';
import { hexToBytes, bytesToHex } from './lib/crypto.js';
import { InboxClient } from './lib/inbox.js';

import Splash from './screens/Splash.jsx';
import Welcome from './screens/Welcome.jsx';
import CreateAccount from './screens/CreateAccount.jsx';
import LoginByMnemonic from './screens/LoginByMnemonic.jsx';
import RestoreByUsername from './screens/RestoreByUsername.jsx';
import PinSetup from './screens/PinSetup.jsx';
import PinUnlock from './screens/PinUnlock.jsx';
import ClaimUsername from './screens/ClaimUsername.jsx';
import ChatsList from './screens/ChatsList.jsx';
import NewChat from './screens/NewChat.jsx';
import ChatRoom from './screens/ChatRoom.jsx';
import Profile from './screens/Profile.jsx';
import Settings from './screens/Settings.jsx';

const PENDING_KEY = 'morok.pending_route.v1';

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

  // Buffer for a freshly-generated seed during create-account flow,
  // before PIN is set and identity is persisted.
  const [pendingSeed, setPendingSeed] = useState(null);

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

  // Boot
  useEffect(() => {
    savePendingIfDeepLink(window.location.hash);

    (async () => {
      try {
        const identity = store.loadIdentity();
        if (!identity) {
          navigate('welcome');
          return;
        }

        // If identity is encrypted, we need PIN to unlock
        if (identity.encrypted) {
          // Check if we already have a valid PIN session
          const unlockedSeed = vault.getUnlockedSeed();
          if (unlockedSeed) {
            // Session still valid — proceed to auth
            await loginAndRoute(unlockedSeed, identity.pubkey_hex);
          } else {
            navigate('pin-unlock');
          }
          return;
        }

        // Identity is unlocked (legacy or just-after-restore) — log in directly
        const seed = hexToBytes(identity.seed_hex);
        await loginAndRoute(seed, identity.pubkey_hex);
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

  async function loginAndRoute(seed, pubkeyHex) {
    const session = await api.login({ seed, pubkeyHex });
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
      pubkeyHex,
    });

    if (!me.username) {
      navigate('claim');
    } else {
      startInbox(seed, pubkeyHex);
      const pending = consumePending();
      if (pending) {
        window.location.hash = `#${pending}`;
      } else {
        navigate('chats');
      }
    }
  }

  function startInbox(seed, myPubkeyHex) {
    if (inboxRef.current) inboxRef.current.stop();
    const client = new InboxClient({
      onCatchup: async (envelopes) => {
        for (const env of envelopes) {
          try {
            await msgs.processIncoming({ envMeta: env, seed, myPubkeyHex });
            client.ack(env.envelope_id);
          } catch (e) { console.warn('catchup failed:', e); }
        }
      },
      onNew: async (env) => {
        try {
          await msgs.processIncoming({ envMeta: env, seed, myPubkeyHex });
          client.ack(env.envelope_id);
        } catch (e) { console.warn('new failed:', e); }
      },
      onStateChange: (s) => console.info('inbox state:', s),
    });
    client.start();
    inboxRef.current = client;
  }

  function navigate(to) {
    window.location.hash = `#${to}`;
  }

  // After ClaimUsername → 'chats', honor pending deep-link
  useEffect(() => {
    if (route !== 'chats') return;
    const pending = consumePending();
    if (pending) window.location.hash = `#${pending}`;
  }, [route]);

  // ── Flow callbacks ──────────────────────────────────────

  /**
   * Called from CreateAccount or LoginByMnemonic when user has confirmed
   * their seed. We hold it in state and route to PIN setup.
   */
  function onSeedReady({ seed, pubkeyHex, mnemonic }) {
    setPendingSeed({ seed, pubkeyHex, mnemonic });
    navigate('pin-setup');
  }

  /**
   * PinSetup gives us back the seed bytes after locking identity.
   * Now we proceed with auth.
   */
  async function onPinSet(seedBytes) {
    vault.markUnlocked(seedBytes);
    setPendingSeed(null);
    const id = store.loadIdentity();
    try {
      await loginAndRoute(seedBytes, id.pubkey_hex);
    } catch (e) {
      setBootError(e.message);
      navigate('splash');
    }
  }

  /**
   * PinSetup for existing user (from Settings → "Поставити PIN").
   * Just lock and go back to settings.
   */
  function onPinSetExisting() {
    navigate('settings');
  }

  function onPinUnlocked(seedBytes) {
    const id = store.loadIdentity();
    loginAndRoute(seedBytes, id.pubkey_hex).catch((e) => {
      setBootError(e.message);
      navigate('splash');
    });
  }

  function onForgotPin() {
    if (!confirm('Видалити цей акаунт з браузера? Потрібні будуть 24 слова для входу.')) return;
    store.wipeAll();
    vault.lockNow();
    navigate('welcome');
  }

  // ── Render ──────────────────────────────────────────────

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
    const seed = vault.getUnlockedSeed();
    const id = store.loadIdentity();
    if (seed && id?.pubkey_hex) {
      Promise.resolve().then(() => {
        if (!inboxRef.current) startInbox(seed, id.pubkey_hex);
      });
    } else if (id && !id.encrypted && id.seed_hex) {
      // Legacy unlocked
      Promise.resolve().then(() => {
        if (!inboxRef.current) startInbox(hexToBytes(id.seed_hex), id.pubkey_hex);
      });
    }
  }

  switch (route) {
    case 'splash': return <Splash />;
    case 'welcome': return <Welcome onNavigate={navigate} />;
    case 'create': return <CreateAccount onNavigate={navigate} onSeedReady={onSeedReady} />;
    case 'login': return <LoginByMnemonic onNavigate={navigate} onSeedReady={onSeedReady} />;
    case 'restore': return <RestoreByUsername onNavigate={navigate} />;
    case 'pin-setup':
      return (
        <PinSetup
          onNavigate={navigate}
          prefilledSeed={pendingSeed?.seed}
          prefilledMnemonic={pendingSeed?.mnemonic}
          prefilledPubkeyHex={pendingSeed?.pubkeyHex}
          onDone={onPinSet}
        />
      );
    case 'pin-setup-existing':
      return (
        <PinSetup
          onNavigate={navigate}
          onDone={onPinSetExisting}
        />
      );
    case 'pin-unlock':
      return <PinUnlock onUnlocked={onPinUnlocked} onForgotPin={onForgotPin} />;
    case 'claim': return <ClaimUsername onNavigate={navigate} />;
    case 'chats': return <ChatsList onNavigate={navigate} />;
    case 'newchat': return <NewChat onNavigate={navigate} routeArg={routeArg} />;
    case 'profile': return <Profile onNavigate={navigate} />;
    case 'settings': return <Settings onNavigate={navigate} />;
    case 'chat':
      if (!routeArg) { navigate('chats'); return <Splash />; }
      return <ChatRoom peerPubkey={routeArg} onNavigate={navigate} />;
    default: return <Splash />;
  }
}
