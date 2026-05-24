/**
 * WebSocket inbox client.
 *
 * Connects to wss://relay/ws/v1/inbox?token=<session>.
 * Auto-reconnects with exponential backoff (1s → 2s → 5s → 10s → 30s cap).
 *
 * Events emitted to the consumer:
 *   onCatchup(envelopes[])
 *   onNew(envelope)
 *   onDeleted({ envelopeId, by, groupId })
 *   onStateChange('connecting'|'open'|'closed'|'error')
 */

import * as api from './api.js';

const BACKOFF_SECONDS = [1, 2, 5, 10, 30];

export class InboxClient {
  constructor({ onCatchup, onNew, onDeleted, onStateChange }) {
    this.onCatchup = onCatchup;
    this.onNew = onNew;
    this.onDeleted = onDeleted;
    this.onStateChange = onStateChange;
    this.ws = null;
    this.attempts = 0;
    this.shouldRun = false;
    this.reconnectTimer = null;
    this.state = 'closed';
  }

  start() {
    this.shouldRun = true;
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

  _onClose(ev) {
    this.ws = null;
    if (!this.shouldRun) return;
    this._setState('closed');
    const delay = BACKOFF_SECONDS[Math.min(this.attempts, BACKOFF_SECONDS.length - 1)];
    this.attempts++;
    console.info(`inbox WS reconnect in ${delay}s (attempt ${this.attempts})`);
    this.reconnectTimer = setTimeout(() => this._connect(), delay * 1000);
  }

  _onError(err) {
    this._setState('error');
    // The close event will fire after error → reconnect from there
  }
}
