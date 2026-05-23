import { useEffect, useState } from 'react';
import * as dms from '../lib/dms.js';
import * as burner from '../lib/burner.js';

/**
 * Tools — landing page for power-user features (DMS, Burner inbox, etc.)
 *
 * Separated from Settings: Settings is account/device config, Tools are
 * proactive features that change what the messenger does.
 */
export default function Tools({ onNavigate }) {
  const [dmsCount, setDmsCount] = useState(null);
  const [burnerCount, setBurnerCount] = useState(null);

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
  }, []);

  return (
    <div className="screen">
      <div className="topbar">
        <div className="back" onClick={() => onNavigate('chats')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        <div className="title">Інструменти</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 32px' }}>
        <p className="hint" style={{ marginBottom: 20 }}>
          Додаткові функції Morok для тих хто хоче більше контролю над приватністю.
        </p>

        <ToolCard
          icon="📜"
          title="Цифровий заповіт"
          description="Якщо ви довго не заходите — обране повідомлення автоматично доставиться адресату. Корисно для паролів, ключів, інструкцій."
          countLabel={dmsCount === null ? null : `активних: ${dmsCount}`}
          onClick={() => onNavigate('dms')}
        />

        <ToolCard
          icon="🔥"
          title="Анонімна скринька"
          description="Створіть одноразовий лінк — будь-хто зможе написати вам анонімно без реєстрації. Зашифровано наскрізно."
          countLabel={burnerCount === null ? null : `активних: ${burnerCount}`}
          onClick={() => onNavigate('burner')}
        />

        <div style={{
          marginTop: 24,
          padding: '14px 16px',
          background: 'var(--surface)',
          border: '1px dashed var(--border)',
          borderRadius: 12,
          fontSize: 12, color: 'var(--text-faint)',
          lineHeight: 1.55, textAlign: 'center',
        }}>
          Скоро: <strong style={{ color: 'var(--text-dim)' }}>Multi-identity</strong>,
          <strong style={{ color: 'var(--text-dim)' }}> Verified-бейджі</strong>,
          <strong style={{ color: 'var(--text-dim)' }}> Бекап ключів</strong>
        </div>
      </div>
    </div>
  );
}

function ToolCard({ icon, title, description, countLabel, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 14, padding: 16, marginBottom: 12,
        cursor: 'pointer',
        display: 'flex', gap: 14, alignItems: 'flex-start',
        transition: 'border-color .15s',
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--text-faint)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: 'var(--surface-2, rgba(107,138,254,0.1))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 4,
        }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-0.01em' }}>
            {title}
          </div>
          {countLabel !== null && countLabel !== undefined && (
            <div style={{
              fontSize: 10.5, color: 'var(--text-faint)',
              background: 'var(--bg)',
              padding: '2px 7px', borderRadius: 4,
              fontFamily: 'var(--mono)',
            }}>{countLabel}</div>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          {description}
        </div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 12 }}>
        <path d="M9 18l6-6-6-6" />
      </svg>
    </div>
  );
}
