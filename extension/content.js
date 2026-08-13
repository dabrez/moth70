// Isolated-world content script. Injects inject.js into the page's own JS world (needed
// so console.error/warn patching actually sees the page's own calls), then relays
// messages between the popup/background (chrome.runtime) and inject.js (window.postMessage).

(function injectPageScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = () => script.remove();
  (document.documentElement || document.head || document.body).appendChild(script);
})();

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
    // Don't hang forever if inject.js never loaded (e.g. strict page CSP blocked it).
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
