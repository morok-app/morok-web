/**
 * Voice note recording utilities.
 *
 * Uses the browser's MediaRecorder API. Opus codec preferred (Chrome/
 * Firefox/Edge), falls back to whatever Safari/iOS supports.
 *
 * Bitrate: 16 kbps mono — enough for clear human speech, keeps a
 * 60-second clip under our ~140KB-after-encryption budget.
 *
 *   60 s × 16 000 bps / 8 = 120 000 bytes raw
 *   base64 inflates ~4/3 = ~160 000 chars
 *   JSON-wrapped+encrypted+base64 → ~210 000 transport bytes
 *   Backend MOROK_MAX_BLOB_BYTES = 262 144 → fits.
 *
 * Max duration is enforced client-side; recording auto-stops at 60s.
 */

export const MAX_DURATION_MS = 60_000;
export const AUDIO_BITRATE = 16_000;

export function isSupported() {
  if (typeof window === 'undefined') return false;
  if (typeof MediaRecorder === 'undefined') return false;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  return true;
}

/**
 * Pick the best supported audio MIME for MediaRecorder.
 * Opus is the gold standard; Safari only gets `audio/mp4` (AAC).
 */
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/aac',
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch { /* ignore */ }
  }
  return '';
}

/**
 * Recorder — owns a microphone stream and a MediaRecorder.
 *
 * Usage:
 *   const rec = new Recorder();
 *   await rec.start();
 *   // ... wait for user to click stop or timer to expire
 *   const { blob, duration_ms, mime } = await rec.stop();
 *
 * If the user cancels:
 *   rec.cancel();   // releases mic, discards blob
 */
export class Recorder {
  constructor() {
    this.mediaRecorder = null;
    this.stream = null;
    this.chunks = [];
    this.mime = '';
    this.startTime = 0;
    this.maxDurationTimer = null;
    this.onAutoStop = null;
  }

  async start({ onAutoStop } = {}) {
    if (!isSupported()) throw new Error('not_supported');
    this.onAutoStop = onAutoStop || null;

    // Request microphone — throws if user denies
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.mime = pickMimeType();
    this.chunks = [];

    const options = { audioBitsPerSecond: AUDIO_BITRATE };
    if (this.mime) options.mimeType = this.mime;

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, options);
    } catch (e) {
      // Older browsers may reject options — try without
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.mime = this.mediaRecorder.mimeType || '';
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.start();
    this.startTime = Date.now();

    // Hard cap — auto stop after MAX_DURATION_MS so the user can't
    // accidentally produce something the server will refuse.
    this.maxDurationTimer = setTimeout(() => {
      if (this.onAutoStop) {
        try { this.onAutoStop(); } catch { /* swallow */ }
      }
    }, MAX_DURATION_MS);
  }

  isRecording() {
    return !!(this.mediaRecorder && this.mediaRecorder.state === 'recording');
  }

  getDuration() {
    return this.startTime ? Date.now() - this.startTime : 0;
  }

  /**
   * Stop and return the recorded blob + duration. Releases the mic.
   * If recorder is already stopped or never started, returns null.
   */
  async stop() {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      this._releaseStream();
      return null;
    }

    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        const duration_ms = Date.now() - this.startTime;
        const mime = this.mime || this.mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mime });
        this._cleanupTimer();
        this._releaseStream();
        resolve({ blob, duration_ms, mime });
      };
      try {
        this.mediaRecorder.stop();
      } catch {
        this._cleanupTimer();
        this._releaseStream();
        resolve(null);
      }
    });
  }

  /** Stop without keeping the blob. Releases the mic. */
  cancel() {
    this._cleanupTimer();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch { /* ignore */ }
    }
    this.chunks = [];
    this._releaseStream();
  }

  _cleanupTimer() {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  _releaseStream() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* ignore */ }
      });
      this.stream = null;
    }
  }
}

/**
 * Convert a Blob to a base64 string (without data: prefix).
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const i = result.indexOf(',');
      resolve(i >= 0 ? result.slice(i + 1) : result);
    };
    reader.onerror = () => reject(new Error('blob_read_failed'));
    reader.readAsDataURL(blob);
  });
}

/** Format a milliseconds duration as M:SS (e.g. "0:23"). */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
