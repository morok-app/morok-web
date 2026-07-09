import { useEffect, useState } from 'react';
import * as dms from '../lib/dms.js';
import * as burner from '../lib/burner.js';
import * as contacts from '../lib/contacts.js';
import { TopBar } from '../components/ui.jsx';

export default function Tools({ onNavigate }) {
  const [dmsCount, setDmsCount] = useState(null);
  const [burnerCount, setBurnerCount] = useState(null);
  const [contactsCount, setContactsCount] = useState(
    () => contacts.listExplicitContacts().length
  );
  const [blockedCount, setBlockedCount] = useState(
    () => contacts.listBlocked().length
  );

  useEffect(() => {
    (async () => {
      try {
        const list = await dms.listAll();
        setDmsCount(list.filter((d) => d.status === 'armed').length);
      } catch { setDmsCount(0); }
      try {
        const tokens = await burner.listMyTokens();
        setBurnerCount(tokens.length);
      } catch { setBurnerCount(0); }
    })();
    // Contacts and blocked counts are pure-local — refresh whenever this
    // screen mounts (e.g. user navigates back from ContactsList).
    setContactsCount(contacts.listExplicitContacts().length);
    setBlockedCount(contacts.listBlocked().length);
  }, []);

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      <TopBar
        title="Інструменти"
        subtitle="Додаткові функції для приватності"
        onBack={() => onNavigate('chats')}
        backIcon="close"
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px' }}>

        <ToolCard
          accent="#7B96FF"
          accentBg="rgba(107, 138, 254, 0.12)"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>
            </svg>
          }
          title="Пошта"
          description="Анонімна email-скринька. Створюйте адреси @morok.email — листи приходять зашифрованими лише для вас, сервер їх не зберігає."
          onClick={() => onNavigate('mail')}
        />

        <ToolCard
          accent="#7B96FF"
          accentBg="rgba(107, 138, 254, 0.12)"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          }
          title="Цифровий заповіт"
          description="Якщо ви довго не заходите — обране повідомлення доставиться адресату. Корисно для паролів, ключів, інструкцій."
          countLabel={dmsCount === null ? null : dmsCount}
          countSuffix="активних"
          onClick={() => onNavigate('dms')}
        />

        <ToolCard
          accent="#FFA94D"
          accentBg="rgba(255, 169, 77, 0.1)"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
            </svg>
          }
          title="Анонімна скринька"
          description="Створіть одноразовий лінк — будь-хто зможе написати вам анонімно без реєстрації. Зашифровано наскрізно."
          countLabel={burnerCount === null ? null : burnerCount}
          countSuffix="активних"
          onClick={() => onNavigate('burner')}
        />

        <ToolCard
          accent="#4ADE80"
          accentBg="rgba(74, 222, 128, 0.1)"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          }
          title="Контакти"
          description="Збережіть людей, з якими часто спілкуєтесь. Можна додавати локальні нікнейми — їх бачите тільки ви."
          countLabel={contactsCount}
          countSuffix={pluralize(contactsCount, 'контакт', 'контакти', 'контактів')}
          onClick={() => onNavigate('contacts')}
        />

        <ToolCard
          accent="#FF6B7A"
          accentBg="rgba(255, 107, 122, 0.08)"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
          }
          title="Заблоковані"
          description="Юзери, від яких не приймаєте повідомлень. Список локальний — сервер про нього не знає."
          countLabel={blockedCount}
          countSuffix={blockedCount === 1 ? 'юзер' : (blockedCount >= 2 && blockedCount <= 4 ? 'юзери' : 'юзерів')}
          onClick={() => onNavigate('blocked')}
        />

        {/* Coming soon section */}
        <div style={{
          fontSize: 11, color: '#3F3F45',
          textTransform: 'uppercase', letterSpacing: '0.1em',
          fontWeight: 600,
          padding: '24px 0 12px',
        }}>
          СКОРО
        </div>

        <ComingSoonCard
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>
            </svg>
          }
          title="Мульти-акаунт"
          description="Кілька облікових записів в одному додатку"
        />

        <ComingSoonCard
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          }
          title="Верифіковані бейджі"
          description="Підтверджені особистості — менше шахраїв"
        />

        <ComingSoonCard
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>
            </svg>
          }
          title="Зашифрований бекап"
          description="Безпечне зберігання ключів на сервері"
        />
      </div>
    </div>
  );
}

function ToolCard({ icon, accent, accentBg, title, description, countLabel, countSuffix, onClick }) {
  return (
    <div
      onClick={onClick}
      className="lin-tool-card"
      style={{
        background: '#13131A',
        border: '1px solid #232329',
        borderRadius: 14,
        padding: 16,
        marginBottom: 10,
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: accentBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accent, flexShrink: 0,
        }}>
          <div style={{ width: 18, height: 18 }}>{icon}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#F5F5F7', letterSpacing: '-0.01em' }}>
              {title}
            </div>
            {countLabel !== null && countLabel !== undefined && (
              <div style={{
                fontSize: 10.5, color: accent,
                background: accentBg,
                padding: '2px 7px', borderRadius: 6,
                fontFamily: 'var(--mono, monospace)',
                fontWeight: 600,
                letterSpacing: '0.02em',
              }}>
                {countLabel} {countSuffix}
              </div>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: '#8E8E99', lineHeight: 1.55 }}>
            {description}
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3F3F45" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 12 }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
      <style>{`
        .lin-tool-card:hover {
          border-color: #2F2F38;
          background: #16161E;
        }
      `}</style>
    </div>
  );
}

function ComingSoonCard({ icon, title, description }) {
  return (
    <div style={{
      background: 'transparent',
      border: '1px dashed #232329',
      borderRadius: 12,
      padding: 14,
      marginBottom: 8,
      display: 'flex', alignItems: 'center', gap: 14,
      opacity: 0.6,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: '#13131A',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#5A5A65', flexShrink: 0,
      }}>
        <div style={{ width: 16, height: 16 }}>{icon}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#A8A8B0' }}>
          {title}
        </div>
        <div style={{ fontSize: 11.5, color: '#5A5A65', marginTop: 2 }}>
          {description}
        </div>
      </div>
    </div>
  );
}

function pluralize(n, one, few, many) {
  if (n === null || n === undefined) return many;
  const m = n % 100;
  if (m >= 11 && m <= 14) return many;
  const r = n % 10;
  if (r === 1) return one;
  if (r >= 2 && r <= 4) return few;
  return many;
}
