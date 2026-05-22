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
      const link = `${window.location.origin}/web/#join?t=${info.token}`;
      setActiveInvite({ ...info, link });
      try { await navigator.clipboard.writeText(link); } catch {}
      setMessage('Лінк створено і скопійовано');
    } catch (e) {
      setMessage('Помилка: ' + e.message);
    } finally {
      setBusy(false);
    }
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
      await groups.deleteGroupCompletely(groupId);
      onNavigate('chats');
    } catch (e) {
      setMessage('Помилка: ' + e.message);
      setBusy(false);
    }
  }

  if (!group) {
    return (
      <div className="screen">
        <div className="topbar">
          <div className="back" onClick={() => onNavigate('chats')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </div>
          <div className="title">Група</div>
        </div>
      </div>
    );
  }

  const members = group.members || [];

  return (
    <div className="screen">
      <div className="topbar">
        <div className="back" onClick={() => onNavigate(`group/${groupId}`)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        <div className="title">Інфо групи</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 32px' }}>
        {message && (
          <div style={{
            background: 'rgba(74, 222, 128, 0.08)',
            border: '1px solid rgba(74, 222, 128, 0.25)',
            color: 'var(--success)',
            padding: '10px 12px', borderRadius: 10,
            fontSize: 13, marginBottom: 16,
          }}>{message}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent) 0%, #4A5FB0 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32,
          }}>👥</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {group.name || 'Без назви'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {members.length} учасників · максимум {group.max_members}
          </div>
        </div>

        {isAdmin && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 22, marginBottom: 10 }}>
              Запросити
            </div>
            <button className="btn btn-primary" onClick={createInviteLink} disabled={busy}>
              Створити лінк
            </button>
            {activeInvite && (
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, padding: 12, marginTop: 10,
                fontSize: 11, fontFamily: 'var(--mono)', wordBreak: 'break-all',
                color: 'var(--text-dim)',
              }}>
                {activeInvite.link}
              </div>
            )}
            <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => setShowAddMember(true)}>
              Додати за юзернеймом
            </button>
          </>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 22, marginBottom: 10 }}>
          Учасники
        </div>

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          {members.map((m, idx) => {
            const hue = parseInt(m.pubkey_hex.slice(0, 6), 16) % 360;
            const isMe = m.pubkey_hex === myPubkeyHex;
            return (
              <div key={m.pubkey_hex} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px',
                borderBottom: idx < members.length - 1 ? '1px solid rgba(46,46,56,0.4)' : 'none',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: `hsl(${hue}, 45%, 45%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 13, color: '#fff',
                }}>
                  {m.username?.[0]?.toUpperCase() || '?'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {isMe ? 'Ви' : `@${m.username || m.pubkey_hex.slice(0, 8)}`}
                  </div>
                  {m.is_admin && (
                    <div style={{ fontSize: 10, color: 'var(--accent)' }}>адмін</div>
                  )}
                </div>
                {isAdmin && !isMe && (
                  <button
                    className="btn btn-ghost"
                    style={{ width: 'auto', height: 32, padding: '0 10px', fontSize: 12, color: 'var(--danger)' }}
                    onClick={() => removeMember(m.pubkey_hex)}
                    disabled={busy}
                  >
                    Видалити
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 28 }}>
          {isCreator ? (
            <button className="btn btn-danger" onClick={deleteGroupClicked} disabled={busy}>
              Видалити групу
            </button>
          ) : (
            <button className="btn btn-danger" onClick={leaveGroupClicked} disabled={busy}>
              Вийти з групи
            </button>
          )}
        </div>
      </div>

      {showAddMember && (
        <div onClick={() => setShowAddMember(false)} style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 60, display: 'flex', alignItems: 'flex-end',
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', background: 'var(--surface)',
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            padding: '12px 18px 24px',
          }}>
            <div style={{ width: 32, height: 4, background: 'var(--text-faint)', borderRadius: 2, margin: '6px auto 14px', opacity: 0.4 }} />
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
              Додати за юзернеймом
            </div>
            <input
              className="input"
              type="text"
              placeholder="@username[@relay]"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value.toLowerCase().replace(/[^a-z0-9_@.-]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && addByUsername()}
              spellCheck={false}
              autoCapitalize="none"
              autoFocus
            />
            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={addByUsername}
              disabled={!addInput.trim() || busy}
            >
              {busy ? 'Додаємо...' : 'Додати'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
