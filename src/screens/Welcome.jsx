/**
 * Welcome screen — Linear-style redesign.
 *
 * Layout:
 *   - Pure black background, subtle dot-grid pattern
 *   - Large 3D-feel M logo centered (with gradient + shadow)
 *   - "Welcome to" small + "Morok" large below it
 *   - Two CTA buttons at bottom: primary "Створити акаунт", secondary "Відновити"
 *   - Tiny footer "v0.4 · beta"
 */

export default function Welcome({ onNavigate }) {
  return (
    <div className="screen" style={{
      background: '#0A0A0B',
      display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Dot-grid background pattern */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(circle, #1A1A22 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        opacity: 0.6,
        pointerEvents: 'none',
      }} />

      {/* Logo + title — vertically centered in upper 60% */}
      <div style={{
        flex: 1,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px 20px',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Large 3D-feel M logo */}
        <div style={{
          width: 140, height: 140,
          borderRadius: 32,
          background: 'linear-gradient(135deg, #7B96FF 0%, #5A6FE0 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 20px 60px rgba(107, 138, 254, 0.4), inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -4px 8px rgba(0,0,0,0.2)',
          marginBottom: 40,
          position: 'relative',
        }}>
          <span style={{
            color: 'white',
            fontSize: 82,
            fontWeight: 800,
            letterSpacing: '-0.04em',
            lineHeight: 1,
            textShadow: '0 4px 12px rgba(0,0,0,0.3)',
            marginTop: -4,
          }}>M</span>
        </div>

        <div style={{
          fontSize: 13.5, color: '#A4A6B2',
          fontWeight: 500,
          marginBottom: 8,
          letterSpacing: '0.01em',
        }}>
          Ласкаво просимо в
        </div>

        <div style={{
          fontSize: 42, fontWeight: 800,
          color: '#F5F5F7',
          letterSpacing: '-0.035em',
          lineHeight: 1,
          marginBottom: 16,
        }}>
          Morok
        </div>

        <div style={{
          fontSize: 14, color: '#ABADB8',
          textAlign: 'center',
          maxWidth: 320,
          lineHeight: 1.55,
          letterSpacing: '-0.005em',
        }}>
          Месенджер який нічого про вас не знає.
          Без телефону, без email, без слідів.
        </div>
      </div>

      {/* CTAs at the bottom */}
      <div style={{
        padding: '20px 20px 28px',
        display: 'flex', flexDirection: 'column',
        gap: 10,
        position: 'relative',
        zIndex: 1,
      }}>
        <button
          onClick={() => onNavigate('create')}
          style={{
            width: '100%',
            padding: '16px 22px',
            borderRadius: 14,
            background: '#F5F5F7',
            color: '#0A0A0B',
            border: 'none',
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '-0.005em',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'transform 0.12s, background 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#FFFFFF'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#F5F5F7'; }}
        >
          Створити акаунт
        </button>

        <button
          onClick={() => onNavigate('login')}
          style={{
            width: '100%',
            padding: '16px 22px',
            borderRadius: 14,
            background: '#16161B',
            color: '#F5F5F7',
            border: '1px solid #232329',
            fontSize: 15,
            fontWeight: 500,
            letterSpacing: '-0.005em',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#1E1E27'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#16161B'; }}
        >
          У мене вже є акаунт
        </button>

        <button
          onClick={() => onNavigate('restore')}
          style={{
            width: '100%',
            padding: '10px',
            background: 'transparent',
            border: 'none',
            color: '#A4A6B2',
            fontSize: 12.5,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
            marginTop: 4,
          }}
        >
          Відновити бекапом із сервера
        </button>

        <div style={{
          marginTop: 14,
          fontSize: 12,
          color: '#8B8D99',
          letterSpacing: '0.02em',
          textAlign: 'center',
          fontWeight: 500,
        }}>
          Morok · v0.4.1 · beta
        </div>
      </div>
    </div>
  );
}
