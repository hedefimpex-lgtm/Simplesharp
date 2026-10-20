// Geometri çekirdeği Worker'ı ile söz (promise) tabanlı iletişim.
export class Kernel {
  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.nextId = 1;
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (data.ok) request.resolve(data.result);
      else request.reject(new Error(data.error));
    };
    this.worker.onerror = (e) => {
      const error = new Error(`Geometri çekirdeği yüklenemedi: ${e.message || 'bilinmeyen hata'}`);
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
    this.ready = this.call({ type: 'init' });
    this.latest = null;
    this.running = null;
  }

  call(message) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id });
    });
  }

  // Son istek kazanır: çekirdek meşgulken gelen ara istekler atlanır (sürükleme önizlemeleri için).
  evaluate(features) {
    return new Promise((resolve, reject) => {
      if (this.latest) this.latest.resolve(null); // atlanan istek
      this.latest = { features, resolve, reject };
      this.pump();
    });
  }

  async pump() {
    if (this.running || !this.latest) return;
    const { features, resolve, reject } = this.latest;
    this.latest = null;
    this.running = this.call({ type: 'evaluate', features });
    try {
      resolve(await this.running);
    } catch (err) {
      reject(err);
    } finally {
      this.running = null;
      this.pump();
    }
  }

  export(features, bodies, format, extra = {}) {
    return this.call({ type: 'export', features, bodies, format, ...extra });
  }

  drawing(features, bodies) {
    return this.call({ type: 'drawing', features, bodies });
  }
}
