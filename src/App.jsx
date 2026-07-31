import { useEffect, useRef, useState } from 'react';
import * as api from './lib/api.js';
import * as store from './lib/storage.js';
import * as msgs from './lib/messages.js';
import * as vault from './lib/vault.js';
import * as notif from './lib/notifications.js';
import * as convs from './lib/conversations.js';
import * as gstore from './lib/group_storage.js';
import * as nativePush from './lib/native_push.js';
import * as dms from './lib/dms.js';
import { formatPeerHandle } from './lib/display.js';
import { hexToBytes } from './lib/crypto.js';
import { InboxClient } from './lib/inbox.js';
import ScreenTransition from './components/ScreenTransition.jsx';
import Avatar from './components/Avatar.jsx';
import { resolveDirection } from './lib/nav_direction.js';
import { installTapHaptics } from './lib/tap_haptics.js';

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
import PeerProfile from './screens/PeerProfile.jsx';
import SafetyNumber from './screens/SafetyNumber.jsx';
import Settings from './screens/Settings.jsx';
import Sessions from './screens/Sessions.jsx';
import RecoveryKey from './screens/RecoveryKey.jsx';
import MutedChats from './screens/MutedChats.jsx';
import ContactsList from './screens/ContactsList.jsx';
import Blocked from './screens/Blocked.jsx';
import DeleteAccount from './screens/DeleteAccount.jsx';
import NewGroup from './screens/NewGroup.jsx';
import GroupChat from './screens/GroupChat.jsx';
import GroupInfo from './screens/GroupInfo.jsx';
import JoinGroup from './screens/JoinGroup.jsx';
import DMSList from './screens/DMSList.jsx';
import DMSCreate from './screens/DMSCreate.jsx';
import DMSDetail from './screens/DMSDetail.jsx';
import BurnerList from './screens/BurnerList.jsx';
import BurnerSend from './screens/BurnerSend.jsx';
import Tools from './screens/Tools.jsx';
import Mail from './screens/Mail.jsx';
import MailAliases from './screens/MailAliases.jsx';
import MailCompose from './screens/MailCompose.jsx';

const PENDING_KEY = 'morok.pending_route.v1';

function savePendingIfDeepLink(hash) {
  if (!hash) return;
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  if (cleaned.startsWith('newchat?') || cleaned.startsWith('join?')) {
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

function broadcastInboxState(state) {
  window.__morok_inbox_state = state;
  try {
    window.dispatchEvent(new CustomEvent('morok-inbox-state', { detail: state }));
  } catch {}
}

export default function App() {
  const [route, setRoute] = useState('splash');
  const [routeArg, setRouteArg] = useState(null);
  const [navDir, setNavDir] = useState('none');
  const [screenKey, setScreenKey] = useState('splash');
  const [connState, setConnState] = useState('open');
  const [bootError, setBootError] = useState(null);
  const inboxRef = useRef(null);
  // Для кого саме працює поточний inbox-клієнт. Потрібно, щоб не
  // перезапускати вже живе зʼєднання (див. коментар у startInbox).
  const inboxOwnerRef = useRef(null);
  const [pendingSeed, setPendingSeed] = useState(null);

  useEffect(() => {
    let lastHash = window.location.hash || '#splash';
    function parseHash() {
      const nextHash = window.location.hash || '#splash';
      const raw = nextHash.slice(1);
      const [path, qs] = raw.split('?');
      const parts = path.split('/');
      // Напрямок переходу для slide-анімації (чисто візуально).
      setNavDir(resolveDirection(lastHash, nextHash));
      lastHash = nextHash;
      setRoute(parts[0] || 'splash');
      setRouteArg(parts[1] || qs || null);
      setScreenKey(raw || 'splash');
    }
    parseHash();
    window.addEventListener('hashchange', parseHash);
    return () => window.removeEventListener('hashchange', parseHash);
  }, []);

  useEffect(() => {
    savePendingIfDeepLink(window.location.hash);

    // Public landing for burner links: skip auth/boot entirely.
    // The visitor doesn't need (and shouldn't be forced into) an account.
    const currentHash = (window.location.hash || '').slice(1);
    if (currentHash.startsWith('burner-send')) {
      return;
    }

    (async () => {
      try {
        const identity = store.loadIdentity();
        if (!identity) { navigate('welcome'); return; }

        if (identity.encrypted) {
          const unlockedSeed = vault.getUnlockedSeed();
          if (unlockedSeed) {
            await loginAndRoute(unlockedSeed, identity.pubkey_hex);
          } else {
            navigate('pin-unlock');
          }
          return;
        }

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

  useEffect(() => () => {
    inboxRef.current?.stop();
    inboxOwnerRef.current = null;
  }, []);

  // Глобальний тактильний відгук на тапи (no-op у вебі).
  useEffect(() => { installTapHaptics(); }, []);

  // НАТИВ: у фоні WebView тримає WS живим хвилинами — релей вважає нас
  // онлайн і свідомо НЕ шле FCM-пуші ("ти ж і так бачиш по WS").
  // Тому при згортанні закриваємо WS одразу (релей за ~90с точно
  // бачить офлайн, зазвичай миттєво по FIN), при поверненні —
  // відновлюємо. Так працюють усі месенджери: у фоні будить FCM.
  useEffect(() => {
    if (!window.Capacitor?.isNativePlatform?.()) return undefined;
    let handle = null;
    (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        handle = await CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            inboxRef.current?.start();
          } else {
            inboxRef.current?.stop();
          }
        });
      } catch (e) {
        console.warn('appStateChange listener failed (non-fatal):', e);
      }
    })();
    return () => { try { handle?.remove(); } catch { /* ok */ } };
  }, []);

  // Periodic DMS check-in: every 6 hours while the tab is open.
  // Combined with the on-login check-in, this means active users never
  // accidentally trigger their own DMS.
  useEffect(() => {
    const SIX_HOURS_MS = 6 * 3600 * 1000;
    const tid = setInterval(() => {
      dms.checkInAllArmed().catch((e) => console.warn('Periodic DMS check-in failed:', e));
    }, SIX_HOURS_MS);
    return () => clearInterval(tid);
  }, []);

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
      username: me.username,        // may be null — anonymous user
      tier: me.tier,
      homeRelay: me.home_relay,
      pubkeyHex,
    });

    // Anonymous accounts go straight to chats — no forced claim.
    startInbox(seed, pubkeyHex);

    // Натив: якщо пуші були увімкнені — пере-реєструємо FCM-токен
    // (Firebase іноді його ротує). Fire-and-forget, no-op у вебі.
    nativePush.refreshIfEnabled().catch(() => {});

    // Sealed Sender: реєструємо хеш свого delivery-токена на релеї,
    // Per-contact токени створюються при відкритті кожного чату
    // (maybeShareSealedToken). При логіні лише підтримуємо legacy-токен
    // живим для діючих sealed-розмов (міграція). Ідемпотентно, no-op на
    // старому релеї або якщо legacy-токена нема. Fire-and-forget.
    import('./lib/sealed_tokens.js')
      .then((m) => m.ensureLegacyToken())
      .catch(() => {});

    // Auto check-in for any armed DMS (fire-and-forget — don't block login)
    dms.checkInAllArmed().then((r) => {
      if (r.checkedIn > 0) console.info('DMS auto check-in:', r);
    }).catch((e) => console.warn('DMS auto check-in failed:', e));

    const pending = consumePending();
    if (pending) {
      window.location.hash = `#${pending}`;
    } else {
      navigate('chats');
    }
  }

  function startInbox(seed, myPubkeyHex) {
    // ГОНКА ПОДВІЙНОГО СТАРТУ. Після введення PIN inbox намагаються
    // підняти ДВА шляхи: loginAndRoute() (після await login/getMe) і
    // перевірка під час рендеру route === 'chats'. Другий встигав
    // першим, а loginAndRoute потім робив stop() ще не встановленому
    // WebSocket — звідси "WebSocket is closed before the connection is
    // established" у консолі й зайвий цикл connecting→closed→connecting.
    // Якщо клієнт уже працює для ЦЬОГО ж ключа — нічого не робимо.
    if (inboxRef.current && inboxOwnerRef.current === myPubkeyHex) return;
    if (inboxRef.current) inboxRef.current.stop();
    inboxOwnerRef.current = myPubkeyHex;
    const client = new InboxClient({
      onCatchup: async (envelopes) => {
        const touchedPeers = new Set();
        const touchedGroups = new Set();
        for (const env of envelopes) {
          try {
            const newMsg = await msgs.processIncoming({ envMeta: env, seed, myPubkeyHex });
            if (newMsg?.__mail) {
              // Синхрон між пристроями: пошту НЕ ack-аємо — конверт лишається
              // в черзі, щоб його підхопили й інші пристрої акаунта. Дублі
              // відсікає локальна дедуплікація (addEmail за envelope_id).
              // Сервер приберe конверт за TTL.
              window.dispatchEvent(new CustomEvent('morok-mail-update', { detail: newMsg }));
              continue;
            }
            client.ack(env.envelope_id);
            if (newMsg?.peer_pubkey) touchedPeers.add(newMsg.peer_pubkey);
            if (env.group_id) touchedGroups.add(env.group_id);
          } catch (e) { console.warn('catchup failed:', e); }
        }
        try {
          for (const p of touchedPeers) {
            window.dispatchEvent(new CustomEvent('morok-conv-update', {
              detail: { peerPubkey: p },
            }));
          }
          for (const g of touchedGroups) {
            window.dispatchEvent(new CustomEvent('morok-group-update', {
              detail: { groupId: g },
            }));
          }
        } catch {}
      },
      onNew: async (env) => {
        try {
          const newMsg = await msgs.processIncoming({ envMeta: env, seed, myPubkeyHex });

          if (newMsg?.__mail) {
            // Синхрон: пошту не ack-аємо (див. catchup). Звук — лише на справді нові.
            if (newMsg.isNew) { try { notif.playMessageSound(); } catch {} }
            window.dispatchEvent(new CustomEvent('morok-mail-update', { detail: newMsg }));
            return;
          }
          client.ack(env.envelope_id);

          // Tell the open chat/group view to refresh from store. Without
          // this, ChatRoom only re-renders on remount (navigate away & back)
          // because it listens to morok-conv-update.
          if (newMsg) {
            // Звук нового повідомлення (тумблер у Налаштуваннях; троттл
            // усередині; грає лише на вхідні, не на власне echo).
            try {
              if (newMsg.direction !== 'out') notif.playMessageSound();
            } catch {}
            try {
              if (newMsg.peer_pubkey) {
                window.dispatchEvent(new CustomEvent('morok-conv-update', {
                  detail: { peerPubkey: newMsg.peer_pubkey },
                }));
              } else if (env.group_id) {
                window.dispatchEvent(new CustomEvent('morok-group-update', {
                  detail: { groupId: env.group_id },
                }));
              }
            } catch {}
          }

          if (newMsg && newMsg.text && newMsg.direction === 'in') {
            if (newMsg.peer_pubkey) {
              // DM
              const conv = convs.getConversation(newMsg.peer_pubkey);
              const peerName = formatPeerHandle({
                username: conv?.peer_username,
                pubkey: newMsg.peer_pubkey,
              });
              notif.notify({
                title: peerName,
                body: newMsg.text.length > 100 ? newMsg.text.slice(0, 100) + '…' : newMsg.text,
                peerPubkey: newMsg.peer_pubkey,
                onClick: () => { window.location.hash = `#chat/${newMsg.peer_pubkey}`; },
              });
            } else if (env.group_id) {
              // Group message
              const g = gstore.getGroup(env.group_id);
              const senderHandle = formatPeerHandle({
                username: newMsg.sender_username,
                pubkey: newMsg.sender_pubkey,
              });
              notif.notify({
                title: `${g?.name || 'Група'} · ${senderHandle}`,
                body: newMsg.text.length > 100 ? newMsg.text.slice(0, 100) + '…' : newMsg.text,
                peerPubkey: env.group_id,
                onClick: () => { window.location.hash = `#group/${env.group_id}`; },
              });
            }
          }
        } catch (e) { console.warn('new failed:', e); }
      },
      onDeleted: ({ envelopeId, by, groupId }) => {
        // Server tells us a sender/admin removed this envelope. Drop it
        // from our local store and notify the open chat UI to refresh.
        try {
          if (groupId) {
            const removed = gstore.deleteMessageByEnvelope(groupId, envelopeId);
            if (removed) {
              window.dispatchEvent(new CustomEvent('morok-group-update', {
                detail: { groupId },
              }));
            }
          } else if (by) {
            // For DMs, `by` is the sender pubkey — which equals the peer
            // key for the local recipient's conversation.
            const removed = convs.deleteMessageByEnvelope(by, envelopeId);
            if (removed) {
              window.dispatchEvent(new CustomEvent('morok-conv-update', {
                detail: { peerPubkey: by },
              }));
            }
          }
        } catch (e) {
          console.warn('onDeleted handler failed:', e);
        }
      },
      onGroupGone: ({ groupId }) => {
        // Творець видалив групу на релеї — зносимо локальну копію.
        // Якщо ця група зараз відкрита, повертаємо користувача в Чати.
        try {
          gstore.removeGroup(groupId);
          window.dispatchEvent(new CustomEvent('morok-group-update', {
            detail: { groupId, gone: true },
          }));
          const hash = (window.location.hash || '').slice(1);
          if (hash === `group/${groupId}` || hash === `groupinfo/${groupId}`) {
            window.location.hash = '#chats';
          }
        } catch (e) {
          console.warn('onGroupGone handler failed:', e);
        }
      },
      onRead: ({ envelopeId, readerPubkey, groupId }) => {
        // Peer (or some group member) tells us they read our message.
        // For DM: readerPubkey == the peer of our outgoing message.
        // For group: append to the read_by aggregate (count only in UI).
        try {
          if (groupId) {
            const updated = gstore.markOutgoingReadByMember(
              groupId, envelopeId, readerPubkey,
            );
            if (updated) {
              window.dispatchEvent(new CustomEvent('morok-group-update', {
                detail: { groupId },
              }));
            }
          } else if (readerPubkey) {
            const updated = convs.markOutgoingRead(readerPubkey, envelopeId);
            if (updated) {
              window.dispatchEvent(new CustomEvent('morok-conv-update', {
                detail: { peerPubkey: readerPubkey },
              }));
            }
          }
        } catch (e) {
          console.warn('onRead handler failed:', e);
        }
      },
      onStateChange: (s) => {
        console.info('inbox state:', s);
        broadcastInboxState(s);
        setConnState(s);
      },
    });
    client.start();
    inboxRef.current = client;
  }

  function navigate(to) {
    window.location.hash = `#${to}`;
  }

  useEffect(() => {
    if (route !== 'chats') return;
    const pending = consumePending();
    if (pending) window.location.hash = `#${pending}`;
  }, [route]);

  function onSeedReady({ seed, pubkeyHex, mnemonic }) {
    setPendingSeed({ seed, pubkeyHex, mnemonic });
    navigate('pin-setup');
  }

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

  function onPinSetExisting() { navigate('settings'); }

  function onPinUnlocked(seedBytes) {
    const id = store.loadIdentity();
    loginAndRoute(seedBytes, id.pubkey_hex).catch((e) => {
      setBootError(e.message);
      navigate('splash');
    });
  }

  function onForgotPin() {
    if (!confirm('Видалити цей акаунт з браузера? Потрібні будуть 24 слова для входу.')) return;
    // Спершу гасимо inbox: акаунт зникає, тримати його сокет нема сенсу,
    // а власника скидаємо, щоб наступний вхід (іншим сідом) підняв
    // зʼєднання заново, а не вважав старе живим.
    inboxRef.current?.stop();
    inboxRef.current = null;
    inboxOwnerRef.current = null;
    store.wipeAll();
    vault.lockNow();
    navigate('welcome');
  }

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

  if (route === 'chats' && !inboxRef.current) {
    const seed = vault.getUnlockedSeed();
    const id = store.loadIdentity();
    if (seed && id?.pubkey_hex) {
      Promise.resolve().then(() => {
        if (!inboxRef.current) startInbox(seed, id.pubkey_hex);
      });
    } else if (id && !id.encrypted && id.seed_hex) {
      Promise.resolve().then(() => {
        if (!inboxRef.current) startInbox(hexToBytes(id.seed_hex), id.pubkey_hex);
      });
    }
  }

  function renderScreen() {
    const _prof = store.loadProfile();
    const mailPrimaryAddress = _prof?.username ? `${_prof.username}@morok.email` : 'Morok';
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
      return <PinSetup onNavigate={navigate} onDone={onPinSetExisting} />;
    case 'pin-unlock':
      return <PinUnlock onUnlocked={onPinUnlocked} onForgotPin={onForgotPin} />;
    case 'claim': return <ClaimUsername onNavigate={navigate} />;
    case 'chats': return <ChatsList onNavigate={navigate} />;
    case 'newchat': return <NewChat onNavigate={navigate} routeArg={routeArg} />;
    case 'newgroup': return <NewGroup onNavigate={navigate} />;
    case 'profile': return <Profile onNavigate={navigate} />;
    case 'settings': return <Settings onNavigate={navigate} />;
    case 'sessions': return <Sessions onNavigate={navigate} />;
    case 'recovery-key': return <RecoveryKey onNavigate={navigate} />;
    case 'muted': return <MutedChats onNavigate={navigate} />;
    case 'contacts': return <ContactsList onNavigate={navigate} />;
    case 'blocked': return <Blocked onNavigate={navigate} />;
    case 'delete-account': {
      const id = store.loadIdentity();
      if (!id?.pubkey_hex) { navigate('welcome'); return <Splash />; }
      return <DeleteAccount onNavigate={navigate} currentPubkeyHex={id.pubkey_hex} />;
    }
    case 'chat':
      if (!routeArg) { navigate('chats'); return <Splash />; }
      return <ChatRoom peerPubkey={routeArg} onNavigate={navigate} />;
    case 'peer':
      if (!routeArg) { navigate('chats'); return <Splash />; }
      return <PeerProfile peerPubkey={routeArg} onNavigate={navigate} />;
    case 'safety':
      if (!routeArg) { navigate('chats'); return <Splash />; }
      return <SafetyNumber peerPubkey={routeArg} onNavigate={navigate} />;
    case 'group':
      if (!routeArg) { navigate('chats'); return <Splash />; }
      return <GroupChat groupId={routeArg} onNavigate={navigate} />;
    case 'groupinfo':
      if (!routeArg) { navigate('chats'); return <Splash />; }
      return <GroupInfo groupId={routeArg} onNavigate={navigate} />;
    case 'join':
      return <JoinGroup routeArg={routeArg} onNavigate={navigate} />;
    case 'dms': return <DMSList onNavigate={navigate} />;
    case 'dms-create': return <DMSCreate onNavigate={navigate} />;
    case 'dms-detail':
      if (!routeArg) { navigate('dms'); return <Splash />; }
      return <DMSDetail dmsId={routeArg} onNavigate={navigate} />;
    case 'burner': return <BurnerList onNavigate={navigate} />;
    case 'burner-send':
      return <BurnerSend routeArg={routeArg} />;
    case 'mail': return <Mail onNavigate={navigate} />;
    case 'mail-aliases': return <MailAliases onNavigate={navigate} />;
    case 'mail-compose': return <MailCompose onNavigate={navigate} myPrimaryAddress={mailPrimaryAddress} />;
    case 'tools': return <Tools onNavigate={navigate} />;
    default: return <Splash />;
  }
  }

  return (
    <>
      <ConnBanner state={connState} />
      <DesktopAwareLayout
        route={route}
        routeArg={routeArg}
        screenKey={screenKey}
        navDir={navDir}
        navigate={navigate}
        renderScreen={renderScreen}
      />
    </>
  );
}

/* ── Desktop two-pane layout ──
 *
 * <900px: телефонний режим — усе як було (ScreenTransition + один екран).
 * ≥900px: двопанельний десктоп (як Telegram Desktop):
 *   ┌──────────────┬──────────────────────────┐
 *   │  ChatsList   │  активний екран (чат,     │
 *   │  (постійна)  │  налаштування, профіль…)  │
 *   └──────────────┴──────────────────────────┘
 * Auth-роути (welcome/create/login/pin…) — завжди одноекранні.
 * На десктопі slide-анімацію вимикаємо: панелі статичні, миттєва заміна
 * правої частини — саме так поводяться нативні десктоп-месенджери.
 */
/* ── Живий заголовок вкладки ──
 * "(3) Morok" коли є непрочитані; назва чату коли відкритий; миготіння
 * favicon у фоновій вкладці при непрочитаних. Рахуємо на realtime-події
 * (morok-conv-update / morok-group-update) + перехід між чатами.
 */
function totalUnread() {
  let n = 0;
  try {
    for (const c of convs.listConversations()) n += convs.countUnread(c.peer_pubkey);
    for (const g of gstore.listGroups()) n += gstore.countUnread(g.group_id);
  } catch {}
  return n;
}

function useTabTitle(route, routeArg) {
  useEffect(() => {
    let flashTimer = null;
    let flashOn = false;

    function chatLabel() {
      try {
        if (route === 'chat' && routeArg) {
          const c = convs.getConversation(routeArg);
          return c?.peer_username ? `@${c.peer_username}` : null;
        }
        if (route === 'group' && routeArg) {
          const g = gstore.getGroup(routeArg);
          return g?.name || null;
        }
      } catch {}
      return null;
    }

    function apply() {
      const unread = totalUnread();
      const label = chatLabel();
      const base = label ? `${label} — Morok` : 'Morok';
      document.title = unread > 0 ? `(${unread}) ${base}` : base;

      // Миготіння favicon лише у фоновій вкладці з непрочитаними.
      const hidden = document.visibilityState === 'hidden';
      if (unread > 0 && hidden && !flashTimer) {
        flashTimer = setInterval(() => {
          flashOn = !flashOn;
          document.title = flashOn ? `● (${totalUnread()}) ${base}` : `(${totalUnread()}) ${base}`;
        }, 1200);
      } else if ((unread === 0 || !hidden) && flashTimer) {
        clearInterval(flashTimer);
        flashTimer = null;
      }
    }

    apply();
    const onUpdate = () => apply();
    window.addEventListener('morok-conv-update', onUpdate);
    window.addEventListener('morok-group-update', onUpdate);
    document.addEventListener('visibilitychange', onUpdate);
    return () => {
      window.removeEventListener('morok-conv-update', onUpdate);
      window.removeEventListener('morok-group-update', onUpdate);
      document.removeEventListener('visibilitychange', onUpdate);
      if (flashTimer) clearInterval(flashTimer);
    };
  }, [route, routeArg]);
}

const AUTH_ROUTES = new Set([
  'splash', 'welcome', 'create', 'login', 'restore',
  'pin-setup', 'pin-setup-existing', 'pin-unlock', 'claim',
  'burner-send', 'join',
]);

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

function DesktopAwareLayout({ route, routeArg, screenKey, navDir, navigate, renderScreen }) {
  const isDesktop = useIsDesktop();
  useTabTitle(route, routeArg);

  const isChat = route === 'chat' || route === 'group';

  // Десктопні клавіші: Esc у чаті/на сторінці → повернутись до списку.
  // НЕ спрацьовує, якщо відкрита модалка/оверлей (position:fixed) — там
  // Esc належить модалці, а не навігації.
  useEffect(() => {
    if (!isDesktop) return;
    function onKey(e) {
      if (e.key !== 'Escape') return;
      const overlayOpen = !!document.querySelector('#root [style*="position: fixed"], #root [style*="position:fixed"]');
      if (overlayOpen) return;
      if (route !== 'chats' && !AUTH_ROUTES.has(route)) {
        navigate('chats');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop, route, navigate]);

  // Автофокус у поле вводу при відкритті чату (тільки десктоп — на мобілі
  // це вискакує клавіатурою і дратує).
  useEffect(() => {
    if (!isDesktop || !isChat) return;
    const t = setTimeout(() => {
      const ta = document.querySelector('.dt-right textarea');
      ta?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [isDesktop, isChat, screenKey]);

  // Телефон АБО auth-флоу → класичний одноекранний режим зі slide.
  if (!isDesktop || AUTH_ROUTES.has(route)) {
    return (
      <ScreenTransition routeKey={screenKey} direction={navDir}>
        {renderScreen()}
      </ScreenTransition>
    );
  }

  // Десктоп: зліва постійний список чатів, справа — активний екран.
  // activeChatId — щоб список підсвічував відкритий чат/групу.
  // dt-page = "сторінкові" екрани (обмежена колонка); чат — повна ширина.
  const rightIsList = route === 'chats';
  const activeChatId = isChat ? routeArg : null;
  return (
    <div className="dt-shell">
      <aside className="dt-left">
        <ChatsList onNavigate={navigate} activeChatId={activeChatId} />
      </aside>
      <main className={`dt-right${isChat || rightIsList ? '' : ' dt-page'}`} key={screenKey}>
        {rightIsList ? <DesktopPlaceholder /> : renderScreen()}
      </main>
      <QuickSwitcher navigate={navigate} />
    </div>
  );
}

function DesktopPlaceholder() {
  return (
    <div className="dt-placeholder">
      <div className="dt-placeholder-tile">M</div>
      <div className="dt-placeholder-title">Оберіть чат</div>
      <div className="dt-placeholder-sub">або створіть новий, щоб почати розмову</div>
    </div>
  );
}

/* ── Ctrl+K: швидкий перемикач чатів (десктоп) ──
 * Палітра поверх усього: пошук по нікнеймах/юзернеймах/назвах груп,
 * ↑↓ — вибір, Enter — перейти, Esc — закрити. Як у Telegram/Slack.
 */
function QuickSwitcher({ navigate }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQ('');
        setIdx(0);
      } else if (e.key === 'Escape' && open) {
        e.stopPropagation();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  if (!open) return null;

  // Кандидати: DM-розмови + групи, відфільтровані за запитом.
  const needle = q.trim().toLowerCase();
  const dms = convs.listConversations()
    .filter((c) => (c.messages?.length || 0) > 0)
    .map((c) => ({
      kind: 'dm', id: c.peer_pubkey,
      label: c.peer_username ? `@${c.peer_username}` : `${c.peer_pubkey.slice(0, 10)}…`,
      username: c.peer_username || null,
      pubkey: c.peer_pubkey,
    }));
  const grps = gstore.listGroups().map((g) => ({
    kind: 'group', id: g.group_id, label: g.name || 'Група',
    username: g.name || null,
    pubkey: g.group_id,
  }));
  const all = [...dms, ...grps];
  const hits = needle
    ? all.filter((x) => x.label.toLowerCase().includes(needle))
    : all.slice(0, 8);
  const sel = Math.min(idx, Math.max(0, hits.length - 1));

  function go(item) {
    setOpen(false);
    navigate(item.kind === 'dm' ? `chat/${item.id}` : `group/${item.id}`);
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '18vh',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, maxWidth: '90vw',
          background: '#14141B', border: '1px solid #2A2A34',
          borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, hits.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); go(hits[sel]); }
          }}
          placeholder="Куди перейти?  (↑↓ + Enter)"
          style={{
            width: '100%', padding: '15px 18px', boxSizing: 'border-box',
            background: 'transparent', border: 'none', outline: 'none',
            color: '#F5F5F7', fontSize: 15.5, fontFamily: 'inherit',
            borderBottom: hits.length ? '1px solid #232329' : 'none',
          }}
        />
        {hits.map((h, i) => (
          <div
            key={`${h.kind}-${h.id}`}
            onClick={() => go(h)}
            onMouseEnter={() => setIdx(i)}
            style={{
              padding: '11px 18px', cursor: 'pointer', fontSize: 14.5,
              color: i === sel ? '#FFFFFF' : '#C8C8D2',
              background: i === sel ? 'rgba(123,150,255,0.14)' : 'transparent',
              display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <Avatar username={h.username} pubkey={h.pubkey} size={26} isGroup={h.kind === 'group'} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Тонка смужка стану з'єднання. Показується лише коли НЕ open —
   у нормі невидима. Дає юзеру зрозуміти, що застосунок не завис, а
   перепідключається (WS уже має авто-reconnect, просто мовчки). */
function ConnBanner({ state }) {
  if (state === 'open') return null;
  const cfg = {
    connecting: { text: 'З\u2019єднання…', bg: '#1E1E27', color: '#8E8E99', pulse: true },
    closed: { text: 'З\u2019єднання втрачено, відновлюємо…', bg: '#2A1F1A', color: '#FFA94D', pulse: true },
    error: { text: 'Немає з\u2019єднання, повторюємо…', bg: '#2A1A1E', color: '#FF6B7A', pulse: true },
  }[state] || { text: 'З\u2019єднання…', bg: '#1E1E27', color: '#8E8E99', pulse: true };
  return (
    <div style={{
      position: 'fixed',
      top: 'var(--inset-top, 0px)', left: 0, right: 0,
      zIndex: 300,
      pointerEvents: 'none',
      background: cfg.bg,
      color: cfg.color,
      fontSize: 12, fontWeight: 600, textAlign: 'center',
      padding: '6px 12px',
      letterSpacing: '-0.005em',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
      animation: 'connBannerIn 0.25s ease-out',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: cfg.color,
        animation: cfg.pulse ? 'connPulse 1.2s ease-in-out infinite' : 'none',
      }} />
      {cfg.text}
    </div>
  );
}
