/**
 * Invites — одноразові запрошення (див. lib/invites.js). Дзеркало
 * morok-rn/screens/Invites.js.
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import * as invites from '../lib/invites.js';
import * as contacts from '../lib/contacts.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { t, tp } from '../lib/i18n.js';

function fmtLeft(exp) {
  const s = exp - Math.floor(Date.now() / 1000);
  if (s <= 0) return t('expired');
  if (s < 3600) return tp('{0} min left', [Math.max(1, Math.round(s / 60))]);
  if (s < 86400) return tp('{0} h left', [Math.round(s / 3600)]);
  return tp('{0} d left', [Math.round(s / 86400)]);
}
function fmtWhen(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function whoLabel(pk) {
  if (!pk) return '';
  const c = contacts.getByPubkey(pk);
  return c?.username ? `@${c.username}` : `${pk.slice(0, 10)}…`;
}

const card = { background: '#13131A', border: '1px solid #232329', borderRadius: 14, padding: 16 };
const btn = {
  flex: 1, padding: '11px 14px', borderRadius: 10, background: '#16161B', border: '1px solid #232329',
  color: '#F5F5F7', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

export default function Invites({ onNavigate }) {
  const profile = store.loadProfile();
  const myPubkey = profile?.pubkey_hex || store.loadIdentity()?.pubkey_hex || null;
  const myUsername = profile?.username || null;
  const [list, setList] = useState(() => invites.listInvites());
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(1);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(null);   // { nonce, link }
  const [qrUrl, setQrUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const reload = () => setList(invites.listInvites());
  useEffect(() => {
    const seed = vault.getUnlockedSeed();
    invites.pruneInvites({ seed, myPubkeyHex: myPubkey }).then(reload).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!fresh?.link) { setQrUrl(null); return; }
    QRCode.toDataURL(fresh.link, { width: 260, margin: 2, color: { dark: '#F5F5F7', light: '#0A0A0B' } }).then(setQrUrl).catch(() => setQrUrl(null));
  }, [fresh?.link]);

  async function create() {
    if (!myPubkey || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await invites.createInvite({ label, days, myPubkeyHex: myPubkey, myUsername });
      setFresh({ nonce: r.nonce, link: r.link });
      setLabel('');
      reload();
    } catch (e) {
      setError(e?.code === 'limit'
        ? tp('You can have at most {0} active invites. Revoke one first.', [invites.MAX_ACTIVE])
        : t('Could not create an invite. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  }
  function copy(link) {
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }
  async function revoke(inv) {
    if (!window.confirm(t('Revoke this invite? The link will stop working.'))) return;
    await invites.revokeInvite(inv.nonce);
    if (fresh?.nonce === inv.nonce) setFresh(null);
    reload();
  }

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>
      <div style={{ padding: '20px 20px 18px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', color: '#F5F5F7', lineHeight: 1.1 }}>{t('One-time invites')}</div>
          <div style={{ fontSize: 13, color: '#A4A6B2', marginTop: 6 }}>{t('A link for one person')}</div>
        </div>
        <button
          onClick={() => onNavigate('profile')}
          aria-label={t('Back')}
          style={{ width: 36, height: 36, borderRadius: '50%', background: '#16161B', border: '1px solid #232329', color: '#A8A8B0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ color: '#A8A8B0', fontSize: 13.5, lineHeight: 1.55 }}>
          {t('Whoever uses the link first lands straight in your contacts (not in «Requests»). After that the link stops working on the server. Make sure it really is the right person — verify keys with them.')}
        </div>

        {fresh ? (
          <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {qrUrl ? <img src={qrUrl} alt="QR" style={{ width: 220, height: 220, borderRadius: 8 }} /> : <div style={{ width: 220, height: 220 }} />}
            <div style={{ width: '100%', fontSize: 11.5, color: '#ABADB8', fontFamily: 'var(--mono, monospace)', wordBreak: 'break-all', textAlign: 'center' }}>{fresh.link}</div>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <button type="button" style={btn} onClick={() => copy(fresh.link)}>{copied ? t('✓ Copied') : t('Copy link')}</button>
              <button type="button" style={btn} onClick={() => setFresh(null)}>{t('Create another')}</button>
            </div>
          </div>
        ) : (
          <div style={card}>
            <div style={{ color: '#9EA0AC', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t('Who is it for (only you see this)')}</div>
            <input
              type="text"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('e.g. «Olya from the course»')}
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, background: '#0A0A0B', border: '1px solid #232329', color: '#F5F5F7', fontSize: 14, fontFamily: 'inherit' }}
            />
            <div style={{ color: '#9EA0AC', fontSize: 12, fontWeight: 700, margin: '14px 0 8px' }}>{t('Valid for')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {invites.TTL_CHOICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  style={{
                    padding: '9px 16px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                    background: days === d ? 'rgba(123,150,255,0.12)' : 'transparent',
                    border: '1px solid ' + (days === d ? '#7B96FF' : '#232329'),
                    color: days === d ? '#7B96FF' : '#A8A8B0',
                  }}
                >{d === 1 ? t('1 day') : tp('{0} days', [d])}</button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={create}
              style={{ marginTop: 16, width: '100%', padding: '12px 14px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #7B96FF 0%, #5A6FE0 100%)', color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, fontFamily: 'inherit' }}
            >{busy ? t('Creating…') : t('Create invite')}</button>
            {error && <div style={{ color: '#FF6B7A', fontSize: 13, marginTop: 10 }}>{error}</div>}
          </div>
        )}

        {list.length > 0 && (
          <div style={{ fontSize: 11, color: '#6B6B72', fontFamily: 'var(--mono, monospace)', letterSpacing: '0.08em', marginTop: 8 }}>{t('INVITES')}</div>
        )}
        {list.map((inv) => (
          <div key={inv.nonce} style={{ ...card, padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#F5F5F7', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.label || t('No label')}</div>
              <div style={{ color: '#8A8C96', fontSize: 12, marginTop: 2 }}>
                {inv.status === 'active' && `${t('Active')} · ${fmtLeft(inv.exp)}`}
                {inv.status === 'used' && tp('Used by {0} · {1}', [whoLabel(inv.used_by), fmtWhen(inv.used_at)])}
                {inv.status === 'expired' && t('Expired')}
                {inv.status === 'revoked' && t('Revoked')}
              </div>
              {inv.tries > 0 && (
                <div style={{ color: '#FFB454', fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>
                  {tp('⚠ Someone else also tried this link ({0}) — it seems to have been forwarded', [inv.tries])}
                  {inv.last_try_by ? ` (${tp('last: {0}', [whoLabel(inv.last_try_by)])})` : ''}.
                </div>
              )}
            </div>
            {inv.status === 'active' && (
              <>
                <button type="button" style={{ ...btn, flex: 'none', padding: '8px 10px' }} onClick={() => setFresh({ nonce: inv.nonce, link: invites.linkFor(inv.nonce, { myPubkeyHex: myPubkey, myUsername }) })}>{t('Show')}</button>
                <button type="button" style={{ ...btn, flex: 'none', padding: '8px 10px', color: '#FF6B7A' }} onClick={() => revoke(inv)}>{t('Revoke')}</button>
              </>
            )}
            {inv.status === 'used' && inv.used_by && (
              <>
                <button type="button" style={{ ...btn, flex: 'none', padding: '8px 10px' }} onClick={() => onNavigate(`safety/${inv.used_by}`)}>{t('Verify keys')}</button>
                <button type="button" style={{ ...btn, flex: 'none', padding: '8px 10px' }} onClick={() => onNavigate(`chat/${inv.used_by}`)}>{t('Chat')}</button>
              </>
            )}
          </div>
        ))}

        <div style={{ color: '#6B6B72', fontSize: 12, lineHeight: 1.5, marginTop: 6 }}>
          {t('The link contains your public key and a one-time delivery token. Whoever intercepts it before the recipient becomes the «first» — so send it directly and check who used it.')}
        </div>
      </div>
    </div>
  );
}
