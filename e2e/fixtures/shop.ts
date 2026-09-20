// A small "website with a bug" for the extension to report against.
//
// Moth Outfitters has a broken add-to-cart flow: the API returns 500, and the page code then
// dereferences the missing cart payload. That produces the three kinds of evidence the
// extension captures — a console error, an unhandled exception, and a failed request —
// plus a build version meta tag for the export to pick up.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const SHOP_TITLE = 'Moth Outfitters — Trail Jacket';
export const SHOP_BUILD = 'shop-web@1.8.2+4f9c1e2';
export const SHOP_LOAD_ERROR = '[cart] failed to hydrate cart state: localStorage key "cart:v2" missing';

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="build-version" content="${SHOP_BUILD}">
  <title>${SHOP_TITLE}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font: 16px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c1917; background: #fafaf9; }
    header { background: #1c1917; color: #fafaf9; padding: 16px 40px; display: flex; justify-content: space-between; align-items: center; }
    header .brand { font-weight: 700; letter-spacing: .04em; }
    header .cart { background: #f59e0b; color: #1c1917; border-radius: 999px; padding: 4px 12px; font-weight: 600; font-size: 14px; }
    main { max-width: 960px; margin: 48px auto; display: grid; grid-template-columns: 1fr 1fr; gap: 48px; padding: 0 24px; }
    .art { aspect-ratio: 4/5; border-radius: 16px; background: linear-gradient(160deg, #d6d3d1, #78716c); display: flex; align-items: flex-end; padding: 24px; box-sizing: border-box; color: #fafaf9; font-size: 13px; }
    h1 { font-size: 32px; margin: 0 0 8px; }
    .price { font-size: 22px; font-weight: 600; margin-bottom: 24px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #57534e; }
    input { width: 80px; padding: 10px 12px; font-size: 16px; border: 1px solid #d6d3d1; border-radius: 8px; margin-bottom: 20px; }
    button { background: #1c1917; color: #fafaf9; border: 0; border-radius: 10px; padding: 14px 28px; font-size: 16px; font-weight: 600; cursor: pointer; }
    button:hover { background: #292524; }
    #status { margin-top: 16px; min-height: 24px; font-size: 14px; color: #b91c1c; }
  </style>
</head>
<body>
  <header>
    <span class="brand">MOTH OUTFITTERS</span>
    <span class="cart">Cart · <span id="cart-count">0</span></span>
  </header>
  <main>
    <div class="art">Trail Jacket — Ash</div>
    <section>
      <h1>Trail Jacket</h1>
      <div class="price">$148.00</div>
      <label for="qty">Quantity</label>
      <input id="qty" name="quantity" type="number" min="1" value="1">
      <div>
        <button id="add-to-cart" data-testid="add-to-cart">Add to cart</button>
      </div>
      <p id="status"></p>
    </section>
  </main>
  <script>
    // Runs during initial parse: only a synchronously-installed console patch can see this.
    console.error(${JSON.stringify(SHOP_LOAD_ERROR)});

    document.getElementById('add-to-cart').addEventListener('click', () => {
      const quantity = Number(document.getElementById('qty').value);
      document.getElementById('status').textContent = '';
      fetch('/api/cart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku: 'TRAIL-JACKET-ASH', quantity }),
      })
        .then((response) => response.json())
        .then((data) => {
          // The bug: a failed response has no cart, and nothing checks for that.
          document.getElementById('cart-count').textContent = data.cart.items.length;
        });
      setTimeout(() => {
        if (document.getElementById('cart-count').textContent === '0') {
          document.getElementById('status').textContent = 'Something went wrong. Please try again.';
        }
      }, 600);
    });
  </script>
</body>
</html>`;

export async function startShop(): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/cart')) {
      setTimeout(() => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }, 150);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
