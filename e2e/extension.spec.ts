// End-to-end tests for the Chrome extension, run in real Chromium with the extension loaded.
//
// The second test doubles as the demo recording: every frame from the shop page and each
// toolbar popup is written to e2e/output/frames, and `node e2e/compose-demo.mjs` turns them
// into one video with the popup composited over the page. It is deliberately paced like a
// person using it — CDP-driven input is instantaneous, which makes for an unwatchable video.

import path from 'node:path';
import { test, expect, Recorder, recordPage, type Popup } from './lib/extension';
import { startShop, SHOP_TITLE, SHOP_BUILD, SHOP_LOAD_ERROR } from './fixtures/shop';

const APP_URL = process.env.MOTH70_E2E_URL ?? 'http://127.0.0.1:3100';
const OUTPUT_DIR = path.resolve(__dirname, 'output');
const screen = (name: string) => path.join(OUTPUT_DIR, 'screens', `${name}.png`);
const REPORTER = { name: 'Ada Lovelace', email: 'ada@example.com' };
const REQUEST = { timeout: 15_000 };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Timestamped progress lines, so a stall is attributable to one step in the output. */
function stepLogger() {
  const started = Date.now();
  return (message: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);
}

/** First-run configuration through the real settings panel. `typing` > 0 paces it for the demo. */
async function configureServer(popup: Popup, typing = 0) {
  await popup.fill('#server-url', APP_URL.replace(/^http:\/\//, ''), { delayMs: typing });
  await popup.fill('#reporter-name', REPORTER.name, { delayMs: typing });
  await popup.fill('#reporter-email', REPORTER.email, { delayMs: typing });
  if (typing) await pause(400);
  await popup.click('#test-connection-btn');
  await popup.waitFor(`document.getElementById('settings-status').classList.contains('ok')`, { label: 'connection test' });
  expect(await popup.text('#settings-status')).toBe(`Connected to ${APP_URL}`);
  if (typing) await pause(900);
  await popup.click('#save-settings-btn');
  await popup.waitFor(`document.getElementById('settings-panel').classList.contains('hidden')`, { label: 'settings to close' });
}

test.describe('Moth70 extension', () => {
  test('first run opens settings, validates the URL, and persists across popup reopen', async ({ ext }) => {
    const shop = await startShop();
    try {
      const page = await ext.context.newPage();
      await page.goto(shop.url);

      let popup = await ext.openPopup();
      expect(await popup.isVisible('#settings-panel')).toBe(true);
      expect(await popup.isVisible('#main-view')).toBe(false);
      expect(await popup.text('#settings-status')).toBe('Set the server URL to start reporting.');

      // A non-http scheme must be rejected before anything is stored.
      await popup.fill('#server-url', 'ftp://bugs.example.com');
      await popup.click('#save-settings-btn');
      expect(await popup.text('#settings-status')).toBe('Enter a valid http(s) URL.');
      expect(await popup.isVisible('#settings-panel')).toBe(true);

      // An unreachable server is reported by the connection test, not on submit.
      await popup.fill('#server-url', '127.0.0.1:1');
      await popup.click('#test-connection-btn');
      await popup.waitFor(`document.getElementById('settings-status').classList.contains('error')`, { label: 'failed connection test' });
      expect(await popup.text('#settings-status')).toBe('Could not reach server');

      await configureServer(popup);
      expect(await popup.isVisible('#main-view')).toBe(true);

      await popup.click('#close-btn');
      await popup.waitForClosed();

      // Settings live in chrome.storage.sync, so a fresh popup must come up configured.
      popup = await ext.openPopup();
      expect(await popup.isVisible('#settings-panel')).toBe(false);
      expect(await popup.isVisible('#main-view')).toBe(true);
      await popup.click('#settings-btn');
      expect(await popup.value('#server-url')).toBe(APP_URL);
      expect(await popup.value('#reporter-name')).toBe(REPORTER.name);
      expect(await popup.value('#reporter-email')).toBe(REPORTER.email);
    } finally {
      await shop.close();
    }
  });

  test('reports a bug from the toolbar popup with diagnostics, session recording and screenshot', async ({ ext, request }) => {
    const log = stepLogger();
    const recorder = new Recorder(path.join(OUTPUT_DIR, 'frames'));
    const shop = await startShop();
    try {
      const page = await ext.context.newPage();
      await recordPage(recorder, 'shop', page);
      await page.goto(shop.url);
      await expect(page).toHaveTitle(SHOP_TITLE);
      await pause(1200);
      log('shop page open');

      // --- Open the popup for the first time and configure it ---------------------
      let popup = await ext.openPopup();
      await recorder.attachPolling('popup-1', popup.screencastSession());
      await pause(1000);
      await popup.screenshot(screen('01-first-run-settings'));
      await configureServer(popup, 35);
      await pause(600);
      await popup.screenshot(screen('02-configured'));
      log('server configured');

      // The load-time console.error must already be attached: it fired during the page's
      // initial parse, which only a synchronously installed console patch can observe.
      expect(await popup.text('#diagnostics-note')).toMatch(/^\d+ console\/network diagnostics? will be attached$/);

      // --- Start a session recording, then go reproduce the bug ---------------------
      await popup.click('#recording-toggle');
      await popup.waitFor(`document.getElementById('recording-status').classList.contains('active')`, { label: 'recording to start' });
      expect(await popup.text('#recording-status')).toBe('⏺ Recording session…');
      await pause(900);
      await popup.screenshot(screen('03-recording-started'));
      await popup.click('#close-btn');
      await popup.waitForClosed();
      await recorder.stop('popup-1');
      log('recording started, popup closed');

      await expect(page.locator('text=Recording session for bug report')).toBeVisible();
      await pause(700);
      await page.locator('#qty').clear();
      await page.locator('#qty').pressSequentially('3', { delay: 120 });
      await pause(500);
      await page.click('#add-to-cart');
      await expect(page.locator('#status')).toHaveText('Something went wrong. Please try again.');
      await page.screenshot({ path: screen('04-bug-reproduced') });
      await pause(900);
      log('bug reproduced on the page');

      // --- Reopen the popup and file the report --------------------------------------
      popup = await ext.openPopup();
      await recorder.attachPolling('popup-2', popup.screencastSession());
      expect(await popup.isVisible('#settings-panel')).toBe(false);
      expect(await popup.text('#recording-status')).toBe('⏺ Recording session…');

      const note = await popup.text('#diagnostics-note');
      const count = Number(/^(\d+) console\/network diagnostics? will be attached$/.exec(note)?.[1]);
      expect(count, `diagnostics note was "${note}"`).toBeGreaterThanOrEqual(3);
      await pause(1000);
      await popup.screenshot(screen('05-diagnostics-attached'));

      await popup.fill('#title', 'Add to cart fails and shows a generic error', { delayMs: 30 });
      await popup.fill(
        '#description',
        'Set quantity to 3 and clicked Add to cart. The cart count stays at 0 and a red "Something went wrong" message appears.',
        { delayMs: 16 }
      );
      await popup.selectOption('#severity', 'high');
      await pause(600);
      await popup.screenshot(screen('06-report-filled'));
      await popup.click('#submit-btn');
      log('report submitted');

      await popup.waitFor(`!document.getElementById('success-message').classList.contains('hidden')`, {
        label: 'submission success',
        timeout: 20_000,
      });
      const reportUrl = await popup.attribute('#view-report-link', 'href');
      expect(reportUrl).toMatch(new RegExp(`^${APP_URL}/report/[a-z0-9]+$`));
      await pause(1400);
      await popup.screenshot(screen('07-submitted'));
      await popup.click('#close-btn');
      await popup.waitForClosed();
      await recorder.stop('popup-2');
      log(`report created: ${reportUrl}`);

      // --- Verify what actually landed on the server ---------------------------------
      const id = reportUrl!.split('/').pop()!;
      const report = await (await request.get(`${APP_URL}/api/reports/${id}`, REQUEST)).json();
      log('report fetched from API');

      expect(report.title).toBe('Add to cart fails and shows a generic error');
      expect(report.severity).toBe('high');
      expect(report.websiteUrl).toBe(shop.url);
      expect(report.pageTitle).toBe(SHOP_TITLE);
      expect(report.buildVersion).toBe(SHOP_BUILD);
      expect(report.reporterName).toBe(REPORTER.name);
      expect(report.reporterEmail).toBe(REPORTER.email);
      expect(report.browser).toBe('Chrome');
      expect(report.viewportWidth).toBe(1280);
      expect(report.screenshot).toMatch(/^data:image\/jpeg;base64,/);

      const consoleErrors = JSON.parse(report.consoleErrors);
      expect(consoleErrors.map((e: { message: string }) => e.message)).toContain(SHOP_LOAD_ERROR);

      const exceptions = JSON.parse(report.jsExceptions);
      expect(exceptions.some((e: { message: string }) => e.message.includes("reading 'items'"))).toBe(true);

      const failures = JSON.parse(report.networkFailures);
      expect(failures).toEqual(
        expect.arrayContaining([expect.objectContaining({ method: 'POST', statusCode: 500, url: `${shop.url}api/cart` })])
      );

      expect(report.sessionReplay).toBeTruthy();
      expect(report.sessionReplayTruncated).toBe(false);

      // --- And that the agent export reconstructs what was done ------------------------
      const markdown = await (await request.get(`${APP_URL}/api/reports/${id}?format=md`, REQUEST)).text();
      log('agent export fetched');
      expect(markdown).toContain('## Observed click path');
      expect(markdown).toContain('Typed into `input#qty`');
      expect(markdown).toContain('Clicked `button[data-testid="add-to-cart"]` — labelled "Add to cart"');
      expect(markdown).toContain('## JavaScript exceptions');
      expect(markdown).toContain("reading 'items'");
      expect(markdown).toContain('| 500 | POST |');
      expect(markdown).toContain(`- **Build:** \`${SHOP_BUILD}\``);

      // Finish the demo on the report page itself.
      await page.goto(reportUrl!);
      await expect(page.getByRole('heading', { name: 'Add to cart fails and shows a generic error' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copy for agent' })).toBeVisible();
      await pause(1500);
      // A full-page screenshot resizes the viewport to the document height while it
      // captures, which the screencast would record as one tall squashed frame.
      await recorder.stop('shop');
      await page.screenshot({ path: screen('08-report-page'), fullPage: true });
      log('report page shown');
    } finally {
      await recorder.save();
      await shop.close();
    }
  });
});
