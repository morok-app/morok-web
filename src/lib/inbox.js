/**
 * WebSocket inbox client.
 *
 * Connects to wss://relay/ws/v1/inbox?token=<session>.
 * Auto-reconnects with exponential backoff (1s → 2s → 5s → 10s → 30s cap).
 *
 * Events emitted to the consumer:
 *   onCatchup(envelopes[])
 *   onNew(envelope)
 *   onDeleted({envelopeId, by, groupId})
 *   onRead({envelopeId, readerPubkey, groupId})
 *   onGroupGone({groupId, by})
 *   onStateChange('connecting'|'open'|'closed'|'error')
 */

import * as api from './api.js';

const BACKOFF_SECONDS = [1, 2, 5, 10, 30];

export class InboxClient {
  constructor({ onCatchup, onNew, onDeleted, onRead, onGroupGone, onStateChange, onAuthFail }) {
    this.onCatchup = onCatchup;
    this.onNew = onNew;
    this.onDeleted = onDeleted;
    this.onRead = onRead;
    this.onGroupGone = onGroupGone;
    this.onStateChange = onStateChange;
    this.onAuthFail = onAuthFail;     // викликається коли close через no_session/auth
    this.ws = null;
    this.attempts = 0;
    this.shouldRun = false;
    this.reconnectTimer = null;
    this.state = 'closed';
    this.authFailed = false;          // прапорець: останній close був через авторизацію
  }

  start() {
    this.shouldRun = true;
    // Уже живий/підключається — нічого не робимо.
    if (this.ws && (this.ws.readyState === WebSocket.OPEN ||
                    this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    // Реконект уже заплановано (ми в паузі backoff) — НЕ форсуємо конект:
    // інакше зовнішні виклики start() щосекунди обходять backoff і
    // влаштовують молотарку. Хай спрацює запланований таймер.
    if (this.reconnectTimer) return;
    this._connect();
  }

  stop() {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this._setState('closed');
  }

  ack(envelopeId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ack', envelope_id: envelopeId }));
    }
  }

  _setState(s) {
    this.state = s;
    this.onStateChange?.(s);
  }

  _connect() {
    if (!this.shouldRun) return;
    // Таймер реконекту спрацював (або це прямий конект) — звільняємо слот,
    // щоб подальші start() знову могли ініціювати конект за потреби.
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this._setState('connecting');

    const ws = api.openInboxSocket(
      (msg) => this._onMessage(msg),
      () => this._onOpen(),
      (ev) => this._onClose(ev),
      (err) => this._onError(err),
    );
    this.ws = ws;
  }

  _onOpen() {
    this.attempts = 0;
    this._setState('open');
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'catchup':
        this.onCatchup?.(msg.envelopes || []);
        break;
      case 'new':
        this.onNew?.(msg.envelope);
        break;
      case 'deleted':
        this.onDeleted?.({
          envelopeId: msg.envelope_id,
          by: msg.by,
          groupId: msg.group_id || null,
        });
        break;
      case 'read':
        this.onRead?.({
          envelopeId: msg.envelope_id,
          readerPubkey: msg.reader,
          groupId: msg.group_id || null,
        });
        break;
      case 'group_gone':
        // Групу видалив її творець на релеї — локальну копію треба
        // знести (інакше "мертва" група висить у списку вічно).
        this.onGroupGone?.({
          groupId: msg.group_id,
          by: msg.by || null,
        });
        break;
      case 'ping':
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'pong' }));
        }
        break;
      case 'error':
        console.warn('inbox WS error:', msg.detail);
        break;
      default:
        console.warn('inbox WS unknown msg:', msg);
    }
  }

  _onError(err) {
    // Позначаємо авторизаційний збій (no_session_token) окремо.
    if (err?.code === 'no_session') this.authFailed = true;
    this._setState('error');
    // The close event will fire after error → reconnect from there
  }

  _onClose(ev) {
    this.ws = null;
    if (!this.shouldRun) return;
    this._setState('closed');

    // Якщо close через відсутність/протухлість токена — даємо realtime шанс
    // перелогінитись (оновити токен), і НЕ молотимо: мінімальна пауза 2с.
    const wasAuth = this.authFailed || ev?.code === 4001;
    this.authFailed = false;

    if (wasAuth && this.onAuthFail) {
      // одноразова спроба оновити сесію перед наступним конектом
      try { this.onAuthFail(); } catch {}
    }

    const base = BACKOFF_SECONDS[Math.min(this.attempts, BACKOFF_SECONDS.length - 1)];
    const delay = wasAuth ? Math.max(base, 2) : base;   // авторизаційний — не швидше 2с
    this.attempts++;
    console.info(`inbox WS reconnect in ${delay}s (attempt ${this.attempts})`);
    this.reconnectTimer = setTimeout(() => this._connect(), delay * 1000);
  }
}
