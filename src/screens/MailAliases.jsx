import { useEffect, useState, useCallback } from 'react';
import * as api from '../lib/api.js';
import { TopBar } from '../components/ui.jsx';

const ACCENT = '#7B96FF';
const BG = '#0A0A0B';
const SURFACE = '#16161B';
const BORDER = '#232329';
const TEXT = '#F5F5F7';
const MUTED = '#A8AAB5';

const STATUS_UI = {
  active: { label: 'активний', color: '#4ADE80', bg: 'rgba(74,222,128,0.12)' },
  paused: { label: 'на паузі', color: '#FFA94D', bg: 'rgba(255,169,77,0.12)' },
  dead:   { label: 'вбитий',   color: '#FF6B6B', bg: 'rgba(255,90,90,0.10)' },
};

export default function MailAliases({ onNavigate }) {
  const [data, setData] = useState(null);      // {quota, used, aliases[]}
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [copied, setCopied] = useState(null);  // address щойно скопійована

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const d = await api.mailListAliases();
      setData(d);
    } catch (e) {
      setErr(e.message || 'Не вдалося завантажити адреси');
      setData({ quota: 0, used: 0, aliases: [] });
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function createAlias(alias, primary = false) {
    setBusy(true); setErr(null);
    try {
      await api.mailCreateAlias({ alias, primary, label: customLabel.trim() || null });
      setShowCreate(false); setCustomName(''); setCustomLabel('');
      await reload();
    } catch (e) {
      setErr(e.message || 'Не вдалося створити адресу');
    } finally { setBusy(false); }
  }

  async function editLabel(a) {
    const cur = a.label || '';
    const next = window.prompt(
      'Підпис: для чого ця адреса? (олх, netflix, розсилки…)\nПорожньо — прибрати підпис.',
      cur,
    );
    if (next === null || next.trim() === cur) return;
    setBusy(true); setErr(null);
    try {
      await api.mailSetAliasLabel(a.alias, next.trim());
      await reload();
    } catch (e) {
      setErr(e.message || 'Не вдалося зберегти підпис');
    } finally { setBusy(false); }
  }

  async function doAction(a, action) {
    setBusy(true); setErr(null);
    try {
      if (action === 'pause') await api.mailPauseAlias(a.alias);
      if (action === 'resume') await api.mailResumeAlias(a.alias);
      if (action === 'kill') {
        // незворотньо — перепитуємо
        if (!window.confirm(`Вбити адресу ${a.address}?\n\nЛисти на неї перестануть приходити НАЗАВЖДИ, адресу не можна буде відновити чи створити знову.`)) {
          setBusy(false); return;
        }
        await api.mailKillAlias(a.alias);
      }
      await reload();
    } catch (e) {
      setErr(e.message || 'Не вдалося виконати дію');
    } finally { setBusy(false); }
  }

  async function copy(address) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
      setTimeout(() => setCopied(null), 1600);
    } catch { /* ignore */ }
  }

  const aliases = data?.aliases || [];
  const alive = aliases.filter((a) => a.status !== 'dead');
  const quotaLine = data
    ? `Аліасів: ${data.used} з ${data.quota} доступних (+1 щомісяця)`
    : ' ';

  return (
    <div className="screen" style={{ background: BG, minHeight: '100%' }}>
      <TopBar
        title="Мої адреси"
        subtitle={quotaLine}
        onBack={() => onNavigate('mail')}
        backIcon="arrow"
        right={
          <button
            onClick={() => setShowCreate((v) => !v)}
            disabled={busy}
            style={{
              background: showCreate ? 'transparent' : 'rgba(123,150,255,0.12)',
              color: ACCENT, border: `1px solid ${BORDER}`, borderRadius: 10,
              padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >{showCreate ? 'Скасувати' : '+ Нова'}</button>
        }
      />

      <style>{`
        .mk-in:focus { border-color: #7B96FF !important; outline: none; }
        .mk-in { transition: border-color 0.15s; }
      `}</style>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px 32px' }}>

        {err && (
          <div style={{
            background: 'rgba(255,90,90,0.08)', border: '1px solid rgba(255,90,90,0.25)',
            color: '#FF8787', borderRadius: 12, padding: '10px 14px', fontSize: 13, marginBottom: 14,
          }}>{err}</div>
        )}

        {/* ── Основна адреса (username → email), якщо ще не активована ── */}
        {data && !data.aliases?.some((a) => a.primary && a.status !== 'dead') && (
          <div style={{
            background: 'rgba(123,150,255,0.07)', border: '1px solid rgba(123,150,255,0.3)',
            borderRadius: 14, padding: 16, marginBottom: 14,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 6 }}>
              Основна адреса
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, marginBottom: 12 }}>
              Ваш нік у Morok стане вашою поштою: <b style={{ color: TEXT }}>@нік → нік@morok.email</b>.
              Основну адресу не можна вбити — це ваша постійна скринька.
            </div>
            <button
              onClick={() => createAlias(null, true)}
              disabled={busy}
              style={{
                background: ACCENT, color: '#0A0A0B', border: 'none', borderRadius: 10,
                padding: '10px 16px', fontSize: 13.5, fontWeight: 700,
                cursor: 'pointer', opacity: busy ? 0.5 : 1,
              }}
            >Активувати мою адресу</button>
          </div>
        )}

        {/* ── Створення ── */}
        {showCreate && (
          <div style={{
            background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14,
            padding: 16, marginBottom: 18,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 10 }}>
              Нова адреса
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <input
                className="mk-in"
                value={customName}
                onChange={(e) => setCustomName(e.target.value.toLowerCase())}
                placeholder="вигадай-свою"
                spellCheck={false}
                style={{
                  flex: 1, minWidth: 0, background: BG, color: TEXT,
                  border: `1px solid ${BORDER}`, borderRadius: 10,
                  padding: '10px 12px', fontSize: 14, outline: 'none',
                }}
              />
              <span style={{ color: MUTED, fontSize: 14, flexShrink: 0 }}>@morok.email</span>
            </div>
            <input
              className="mk-in"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="для чого? (олх, netflix…) — необов'язково"
              maxLength={64}
              style={{
                width: '100%', boxSizing: 'border-box', background: BG, color: TEXT,
                border: `1px solid ${BORDER}`, borderRadius: 10,
                padding: '10px 12px', fontSize: 14, outline: 'none', marginBottom: 12,
              }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => createAlias(customName.trim() || null)}
                disabled={busy || !customName.trim()}
                style={{
                  background: ACCENT, color: '#0A0A0B', border: 'none', borderRadius: 10,
                  padding: '10px 16px', fontSize: 13.5, fontWeight: 700,
                  cursor: 'pointer', opacity: busy || !customName.trim() ? 0.5 : 1,
                }}
              >Створити цю</button>
              <button
                onClick={() => createAlias(null)}
                disabled={busy}
                style={{
                  background: 'transparent', color: ACCENT, border: `1px solid ${BORDER}`,
                  borderRadius: 10, padding: '10px 16px', fontSize: 13.5, fontWeight: 600,
                  cursor: 'pointer', opacity: busy ? 0.5 : 1,
                }}
              >🎲 Випадкову</button>
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 10, lineHeight: 1.5 }}>
              3–64 символи: малі латинські, цифри, дефіс, крапка. Випадкова —
              на кшталт <span style={{ color: TEXT }}>wren-otter-042</span>.
            </div>
          </div>
        )}

        {/* ── Порожньо ── */}
        {data && aliases.length === 0 && !showCreate && (
          <div style={{ textAlign: 'center', padding: '50px 24px', color: MUTED }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✉️</div>
            <div style={{ fontSize: 15, color: TEXT, marginBottom: 6 }}>Адрес поки немає</div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              Активуйте основну адресу вище, а для сайтів і розсилок<br />
              створюйте окремі аліаси кнопкою «+ Нова».
            </div>
          </div>
        )}

        {/* ── Список ── */}
        {alive.map((a) => {
          const st = STATUS_UI[a.status] || STATUS_UI.active;
          return (
            <div
              key={a.alias}
              style={{
                background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14,
                padding: '12px 14px', marginBottom: 9,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => copy(a.address)}
                  title="Скопіювати адресу"
                  style={{
                    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                    fontSize: 14.5, fontWeight: 700, color: copied === a.address ? '#4ADE80' : TEXT,
                    display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {copied === a.address ? '✓ скопійовано' : a.address}
                  </span>
                  {a.primary && (
                    <span style={{
                      fontSize: 12.5, fontWeight: 700, color: ACCENT, letterSpacing: '0.04em',
                      border: `1px solid rgba(123,150,255,0.4)`, borderRadius: 6, padding: '2px 6px',
                    }}>ОСНОВНА</span>
                  )}
                </button>
                {!a.primary && (
                  <button
                    onClick={() => editLabel(a)}
                    disabled={busy}
                    title="Підпис: для чого ця адреса (клік — змінити)"
                    style={{
                      background: a.label ? 'rgba(160,123,255,0.12)' : 'transparent',
                      color: a.label ? '#A07BFF' : MUTED,
                      border: `1px dashed ${a.label ? 'rgba(160,123,255,0.4)' : BORDER}`,
                      borderRadius: 6, padding: '2px 8px', fontSize: 12.5, fontWeight: 600,
                      cursor: 'pointer', maxWidth: 160, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >{a.label || '+ підпис'}</button>
                )}
                <span style={{
                  fontSize: 12.5, fontWeight: 600, color: st.color, background: st.bg,
                  borderRadius: 8, padding: '3px 9px', flexShrink: 0,
                }}>{st.label}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
                <span style={{ fontSize: 12, color: MUTED }}>
                  прийнято листів: {a.received ?? 0}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {a.status === 'active' && (
                    <MiniBtn onClick={() => doAction(a, 'pause')} disabled={busy} title="Листи тихо зникатимуть, відправник не дізнається">
                      Пауза
                    </MiniBtn>
                  )}
                  {a.status === 'paused' && (
                    <MiniBtn onClick={() => doAction(a, 'resume')} disabled={busy} accent>
                      Увімкнути
                    </MiniBtn>
                  )}
                  {!a.primary && (
                    <MiniBtn onClick={() => doAction(a, 'kill')} disabled={busy} danger title="Назавжди. Адреса не відновлюється.">
                      Вбити
                    </MiniBtn>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* мертві — згорнуто, сірим */}
        {aliases.some((a) => a.status === 'dead') && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 8, fontWeight: 600 }}>Вбиті адреси</div>
            {aliases.filter((a) => a.status === 'dead').map((a) => (
              <div key={a.alias} style={{
                color: MUTED, fontSize: 13, padding: '8px 4px',
                textDecoration: 'line-through', opacity: 0.7,
              }}>{a.address}</div>
            ))}
          </div>
        )}

        {/* пояснення станів */}
        {alive.length > 0 && (
          <div style={{
            marginTop: 22, fontSize: 12, color: MUTED, lineHeight: 1.6,
            borderTop: `1px solid ${BORDER}`, paddingTop: 14,
          }}>
            <b style={{ color: TEXT }}>Пауза</b> — листи тихо зникають, відправник не знає, що ви його відрізали.<br />
            <b style={{ color: TEXT }}>Вбити</b> — адреса мертва назавжди (SMTP 550), її ніхто не зможе зайняти знову.<br />
            Клік по адресі — копіювання в буфер.
          </div>
        )}
      </div>
    </div>
  );
}

function MiniBtn({ children, onClick, disabled, danger, accent, title }) {
  const color = danger ? '#FF6B6B' : accent ? '#0A0A0B' : '#A8AAB5';
  const bg = danger ? 'rgba(255,90,90,0.1)' : accent ? ACCENT : 'transparent';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: bg, color, border: `1px solid ${danger ? 'rgba(255,90,90,0.25)' : BORDER}`,
        borderRadius: 9, padding: '6px 12px', fontSize: 12.5, fontWeight: 600,
        cursor: 'pointer', opacity: disabled ? 0.5 : 1,
      }}
    >{children}</button>
  );
}
