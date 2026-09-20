// Minimal raw Chrome DevTools Protocol client.
//
// Playwright only adopts *tab* targets, and an extension's toolbar popup is not a tab, so
// the real popup bubble is invisible to Playwright's page API. It is still a normal CDP
// page target, so we attach to it over Chromium's DevTools websocket and drive it directly.

type Handler = (params: any) => void;

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; method: string; sessionId?: string };

export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly detached = new Set<string>();

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => this.dispatch(String(event.data)));
    ws.addEventListener('close', () => {
      for (const { reject, method } of this.pending.values()) {
        reject(new Error(`CDP connection closed while waiting for ${method}`));
      }
      this.pending.clear();
    });
    // Chromium silently drops commands sent to a session whose target has gone (a closed
    // popup) — no reply, no error. Fail them here so nothing waits on a dead session.
    this.on('Target.detachedFromTarget', ({ sessionId }) => {
      this.detached.add(sessionId);
      for (const [id, entry] of this.pending) {
        if (entry.sessionId === sessionId) {
          this.pending.delete(id);
          entry.reject(new Error(`${entry.method}: session detached (target closed)`));
        }
      }
    });
  }

  static async connect(url: string): Promise<CdpConnection> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error(`Could not connect to ${url}`)), { once: true });
    });
    return new CdpConnection(ws);
  }

  /** Sends a command; a call that never gets a reply fails by name rather than wedging the test. */
  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 15_000): Promise<T> {
    if (sessionId && this.detached.has(sessionId)) {
      return Promise.reject(new Error(`${method}: session detached (target closed)`));
    }
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} did not respond within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        sessionId,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
  }

  /** Subscribe to an event, optionally scoped to one flattened session. */
  on(method: string, handler: Handler, sessionId?: string): () => void {
    const key = `${sessionId ?? ''}:${method}`;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
    return () => this.handlers.get(key)?.delete(handler);
  }

  close(): void {
    this.ws.close();
  }

  private dispatch(raw: string): void {
    const message = JSON.parse(raw);
    if (typeof message.id === 'number' && this.pending.has(message.id)) {
      const { resolve, reject, method } = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
      return;
    }
    if (message.method) {
      const key = `${message.sessionId ?? ''}:${message.method}`;
      for (const handler of this.handlers.get(key) ?? []) handler(message.params);
    }
  }
}

/** A flattened child session bound to one target. Shape-compatible with Playwright's CDPSession. */
export class CdpSession {
  constructor(readonly connection: CdpConnection, readonly sessionId: string) {}

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.connection.send<T>(method, params, this.sessionId);
  }

  on(method: string, handler: Handler): () => void {
    return this.connection.on(method, handler, this.sessionId);
  }
}
