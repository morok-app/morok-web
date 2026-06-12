import { shareOrigin } from '../lib/share_origin.js';
import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import * as gstore from '../lib/group_storage.js';
import * as groups from '../lib/groups.js';
import * as store from '../lib/storage.js';
import * as vault from '../lib/vault.js';
import { parseAddress } from '../lib/addr.js';
import { hexToBytes } from '../lib/crypto.js';

function getSeedBytes() {
  const v = vault.getUnlockedSeed();
  if (v) return v;
  const id = store.loadIdentity();
  if (id && !id.encrypted && id.seed_hex) return hexToBytes(id.seed_hex);
  return null;
}

export default function GroupInfo({ groupId, onNavigate }) {
  const me = store.loadProfile();
  const myPubkeyHex = me?.pubkey_hex || store.loadIdentity()?.pubkey_hex;

  const [group, setGroup] = useState(() => gstore.getGroup(groupId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [activeInvite, setActiveInvite] = useState(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [copied, setCopied] = useState(false);

  const isAdmin = group?.creator_pubkey_hex === myPubkeyHex;
  const isCreator = isAdmin;

  useEffect(() => {
    (async () => {
      try {
        await groups.refreshGroup(groupId);
        setGroup(gstore.getGroup(groupId));
      } catch (e) {
        console.warn(e);
      }
    })();
  }, [groupId]);

  async function createInviteLink() {
    if (!isAdmin) return;
    setBusy(true);
    setMessage(null);
    try {
      const info = await api.createInviteToken(groupId, null);
      const link = `${shareOrigin()}/web/#join?t=${info.token}`;
      setActiveInvite({ ...info, link });
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
      setMessage('Лінк створено і скопійовано');
    } catch (e) {
      setMessage('Помилка: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyInviteLink() {
    if (!activeInvite) return;
    try {
      await navigator.clipboard.writeText(activeInvite.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function addByUsername() {
    if (!addInput.trim() || !isAdmin) return;
    const seed = getSeedBytes();
    if (!seed) { alert('Сеанс закінчився.'); return; }

    setBusy(true); setMessage(null);
    try {
      const parsed = parseAddress(addInput);
      const user = await api.lookupUsername(parsed.username, parsed.relay || undefined);
      await groups.addMemberAndSendKey({
        groupId,
        newPubkeyHex: user.pubkey_hex,
        seed,
        myPubkeyHex,
      });
      setGroup(gstore.getGroup(groupId));
      setMessage(`@${user.username} додано і ключ надіслано`);
      setAddInput('');
      setShowAddMember(false);
    } catch (e) {
      setMessage('Помилка: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(pubkeyHex) {
    if (!isAdmin) return;
    if (!confirm('Видалити учасника з групи?')) return;
    setBusy(true);
    try {
      await api.removeGroupMember(groupId, pubkeyHex);
      await groups.refreshGroup(groupId);
      setGroup(gstore.getGroup(groupId));
      setMessage('Видалено');
    } catch (e) {
      setMessage('Помилка: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function leaveGroupClicked() {
    if (!confirm('Вийти з групи?')) return;
    setBusy(true);
    try {
      await groups.leaveGroup(groupId, myPubkeyHex);
      onNavigate('chats');
    } catch (e) {
      setMessage('Помилка: ' + e.message);
      setBusy(false);
    }
  }

  async function deleteGroupClicked() {
    if (!isCreator) return;
    if (!confirm('Видалити групу для всіх? Це незворотньо.')) return;
    setBusy(true);
    try {
      await groups.deleteGroupCompletely(groupId, getSeedBytes());
      onNavigate('chats');
    } catch (e) {
      setMessage('Помилка: ' + e.message);
      setBusy(false);
    }
  }

  if (!group) {
    return (
      <div className="screen" style={{ background: '#0A0A0B' }}>
        <Header title="Група" onClose={() => onNavigate('chats')} />
        <div style={{ flex: 1 }} />
      </div>
    );
  }

  const members = group.members || [];

  return (
    <div className="screen" style={{ background: '#0A0A0B' }}>

      <Header title="Інфо групи" onClose={() => onNavigate(`group/${groupId}`)} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px' }}>

        {message && (
          <div style={{
            background: 'rgba(74, 222, 128, 0.08)',
            border: '1px solid rgba(74, 222, 128, 0.25)',
            color: '#4ADE80',
            padding: '10px 14px', borderRadius: 10,
            fontSize: 13, marginBottom: 16,
          }}>{message}</div>
        )}

        {/* Group hero */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 12,
          paddingBottom: 24, marginBottom: 8,
        }}>
          <div style={{
            width: 84, height: 84, borderRadius: 22,
            background: 'linear-gradient(135deg, #7B96FF 0%, #5A6FE0 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white',
            boxShadow: '0 12px 36px rgba(107, 138, 254, 0.25)',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div style={{
            fontSize: 20, fontWeight: 700,
            color: '#F5F5F7',
            letterSpacing: '-0.02em',
            textAlign: 'center',
          }}>
            {group.name || 'Без назви'}
          </div>
          <div style={{
            fontSize: 12, color: '#6B6B72',
            fontFamily: 'var(--mono, monospace)',
            letterSpacing: '0.02em',
          }}>
            {members.length} / {group.max_members} учасників
          </div>
        </div>

        {/* Admin actions */}
        {isAdmin && (
          <>
            <SectionLabel>Запросити</SectionLabel>
            <button
              onClick={createInviteLink}
              disabled={busy}
              style={{
                width: '100%',
                padding: '14px 22px',
                borderRadius: 14,
                background: busy ? '#2A2A33' : '#F5F5F7',
                color: busy ? '#5A5A65' : '#0A0A0B',
                border: 'none',
                fontSize: 14, fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                marginBottom: 8,
              }}
            >
              {busy ? '...' : 'Створити лінк запрошення'}
            </button>

            {activeInvite && (
              <div style={{
                background: '#13131A',
                border: '1px solid #232329',
                borderRadius: 12,
                padding: 12,
                marginBottom: 10,
              }}>
                <div style={{
                  fontSize: 11, fontFamily: 'var(--mono, monospace)',
                  color: '#8E8E99',
                  wordBreak: 'break-all',
                  lineHeight: 1.5, marginBottom: 10,
                }}>
                  {activeInvite.link}
                </div>
                <button
                  onClick={copyInviteLink}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: 8,
                    background: copied ? '#4ADE80' : '#16161B',
                    border: '1px solid ' + (copied ? '#4ADE80' : '#232329'),
                    color: copied ? '#0A0A0B' : '#F5F5F7',
                    fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all 0.15s',
                  }}
                >
                  {copied ? '✓ Скопійовано' : 'Копіювати ще раз'}
                </button>
              </div>
            )}

            <button
              onClick={() => setShowAddMember(true)}
              style={{
                width: '100%',
                padding: '14px 22px',
                borderRadius: 14,
                background: '#16161B',
                color: '#F5F5F7',
                border: '1px solid #232329',
                fontSize: 14, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
                marginTop: 4,
              }}
            >
              + Додати за юзернеймом
            </button>
          </>
        )}

        {/* Members */}
        <SectionLabel>Учасники</SectionLabel>
        <div style={{
          background: '#13131A',
          border: '1px solid #232329',
          borderRadius: 14, overflow: 'hidden',
        }}>
          {members.map((m, idx) => {
            const hue = parseInt(m.pubkey_hex.slice(0, 6), 16) % 360;
            const isMe = m.pubkey_hex === myPubkeyHex;
            return (
              <div key={m.pubkey_hex} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                borderBottom: idx < members.length - 1 ? '1px solid #1E1E27' : 'none',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: `hsl(${hue}, 45%, 45%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 13.5, color: '#fff',
                  flexShrink: 0,
                }}>
                  {m.username?.[0]?.toUpperCase() || '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13.5, fontWeight: 600, color: '#F5F5F7',
                    fontFamily: 'var(--mono, monospace)',
                    display: 'flex', alignItems: 'center', gap: 8,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    <span style={{
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{isMe ? 'Ви' : `@${m.username || m.pubkey_hex.slice(0, 8)}`}</span>
                    {m.is_admin && (
                      <span style={{
                        fontSize: 9.5, fontWeight: 600,
                        color: '#7B96FF',
                        background: 'rgba(107, 138, 254, 0.12)',
                        padding: '2px 6px', borderRadius: 4,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        fontFamily: 'inherit',
                      }}>
                        ADMIN
                      </span>
                    )}
                  </div>
                </div>
                {isAdmin && !isMe && (
                  <button
                    onClick={() => removeMember(m.pubkey_hex)}
                    disabled={busy}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#FF6B7A',
                      fontSize: 12, fontWeight: 600,
                      cursor: busy ? 'not-allowed' : 'pointer',
                      padding: '6px 10px',
                      fontFamily: 'inherit',
                    }}
                  >
                    Видалити
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 24 }}>
          {isCreator ? (
            <button
              onClick={deleteGroupClicked}
              disabled={busy}
              style={{
                width: '100%',
                padding: '14px 22px',
                borderRadius: 14,
                background: 'transparent',
                color: '#FF6B7A',
                border: '1px solid rgba(255, 107, 122, 0.3)',
                fontSize: 14, fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Видалити групу
            </button>
          ) : (
            <button
              onClick={leaveGroupClicked}
              disabled={busy}
              style={{
                width: '100%',
                padding: '14px 22px',
                borderRadius: 14,
                background: 'transparent',
                color: '#FF6B7A',
                border: '1px solid rgba(255, 107, 122, 0.3)',
                fontSize: 14, fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Вийти з групи
            </button>
          )}
        </div>
      </div>

      {/* Add member sheet */}
      {showAddMember && (
        <div
          onClick={() => setShowAddMember(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.7)', zIndex: 60,
            display: 'flex', alignItems: 'flex-end',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              background: '#16161B',
              borderTop: '1px solid #232329',
              borderTopLeftRadius: 22, borderTopRightRadius: 22,
              padding: '12px 20px 28px',
            }}
          >
            <div style={{
              width: 36, height: 4, background: '#3F3F45',
              borderRadius: 2, margin: '6px auto 18px',
            }} />

            <h3 style={{
              fontSize: 18, fontWeight: 700,
              color: '#F5F5F7',
              letterSpacing: '-0.02em',
              margin: '0 0 16px',
            }}>
              Додати за юзернеймом
            </h3>

            <input
              type="text"
              placeholder="@username[@relay]"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value.toLowerCase().replace(/[^a-z0-9_@.-]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && addByUsername()}
              spellCheck={false}
              autoCapitalize="none"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '13px 14px',
                background: '#0A0A0B',
                border: '1px solid #232329',
                borderRadius: 12,
                color: '#F5F5F7',
                fontSize: 14, fontFamily: 'var(--mono, monospace)',
                outline: 'none', marginBottom: 14,
              }}
              onFocus={(e) => e.target.style.borderColor = '#3F3F50'}
              onBlur={(e) => e.target.style.borderColor = '#232329'}
            />
            <button
              onClick={addByUsername}
              disabled={!addInput.trim() || busy}
              style={{
                width: '100%',
                padding: '14px 22px',
                borderRadius: 14,
                background: (!addInput.trim() || busy) ? '#2A2A33' : '#F5F5F7',
                color: (!addInput.trim() || busy) ? '#5A5A65' : '#0A0A0B',
                border: 'none',
                fontSize: 14, fontWeight: 600,
                cursor: (!addInput.trim() || busy) ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {busy ? 'Додаємо...' : 'Додати'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({ title, onClose }) {
  return (
    <div style={{
      padding: '20px 20px 24px',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em',
          color: '#F5F5F7', lineHeight: 1.1,
        }}>
          {title}
        </div>
      </div>
      <button
        onClick={onClose}
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: '#16161B', border: '1px solid #232329',
          color: '#A8A8B0', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, color: '#3F3F45',
      textTransform: 'uppercase', letterSpacing: '0.1em',
      fontWeight: 600,
      padding: '20px 0 10px',
    }}>
      {children}
    </div>
  );
}
