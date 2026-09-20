// Launches Chromium with the unpacked extension and drives the real toolbar popup.
//
// The popup is opened the way a user opens it (chrome.action.openPopup from the service
// worker) and then attached to over raw CDP, because Playwright cannot see popup targets.
// Everything the popup does — tab queries, screenshots, storage, content-script messaging —
// therefore runs in the genuine extension runtime, not a mock.

import { chromium, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CdpConnection, CdpSession } from './cdp';

export const EXTENSION_DIR = path.resolve(__dirname, '../../extension');

// Only referenced inside functions that Playwright serialises and runs in the extension's
// service worker, where the real `chrome` global exists.
declare const chrome: { action: { openPopup(): Promise<void> } };

type ScreencastSession = {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  on(event: string, handler: (params: any) => void): unknown;
};

type Frame = { ts: number; file: string };
type Stream = { name: string; frames: Frame[] };

/**
 * Captures screencast frames from any number of CDP sessions into a frames directory
 * plus a manifest with wall-clock timestamps, so e2e/compose-demo.mjs can composite the
 * popup onto the page on one timeline.
 */
export class Recorder {
  readonly streams: Stream[] = [];
  private readonly active = new Map<string, ScreencastSession>();
  private readonly pollers = new Map<string, () => Promise<void>>();

  constructor(readonly dir: string) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }

  async attach(name: string, session: ScreencastSession, size: { maxWidth: number; maxHeight: number }) {
    const stream: Stream = { name, frames: [] };
    this.streams.push(stream);
    const streamDir = path.join(this.dir, name);
    fs.mkdirSync(streamDir, { recursive: true });

    session.on('Page.screencastFrame', (params: any) => {
      const file = path.join(streamDir, `${String(stream.frames.length).padStart(5, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(params.data, 'base64'));
      stream.frames.push({ ts: params.metadata?.timestamp ?? Date.now() / 1000, file });
      // The frame's sessionId is the screencast's own counter, not a CDP session id.
      session.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
    });

    await session.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1, ...size });
    this.active.set(name, session);
  }

  /**
   * Samples a target with Page.captureScreenshot on a timer instead of a screencast.
   * Headless Chromium stops compositing an extension popup a fraction of a second after it
   * opens, so its screencast goes silent while the popup is still very much in use;
   * an explicit capture forces a render and always reflects the current state.
   */
  async attachPolling(name: string, session: ScreencastSession, intervalMs = 80) {
    const stream: Stream = { name, frames: [] };
    this.streams.push(stream);
    const streamDir = path.join(this.dir, name);
    fs.mkdirSync(streamDir, { recursive: true });

    let running = true;
    const loop = (async () => {
      while (running) {
        const started = Date.now();
        try {
          const { data } = await session.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
          const file = path.join(streamDir, `${String(stream.frames.length).padStart(5, '0')}.jpg`);
          fs.writeFileSync(file, Buffer.from(data, 'base64'));
          stream.frames.push({ ts: started / 1000, file });
        } catch (error) {
          // The popup closed: there is nothing left to sample, so end the loop rather
          // than waiting on a session that will never answer again.
          if (String(error).includes('detached')) break;
        }
        await new Promise((r) => setTimeout(r, Math.max(0, intervalMs - (Date.now() - started))));
      }
    })();
    this.pollers.set(name, async () => {
      running = false;
      await loop;
    });
  }

  async stop(name: string) {
    const stopPolling = this.pollers.get(name);
    if (stopPolling) {
      this.pollers.delete(name);
      await stopPolling();
      return;
    }
    const session = this.active.get(name);
    if (!session) return;
    this.active.delete(name);
    // The target may already be gone (a closed popup), which is fine.
    await session.send('Page.stopScreencast').catch(() => {});
  }

  async save() {
    for (const name of [...this.pollers.keys(), ...this.active.keys()]) await this.stop(name);
    fs.writeFileSync(path.join(this.dir, 'manifest.json'), JSON.stringify({ streams: this.streams }, null, 2));
  }
}

/** Drives one open toolbar popup over its CDP session. */
export class Popup {
  constructor(
    private readonly session: CdpSession,
    readonly targetId: string,
    private readonly connection: CdpConnection
  ) {}

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const { result, exceptionDetails } = await this.session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(`popup evaluate failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    }
    return result.value as T;
  }

  async waitFor(expression: string, options: { timeout?: number; label?: string } = {}) {
    const timeout = options.timeout ?? 10_000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate<boolean>(`Boolean(${expression})`)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out after ${timeout}ms waiting for ${options.label ?? expression}`);
  }

  isVisible(selector: string) {
    return this.evaluate<boolean>(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && el.getClientRects().length > 0; })()`
    );
  }

  text(selector: string) {
    return this.evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ''`);
  }

  value(selector: string) {
    return this.evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.value ?? ''`);
  }

  attribute(selector: string, name: string) {
    return this.evaluate<string | null>(
      `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`
    );
  }

  /** A real click: scrolls the element into view and dispatches trusted mouse events at its centre. */
  async click(selector: string) {
    const point = await this.evaluate<{ x: number; y: number }>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('no element matches ${selector}');
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    const base = { x: point.x, y: point.y, button: 'left' as const, clickCount: 1 };
    await this.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, button: 'none' });
    await this.session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    // Clicking the close button tears the target down mid-gesture; that is not an error.
    await this.session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base }).catch(() => {});
  }

  /**
   * Focuses the field with a real click, clears it, then types via the input pipeline.
   * A per-character delay makes the demo recording read like a person typing.
   */
  async fill(selector: string, text: string, options: { delayMs?: number } = {}) {
    await this.click(selector);
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    if (!options.delayMs) {
      await this.session.send('Input.insertText', { text });
      return;
    }
    for (const char of text) {
      await this.session.send('Input.insertText', { text: char });
      await new Promise((r) => setTimeout(r, options.delayMs));
    }
  }

  /** <select> cannot be typed into, so the value is set directly and change is dispatched. */
  async selectOption(selector: string, value: string) {
    await this.click(selector);
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  async screenshot(file: string) {
    const { data } = await this.session.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }

  /** Waits until the popup target no longer exists (after clicking close, for example). */
  async waitForClosed(timeout = 5_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const { targetInfos } = await this.connection.send('Target.getTargets');
      if (!targetInfos.some((t: any) => t.targetId === this.targetId)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('popup did not close');
  }

  screencastSession(): ScreencastSession {
    return this.session;
  }
}

export class ExtensionEnv {
  constructor(
    readonly context: BrowserContext,
    readonly serviceWorker: Worker,
    readonly extensionId: string,
    readonly cdp: CdpConnection
  ) {}

  /** Opens the toolbar popup exactly as clicking the action icon would, and attaches to it. */
  async openPopup(): Promise<Popup> {
    await this.serviceWorker.evaluate(() => chrome.action.openPopup());

    const popupUrl = `chrome-extension://${this.extensionId}/popup.html`;
    const deadline = Date.now() + 10_000;
    let target: any;
    while (!target && Date.now() < deadline) {
      const { targetInfos } = await this.cdp.send('Target.getTargets');
      target = targetInfos.find((t: any) => t.type === 'page' && t.url === popupUrl);
      if (!target) await new Promise((r) => setTimeout(r, 50));
    }
    if (!target) throw new Error('popup target never appeared after chrome.action.openPopup()');

    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const session = new CdpSession(this.cdp, sessionId);
    await session.send('Runtime.enable');
    await session.send('Page.enable');

    const popup = new Popup(session, target.targetId, this.cdp);
    // popup.js has finished its async init once the diagnostics note stops saying "Checking…".
    await popup.waitFor(
      `document.getElementById('diagnostics-note') && !document.getElementById('diagnostics-note').textContent.startsWith('Checking')`,
      { label: 'popup initialisation' }
    );
    return popup;
  }

  async close() {
    this.cdp.close();
    await this.context.close();
  }
}

export async function launchExtension(userDataDir: string): Promise<ExtensionEnv> {
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    // Extensions need the full Chromium build in new-headless mode, not the headless shell.
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      // Playwright talks to Chromium over a pipe; this opens a socket alongside it for us.
      '--remote-debugging-port=0',
    ],
  });

  const serviceWorker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const extensionId = new URL(serviceWorker.url()).host;

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(portFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  const cdp = await CdpConnection.connect(`ws://127.0.0.1:${port}${wsPath}`);

  return new ExtensionEnv(context, serviceWorker, extensionId, cdp);
}

/** Attaches the recorder to a Playwright page via its own CDP session. */
export async function recordPage(recorder: Recorder, name: string, page: Page) {
  const session = await page.context().newCDPSession(page);
  await recorder.attach(name, session, { maxWidth: 1280, maxHeight: 800 });
}

export const test = base.extend<{ ext: ExtensionEnv }>({
  ext: async ({}, use, testInfo) => {
    const env = await launchExtension(testInfo.outputPath('user-data'));
    await use(env);
    await env.close();
  },
});

export { expect } from '@playwright/test';
