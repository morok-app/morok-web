export default function Welcome({ onNavigate }) {
  return (
    <div className="onb">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: '0 8px' }}>
        <div style={{
          width: 88, height: 88, borderRadius: 24,
          background: 'linear-gradient(135deg, var(--accent) 0%, #4A5FB0 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 40, fontWeight: 800, color: '#FFF',
        }}>M</div>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.025em' }}>Morok</h1>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 10, maxWidth: 280, lineHeight: 1.55 }}>
            Месенджер який нічого не зберігає. Без телефонів, без email, без імен.
          </p>
        </div>
      </div>
      <div className="onb-footer">
        <button className="btn btn-primary" onClick={() => onNavigate('create')}>
          Створити аккаунт
        </button>
        <button className="btn btn-secondary" onClick={() => onNavigate('login')}>
          Увійти за ключем
        </button>
      </div>
    </div>
  );
}
