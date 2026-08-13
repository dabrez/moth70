// Runs in the PAGE's own JS world (injected as a <script> tag by content.js), because
// console.error/warn patched from an isolated content-script world would not intercept
// calls the page itself makes — only code running in the page's world sees those.
// Talks to content.js (isolated world) via window.postMessage.

(function () {
  const MAX_CONSOLE_ENTRIES = 50;
  const MAX_MESSAGE_LENGTH = 500;
  const RECORDING_MAX_EVENTS = 500;
  const RECORDING_MAX_AGE_MS = 60_000;

  const pageLoadedAt = performance.now();
  const pageReferrer = document.referrer || '';
  const consoleErrors = [];
  const jsExceptions = [];

  let recording = false;
  let stopRecordingFn = null;
  let recordedEvents = [];
  let bannerEl = null;

  function truncate(str) {
    const s = String(str);
    return s.length > MAX_MESSAGE_LENGTH ? s.slice(0, MAX_MESSAGE_LENGTH) + '…' : s;
  }

  function pushCapped(buffer, entry) {
    buffer.push(entry);
    if (buffer.length > MAX_CONSOLE_ENTRIES) buffer.shift();
  }

  const originalConsoleError = console.error.bind(console);
  console.error = function (...args) {
    try {
      pushCapped(consoleErrors, {
        type: 'error',
        message: truncate(args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(' ')),
        timestamp: Date.now(),
      });
    } catch {
      // never let capture break the page
    }
    originalConsoleError(...args);
  };

  const originalConsoleWarn = console.warn.bind(console);
  console.warn = function (...args) {
    try {
      pushCapped(consoleErrors, {
        type: 'warn',
        message: truncate(args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(' ')),
        timestamp: Date.now(),
      });
    } catch {
      // never let capture break the page
    }
    originalConsoleWarn(...args);
  };

  window.addEventListener('error', (event) => {
    pushCapped(jsExceptions, {
      type: 'error',
      message: truncate(event.message || 'Uncaught error'),
      stack: event.error && event.error.stack ? truncate(event.error.stack) : null,
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : null,
      timestamp: Date.now(),
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    pushCapped(jsExceptions, {
      type: 'unhandledrejection',
      message: truncate(reason instanceof Error ? reason.message : String(reason)),
      stack: reason instanceof Error && reason.stack ? truncate(reason.stack) : null,
      source: null,
      timestamp: Date.now(),
    });
  });

  function detectBuildVersion() {
    try {
      const meta = document.querySelector('meta[name="build-version"]');
      if (meta && meta.getAttribute('content')) return meta.getAttribute('content');
      if (window.__BUILD__) return String(window.__BUILD__);
      if (window.__COMMIT_SHA__) return String(window.__COMMIT_SHA__);
    } catch {
      // ignore - unknown page structure
    }
    return '';
  }

  function getDiagnostics() {
    const conn = navigator.connection || {};
    return {
      consoleErrors: consoleErrors.slice(),
      jsExceptions: jsExceptions.slice(),
      buildVersion: detectBuildVersion(),
      referrer: pageReferrer,
      timeOnPageMs: Math.round(performance.now() - pageLoadedAt),
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemory: navigator.deviceMemory || null,
      connectionType: conn.effectiveType || '',
      connectionDownlink: conn.downlink || null,
    };
  }

  function pruneRecordingBuffer() {
    const cutoff = Date.now() - RECORDING_MAX_AGE_MS;
    while (recordedEvents.length > 0 && recordedEvents[0].timestamp < cutoff) recordedEvents.shift();
    while (recordedEvents.length > RECORDING_MAX_EVENTS) recordedEvents.shift();
  }

  function showBanner() {
    if (bannerEl) return;
    bannerEl = document.createElement('div');
    bannerEl.textContent = '● Recording session for bug report';
    Object.assign(bannerEl.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      zIndex: 2147483647,
      background: '#dc2626',
      color: '#fff',
      font: '12px/1.4 -apple-system, sans-serif',
      padding: '6px 10px',
      borderRadius: '6px',
      boxShadow: '0 2px 8px rgba(0,0,0,.3)',
      pointerEvents: 'none',
    });
    document.documentElement.appendChild(bannerEl);
  }

  function hideBanner() {
    if (bannerEl) {
      bannerEl.remove();
      bannerEl = null;
    }
  }

  function loadRrweb() {
    if (window.rrweb) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = window.__BUGSHOT_RRWEB_URL__;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('failed to load rrweb'));
      document.documentElement.appendChild(script);
    });
  }

  async function startRecording() {
    if (recording) return;
    await loadRrweb();
    if (!window.rrweb) return;
    recordedEvents = [];
    recording = true;
    showBanner();
    stopRecordingFn = window.rrweb.record({
      emit(event) {
        recordedEvents.push({ ...event, timestamp: event.timestamp || Date.now() });
        pruneRecordingBuffer();
      },
      maskAllInputs: true,
      blockClass: 'bugshot-block',
      blockSelector: '[data-bugshot-block]',
      ignoreClass: 'bugshot-ignore',
    });
  }

  function stopRecording() {
    if (stopRecordingFn) stopRecordingFn();
    stopRecordingFn = null;
    recording = false;
    hideBanner();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'bugshot-content') return;

    (async () => {
      let payload;
      switch (msg.type) {
        case 'GET_DIAGNOSTICS':
          payload = getDiagnostics();
          break;
        case 'START_RECORDING':
          window.__BUGSHOT_RRWEB_URL__ = msg.rrwebUrl;
          await startRecording();
          payload = { recording };
          break;
        case 'STOP_RECORDING':
          stopRecording();
          payload = { recording };
          break;
        case 'GET_RECORDING':
          pruneRecordingBuffer();
          payload = { recording, events: recordedEvents.slice() };
          break;
        default:
          return;
      }
      window.postMessage({ source: 'bugshot-inject', requestId: msg.requestId, type: msg.type, payload }, '*');
    })();
  });
})();
