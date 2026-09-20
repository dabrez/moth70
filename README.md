# Moth70

Capture a bug from any website with full technical context, then hand it to a coding
agent that can fix it.

The bet: an agent will happily read a 50-line console dump and a reconstructed click
path that no human reviewer would sit through. So the job is not to make bug reports
*pretty* — it is to make them **complete**, and to hand them over in a format an agent
can act on directly.

## What's here

```
app/          Next.js app — report form, dashboard, shareable report pages, REST API
extension/    Chrome MV3 extension — the capture layer
mcp/          MCP server — exposes reports to coding agents (see mcp/README.md)
lib/          Shared logic, including click-path reconstruction and the agent export
prisma/       Schema (SQLite)
```

### Capture

The **Chrome extension** is the richest path. It records:

- **Console output and uncaught exceptions**, patched in the page's own JS world so it
  sees the page's own `console.error` calls (an isolated content script would not).
- **Failed network requests** per tab via `webRequest`, tracked in the service worker
  because the popup only exists momentarily.
- **A rolling 60-second session recording** via rrweb, with all inputs masked.
- Browser, OS, viewport, DPR, connection type, hardware concurrency, device memory,
  and the build version (from `meta[name="build-version"]`, `window.__BUILD__`, or
  `window.__COMMIT_SHA__`).

There is also a **bookmarklet** (no install, metadata only) and a plain web form.

### Handoff

`GET /api/reports/:id?format=md` renders a report as a single self-contained markdown
document for a coding agent. The most valuable section is the **observed click path** —
raw rrweb JSON is a DOM mutation log an agent can do nothing with, so it is replayed
into an action sequence:

```
- `00:04` Typed into `input#email` — 15 input events — field labelled "Email address"
- `00:07` Clicked `button[data-testid="apply-promo"]` — labelled "Apply promo code"
- `00:09` Clicked `button[data-testid="checkout-submit"]` — labelled "Place order"
```

Selectors prefer stable hooks (`data-testid`, `id`, `name`) over generated class names.
The same document is available from the report page via **Copy for agent**, and through
the `get_bug` MCP tool.

## Running it

```bash
npm install
npx prisma db push      # creates prisma/dev.db
npm run dev             # http://localhost:3000
```

Load the extension from `chrome://extensions` → Developer mode → **Load unpacked** →
select `extension/`.

On first open the extension shows its settings panel, since without a server URL there
is nowhere to submit. Enter where the app is running (`localhost:3000`, a Tailscale
address, a deployed host — a bare host is fine, `http://` is assumed), optionally add
your name and email so reports are attributed, and **Test connection** before saving.
Settings live in `chrome.storage.sync`, so they follow you across machines. Reopen them
any time via the gear icon.

For the MCP server, see [`mcp/README.md`](mcp/README.md).

## Testing the extension in Chrome

```bash
npm run e2e        # runs the suite against its own app instance (port 3100, prisma/e2e.db)
npm run e2e:demo   # …and renders e2e/output/demo.mp4 + demo.gif from the captured frames
```

`e2e/` loads the unpacked extension into Playwright's Chromium and drives the **real
toolbar popup**: it is opened with `chrome.action.openPopup()` and controlled over raw
CDP, because Playwright only adopts tab targets and never sees a popup. The suite covers
first-run settings and validation, persistence across reopen, and a full report against a
fixture site with a broken add-to-cart flow (`e2e/fixtures/shop.ts`) — asserting on what
the server stored (console error from page load, unhandled exception, failed request,
session replay, screenshot) and on the agent export's reconstructed click path. The
report test is paced like a person and doubles as the demo recording; the popup is
composited onto the page video for exactly the interval it was open.

Two headless quirks the harness accounts for: Chromium caps a headless popup at 510px tall
(real Chrome allows 600), and a command sent to a popup's session after it closes gets no
reply at all — the CDP client fails those by name instead of hanging.

## Status

Working single-tenant tool. Usable as-is on a private network or over Tailscale.

The open item is **authentication**. The API currently accepts anonymous writes with
`Access-Control-Allow-Origin: *`, and reporter identity is self-asserted in extension
settings — it is attribution, not proof. Anything exposed to the open internet needs
real auth on the ingest path first, plus rate limiting; SQLite and the permissive CORS
policy are fine for private use but not for a public host.
