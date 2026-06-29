/**
 * SafetyNumber — звірка ключів проти MITM (як у Signal). 6 груп цифр,
 * однакових у обох сторін, + QR. Локальна позначка «підтверджено».
 * Дзеркало RN-екрана. Навігація: #safety/<peerPubkey>.
 */

import { useEffect, useState } from 'react';
import { TopBar, Section, PrimaryButton } from '../components/ui.jsx';
import * as store from '../lib/storage.js';
import * as convs from '../lib/conversations.js';
import * as safety from '../lib/safety.js';
import QRCode from 'qrcode';

export default function SafetyNumber({ peerPubkey, onNavigate }) {
  const conv = convs.getConversation(peerPubkey);
  const peerUsername = conv?.peer_username || null;
  const myPubkey = store.loadIdentity()?.pubkey_hex || '';

  const sn = safety.safetyNumber(myPubkey, peerPubkey);
  const qrPayload = safety.safetyQrPayload(myPubkey, peerPubkey);
  const [verified, setVerifiedState] = useState(() => safety.isVerified(peerPubkey));
  const [qrUrl, setQrUrl] = useState(null);

  useEffect(() => {
    if (!qrPayload) return;
    QRCode.toDataURL(qrPayload, {
      width: 220, margin: 1,
      color: { dark: '#F5F5F7', light: '#13131A' },
    }).then(setQrUrl).catch(() => {});
  }, [qrPayload]);

  function toggleVerified() {
    const next = !verified;
    safety.setVerified(peerPubkey, next);
    setVerifiedState(next);
  }

  const peerLabel = peerUsername ? `@${peerUsername}` : `${(peerPubkey || '').slice(0, 10)}…`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      <TopBar title="Номер безпеки" onBack={() => onNavigate(`peer/${peerPubkey}`)} />

      <div style={{ padding: '0 18px 32px' }}>
        <p style={{ color: '#8A8A95', fontSize: 14, lineHeight: 1.5, marginTop: 0, marginBottom: 22 }}>
          Порівняйте ці числа з {peerLabel} — у дзвінку, особисто або через інший
          канал. Якщо вони однакові, ваше з'єднання захищене й ніхто не підмінив ключі.
        </p>

        {sn ? (
          <div style={{
            background: '#13131A', border: '1px solid #232329', borderRadius: 16,
            padding: '24px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 14, justifyItems: 'center',
          }}>
            {sn.groups.map((g, i) => (
              <span key={i} style={{
                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                fontSize: 24, letterSpacing: 3, color: '#ECECF0',
              }}>{g}</span>
            ))}
          </div>
        ) : (
          <div style={{ background: '#13131A', border: '1px solid #232329', borderRadius: 16, padding: 22, textAlign: 'center', color: '#FF6B7A', fontSize: 13 }}>
            Не вдалося обчислити — некоректні ключі.
          </div>
        )}

        {qrUrl && (
          <>
            <div className="lin-group-label" style={{ marginTop: 26 }}>QR ДЛЯ ЗВІРКИ</div>
            <div style={{
              background: '#13131A', border: '1px solid #232329', borderRadius: 16,
              padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <img src={qrUrl} alt="QR" style={{ width: 200, height: 200, borderRadius: 10 }} />
              <span style={{ color: '#6B6B72', fontSize: 12, marginTop: 12 }}>
                Інша сторона зможе відсканувати для звірки
              </span>
            </div>
          </>
        )}

        <div style={{ marginTop: 26 }}>
          <PrimaryButton
            onClick={toggleVerified}
            variant={verified ? 'success' : 'neutral'}
            icon={
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                {verified && <polyline points="9 12 11 14 15 10" />}
              </svg>
            }
          >
            {verified ? 'Підтверджено' : 'Позначити як підтверджений'}
          </PrimaryButton>
        </div>

        <p style={{ color: '#3F3F45', fontSize: 12, lineHeight: 1.5, textAlign: 'center', marginTop: 16 }}>
          Позначка зберігається лише на вашому пристрої. Сервер про неї не знає.
        </p>
      </div>
    </div>
  );
}
