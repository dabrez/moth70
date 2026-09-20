// Isolated-world content script. Relays messages between the popup/background
// (chrome.runtime) and inject.js (window.postMessage).
//
// inject.js is declared in the manifest as a MAIN-world content script rather than being
// injected here via a <script> tag: a script tag loads asynchronously, so anything the page
// logged during its initial parse raced ahead of the console patch and was lost, and
// strict page CSPs blocked the tag outright. A MAIN-world content script runs synchronously
// at document_start and is exempt from page CSP.

let nextRequestId = 1;
const pending = new Map();

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== 'bugshot-inject') return;
  const resolve = pending.get(msg.requestId);
  if (resolve) {
    pending.delete(msg.requestId);
    resolve(msg.payload);
  }
});

function askInjectedScript(type, extra) {
  return new Promise((resolve) => {
    const requestId = nextRequestId++;
    pending.set(requestId, resolve);
    window.postMessage({ source: 'bugshot-content', type, requestId, ...extra }, '*');
    // Don't hang forever on pages where content scripts cannot run at all.
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        resolve(null);
      }
    }, 3000);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === 'GET_DIAGNOSTICS') {
    askInjectedScript('GET_DIAGNOSTICS').then(sendResponse);
    return true;
  }
  if (message.type === 'START_RECORDING') {
    askInjectedScript('START_RECORDING', { rrwebUrl: chrome.runtime.getURL('vendor/rrweb.min.js') }).then(sendResponse);
    return true;
  }
  if (message.type === 'STOP_RECORDING') {
    askInjectedScript('STOP_RECORDING').then(sendResponse);
    return true;
  }
  if (message.type === 'GET_RECORDING') {
    askInjectedScript('GET_RECORDING').then(sendResponse);
    return true;
  }
});
