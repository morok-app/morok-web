/**
 * SafetyNumber — звірка ключів проти MITM (як у Signal). 6 груп цифр,
 * однакових у обох сторін, + QR. Локальна позначка «підтверджено».
 * Дзеркало RN-екрана. Навігація: #safety/<peerPubkey>.
 */

import { useEffect, useState, useRef } from 'react';
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

  // ── QR-сканер (BarcodeDetector; без зовнішніх залежностей) ──
  // Наводиш камеру на QR іншої сторони → payload порівнюється з нашим
  // qrPayload (він однаковий у обох, бо ключі відсортовані) → збіг =
  // ключі підтверджено автоматично; розбіжність = червоне попередження.
  const scannerSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // 'match' | 'mismatch' | 'error'
  const videoRef = useRef(null);
  const scanStopRef = useRef(null);

  async function startScan() {
    setScanResult(null);
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      let stopped = false;
      scanStopRef.current = () => {
        stopped = true;
        stream.getTracks().forEach((t) => t.stop());
      };
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(video);
          const raw = codes[0]?.rawValue;
          if (raw && raw.startsWith('morok-sn:')) {
            scanStopRef.current?.();
            setScanning(false);
            const ok = raw === qrPayload;
            setScanResult(ok ? 'match' : 'mismatch');
            if (ok && !verified) {
              safety.setVerified(peerPubkey, true);
              setVerifiedState(true);
            }
            return;
          }
        } catch { /* кадр не розпізнався — норм */ }
        setTimeout(tick, 250);
      };
      tick();
    } catch (e) {
      setScanning(false);
      setScanResult('error');
    }
  }

  function stopScan() {
    scanStopRef.current?.();
    setScanning(false);
  }

  useEffect(() => () => { scanStopRef.current?.(); }, []);

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

        {/* ── Сканер QR іншої сторони ── */}
        <div className="lin-group-label" style={{ marginTop: 26 }}>СКАНУВАТИ ЇХНІЙ QR</div>
        {scanning ? (
          <div style={{
            background: '#13131A', border: '1px solid #232329', borderRadius: 16,
            padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          }}>
            <video
              ref={videoRef}
              muted playsInline
              style={{ width: '100%', maxWidth: 320, borderRadius: 12, background: '#000' }}
            />
            <span style={{ color: '#8A8A95', fontSize: 13 }}>Наведіть на QR на екрані співрозмовника</span>
            <PrimaryButton onClick={stopScan} variant="neutral">Скасувати</PrimaryButton>
          </div>
        ) : (
          <>
            {scannerSupported ? (
              <PrimaryButton
                onClick={startScan}
                variant="neutral"
                icon={
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                    <rect x="8" y="8" width="8" height="8" rx="1" />
                  </svg>
                }
              >
                Сканувати QR співрозмовника
              </PrimaryButton>
            ) : (
              <div style={{
                background: '#13131A', border: '1px solid #232329', borderRadius: 14,
                padding: '13px 16px', color: '#6B6B72', fontSize: 13, textAlign: 'center',
              }}>
                Сканер недоступний у цьому браузері — звірте цифри вручну
              </div>
            )}
            {scanResult === 'match' && (
              <div style={{
                marginTop: 12, padding: '13px 16px', borderRadius: 14, textAlign: 'center',
                background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.35)',
                color: '#4ADE80', fontSize: 14, fontWeight: 600,
              }}>
                ✓ Ключі збігаються — з'єднання захищене, позначено як підтверджене
              </div>
            )}
            {scanResult === 'mismatch' && (
              <div style={{
                marginTop: 12, padding: '13px 16px', borderRadius: 14, textAlign: 'center',
                background: 'rgba(255,107,122,0.08)', border: '1px solid rgba(255,107,122,0.4)',
                color: '#FF6B7A', fontSize: 14, fontWeight: 600,
              }}>
                ✗ Ключі НЕ збігаються! Можливе перехоплення — не довіряйте цьому чату
              </div>
            )}
            {scanResult === 'error' && (
              <div style={{
                marginTop: 12, padding: '13px 16px', borderRadius: 14, textAlign: 'center',
                background: '#13131A', border: '1px solid #232329',
                color: '#8A8A95', fontSize: 13,
              }}>
                Не вдалося відкрити камеру — перевірте дозвіл у браузері
              </div>
            )}
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
