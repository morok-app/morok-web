import { hapticLight } from '../lib/haptics.js';

/*
 * Спільні UI-компоненти в Linear-стилі.
 *
 * Мета — щоб усі екрани мали один візуальний словник (топбар, секції,
 * рядки, чіпи) замість дубльованих inline-стилів. Linear-патерн:
 *   - чорніший фон, групи на світлішій поверхні
 *   - секції-плашки зі скругленням, рядки розділені тонкою лінією
 *   - тихі значення праворуч + дрібний chevron
 *   - контролі в топбарі згруповані в капсулу
 */

/* ─── Топбар з кнопкою назад/закрити ─────────────────────── */
export function TopBar({ title, subtitle, onBack, backIcon = 'arrow', right = null }) {
  return (
    <div style={{
      padding: '18px 18px 20px',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {onBack && backIcon === 'arrow' && (
          <IconButton onClick={onBack} ariaLabel="Назад">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </IconButton>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 27, fontWeight: 800, letterSpacing: '-0.03em',
            color: '#F5F5F7', lineHeight: 1.1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 12.5, color: '#6B6B72', marginTop: 5, fontWeight: 500 }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {right}
        {onBack && backIcon === 'close' && (
          <IconButton onClick={onBack} ariaLabel="Закрити">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </IconButton>
        )}
      </div>
    </div>
  );
}

/* ─── Кругла іконкова кнопка ──────────────────────────────── */
export function IconButton({ onClick, children, ariaLabel, active = false }) {
  return (
    <button
      onClick={() => { hapticLight(); onClick?.(); }}
      aria-label={ariaLabel}
      className="lin-icon-btn"
      style={{
        width: 36, height: 36, borderRadius: '50%',
        background: active ? '#2A2A34' : '#1E1E27',
        border: '1px solid #32323E',
        color: active ? '#F5F5F7' : '#C8C8D2',
        cursor: 'pointer', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

/* ─── Капсула з кількох іконкових кнопок (як топбар Linear) ── */
export function PillGroup({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: '#1E1E27', border: '1px solid #32323E',
      borderRadius: 100, padding: 3, gap: 2,
    }}>
      {children}
    </div>
  );
}
export function PillButton({ onClick, children, ariaLabel }) {
  return (
    <button
      onClick={() => { hapticLight(); onClick?.(); }}
      aria-label={ariaLabel}
      className="lin-pill-btn"
      style={{
        width: 32, height: 32, borderRadius: '50%',
        background: 'transparent', border: 'none',
        color: '#C8C8D2', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

/* ─── Секція-плашка + рядок ───────────────────────────────── */
export function Section({ label, children, caption }) {
  return (
    <>
      {label && <div className="lin-group-label">{label}</div>}
      <div className="lin-section">{children}</div>
      {caption && <div className="lin-section-caption">{caption}</div>}
    </>
  );
}

export function Row({
  label, labelColor = '#ECECF0',
  value, valueColor = '#8A8A95',
  onClick, chevron = true, disabled = false, right = null,
}) {
  const clickable = !!onClick && !disabled;
  return (
    <div
      className="lin-section-row"
      onClick={clickable ? () => { hapticLight(); onClick(); } : undefined}
      style={{ cursor: clickable ? 'pointer' : 'default', opacity: disabled ? 0.5 : 1 }}
    >
      <span className="row-label" style={{ color: labelColor }}>{label}</span>
      <span className="row-value">
        {right}
        {value ? <span style={{ color: valueColor }}>{value}</span> : null}
        {chevron && clickable && (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3F3F45" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
      </span>
    </div>
  );
}

/* ─── Велика кнопка дії ───────────────────────────────────── */
export function PrimaryButton({ onClick, children, disabled = false, variant = 'accent', icon = null }) {
  const styles = {
    accent: { background: '#6B8AFE', color: '#fff', border: 'none' },
    neutral: { background: '#16161C', color: '#ECECF0', border: '1px solid #232329' },
    danger: { background: 'transparent', color: '#FF6B7A', border: '1px solid rgba(255,107,122,0.3)' },
    success: { background: 'transparent', color: '#4ADE80', border: '1px solid rgba(74,222,128,0.3)' },
  }[variant];
  return (
    <button
      onClick={() => { hapticLight(); onClick?.(); }}
      disabled={disabled}
      className="lin-primary-btn"
      style={{
        width: '100%', padding: '14px 16px', borderRadius: 13,
        fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
        ...styles,
      }}
    >
      {icon}{children}
    </button>
  );
}
