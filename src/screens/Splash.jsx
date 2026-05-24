export default function Splash() {
  return (
    <div className="screen" style={{
      background: '#0A0A0B',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Dot grid bg */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(circle, #1A1A22 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        opacity: 0.4,
        pointerEvents: 'none',
      }} />

      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 24,
        position: 'relative', zIndex: 1,
      }}>
        {/* M logo */}
        <div style={{
          width: 96, height: 96,
          borderRadius: 22,
          background: 'linear-gradient(135deg, #7B96FF 0%, #5A6FE0 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 800, fontSize: 56,
          letterSpacing: '-0.04em',
          boxShadow: '0 16px 48px rgba(107, 138, 254, 0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
          textShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}>M</div>

        <div style={{
          fontSize: 22, fontWeight: 700,
          color: '#F5F5F7',
          letterSpacing: '-0.02em',
        }}>
          Morok
        </div>

        {/* Spinner */}
        <div style={{
          width: 28, height: 28,
          border: '2px solid #232329',
          borderTopColor: '#7B96FF',
          borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
          marginTop: 8,
        }} />
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
