// Service worker: tracks failed network requests per tab using webRequest, since the
// popup only exists momentarily and can't observe traffic itself.

const MAX_FAILURES_PER_TAB = 30;
const failuresByTab = new Map();

function recordFailure(tabId, entry) {
  if (tabId == null || tabId < 0) return;
  const list = failuresByTab.get(tabId) || [];
  list.push(entry);
  if (list.length > MAX_FAILURES_PER_TAB) list.shift();
  failuresByTab.set(tabId, list);
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.statusCode >= 400) {
      recordFailure(details.tabId, {
        url: details.url,
        method: details.method,
        statusCode: details.statusCode,
        timestamp: Date.now(),
      });
    }
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    recordFailure(details.tabId, {
      url: details.url,
      method: details.method,
      statusCode: null,
      error: details.error,
      timestamp: Date.now(),
    });
  },
  { urls: ['<all_urls>'] }
);

chrome.tabs.onRemoved.addListener((tabId) => failuresByTab.delete(tabId));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_NETWORK_FAILURES') {
    sendResponse((failuresByTab.get(message.tabId) || []).slice());
    return true;
  }
});
