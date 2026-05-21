import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import * as store from '../lib/storage.js';

export default function ChatsList({ onNavigate }) {
  const [profile, setProfile] = useState(store.loadProfile());

  // Refresh profile in background — useful after claim
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.getMe();
        if (cancelled) return;
        store.saveProfile({
          username: me.username,
          tier: me.tier,
          homeRelay: me.home_relay,
        });
        setProfile({ username: me.username, tier: me.tier, home_relay: me.home_relay });
      } catch (e) {
        console.warn('Profile refresh failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function logoutClicked() {
    await api.logout();
    store.wipeAll();
    onNavigate('welcome');
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div className="title">Чати</div>
        <div className="actions">
          <button
            className="btn btn-ghost"
            style={{ width: 'auto', height: 36, padding: '0 12px', fontSize: 12 }}
            onClick={logoutClicked}
          >
            Вийти
          </button>
        </div>
      </div>

      <div className="empty-state">
        <div className="icon-wrap">
          <svg viewBox="0 0 24 24">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </div>
        <div className="title">Поки немає чатів</div>
        <div className="desc">
          Ваш юзернейм: <strong>@{profile?.username || '...'}</strong><br/>
          Поділіться ним з тими, хто хоче з вами зв'язатись.
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 16 }}>
          Створення нових чатів — наступний день розробки.
        </p>
      </div>
    </div>
  );
}
