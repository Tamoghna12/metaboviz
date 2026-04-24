/**
 * KernelSolver - Browser WebSocket client for the local MetaboViz Python kernel.
 *
 * Connects to ws(s)://localhost:8765, sends JSON-RPC 2.0 solve requests,
 * and surfaces results with the same shape as SolverWorker so ComputeWorker
 * can treat it as a drop-in tier.
 *
 * Mixed-content note:
 *   HTTPS pages cannot connect to ws:// (browser blocks it).
 *   Start the kernel with --tls for wss:// support, then visit
 *   https://localhost:8765 once to trust the self-signed cert.
 *
 * @module KernelSolver
 */

const DEFAULT_WS_PORT = 8765;
const RECONNECT_BASE_MS = 1500;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 15_000;

export const KernelStatus = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
};

class KernelSolverClient {
  constructor() {
    this.ws = null;
    this.status = KernelStatus.DISCONNECTED;
    this.pending = new Map();   // jobId → { resolve, reject, onProgress }
    this.jobCounter = 0;
    this.listeners = new Set(); // (status, info) => void
    this.reconnectDelay = RECONNECT_BASE_MS;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.kernelInfo = null;
    this._destroyed = false;

    // Attempt connection — deferred so import doesn't throw in non-browser env
    if (typeof WebSocket !== 'undefined') {
      setTimeout(() => this._connect(), 0);
    }
  }

  // ── Connection management ─────────────────────────────────────────────────

  _wsUrl() {
    // Use wss:// when page is served over HTTPS
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://localhost:${DEFAULT_WS_PORT}`;
  }

  _connect() {
    if (this._destroyed) return;
    if (this.ws?.readyState === WebSocket.CONNECTING ||
        this.ws?.readyState === WebSocket.OPEN) return;

    this._setStatus(KernelStatus.CONNECTING);
    try {
      this.ws = new WebSocket(this._wsUrl());
      this.ws.onopen    = () => this._onOpen();
      this.ws.onmessage = e  => this._onMessage(e);
      this.ws.onclose   = e  => this._onClose(e);
      this.ws.onerror   = () => this._onError();
    } catch {
      this._setStatus(KernelStatus.DISCONNECTED);
      this._scheduleReconnect();
    }
  }

  _onOpen() {
    this.reconnectDelay = RECONNECT_BASE_MS;
    // Ping to get kernel info
    this._ping().then(info => {
      this.kernelInfo = info;
      this._setStatus(KernelStatus.CONNECTED, info);
    }).catch(() => {
      this._setStatus(KernelStatus.CONNECTED);
    });
    this._startPing();
  }

  _onClose(e) {
    this._stopPing();
    // Reject all pending requests
    this.pending.forEach(({ reject }) => reject(new Error('Kernel disconnected')));
    this.pending.clear();
    if (!this._destroyed) {
      this._setStatus(KernelStatus.DISCONNECTED);
      this._scheduleReconnect();
    }
  }

  _onError() {
    // onerror is always followed by onclose — just note it
  }

  _onMessage(event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    // Progress notification (no id in RPC sense, but has params.id)
    if (msg.method === 'progress' && msg.params) {
      const job = this.pending.get(msg.params.id);
      if (job?.onProgress) {
        job.onProgress(msg.params.progress, msg.params.message || '');
      }
      return;
    }

    // Result or error
    const job = this.pending.get(msg.id);
    if (!job) return;
    this.pending.delete(msg.id);

    if (msg.error) {
      job.reject(new Error(msg.error.message || 'Kernel error'));
    } else {
      job.resolve(msg.result);
    }
  }

  _scheduleReconnect() {
    if (this._destroyed) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this._connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, RECONNECT_MAX_MS);
    }, this.reconnectDelay);
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(async () => {
      try {
        const info = await this._ping();
        if (this.status !== KernelStatus.CONNECTED) {
          this.kernelInfo = info;
          this._setStatus(KernelStatus.CONNECTED, info);
        }
      } catch {
        // Connection will close and trigger reconnect
      }
    }, PING_INTERVAL_MS);
  }

  _stopPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  _setStatus(status, info = null) {
    this.status = status;
    this.listeners.forEach(fn => {
      try { fn(status, info); } catch {}
    });
  }

  // ── RPC send ──────────────────────────────────────────────────────────────

  _send(method, params, onProgress) {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new Error('Kernel not connected'));
        return;
      }

      const id = `job_${++this.jobCounter}_${Date.now()}`;
      this.pending.set(id, { resolve, reject, onProgress });

      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('Kernel request timed out'));
        }
      }, 600_000); // 10 min for FVA on large models

      this.pending.get(id).timeout = timeout;

      // Wrap resolve/reject to clear timeout
      const origResolve = resolve;
      const origReject = reject;
      this.pending.set(id, {
        resolve: v => { clearTimeout(timeout); origResolve(v); },
        reject:  e => { clearTimeout(timeout); origReject(e); },
        onProgress,
      });

      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  _ping() {
    return this._send('ping', {});
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get isConnected() {
    return this.status === KernelStatus.CONNECTED &&
           this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Subscribe to status changes.
   * @param {(status: string, info: object|null) => void} fn
   * @returns {() => void} unsubscribe
   */
  onStatusChange(fn) {
    this.listeners.add(fn);
    // Fire immediately with current status
    fn(this.status, this.kernelInfo);
    return () => this.listeners.delete(fn);
  }

  /**
   * Solve a metabolic problem via the local Python kernel.
   *
   * @param {string} method - fba | pfba | fva | moma | gimme | eflux
   * @param {Object} model  - MetaboViz model dict
   * @param {Object} options - solver options
   * @param {Function} [onProgress] - (fraction, message) => void
   */
  solve(method, model, options = {}, onProgress = null) {
    return this._send('solve', { method, model, options }, onProgress);
  }

  /**
   * Benchmark FBA on a model — returns solveTime + model stats.
   */
  benchmark(model) {
    return this._send('benchmark', { model });
  }

  destroy() {
    this._destroyed = true;
    this._stopPing();
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

export const kernelSolver = new KernelSolverClient();
export default kernelSolver;
