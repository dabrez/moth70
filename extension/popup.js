let capturedScreenshot = null;
let tabInfo = null;
let injectedInfo = null;
let diagnostics = null;
let networkFailures = [];

const DEFAULT_SERVER_URL = "http://localhost:3000";

// Settings live in chrome.storage.sync so they follow the user across machines.
// `serverUrl` is the only required one; reporter identity is self-asserted and optional.
let settings = { serverUrl: "", reporterName: "", reporterEmail: "" };

function normalizeServerUrl(raw) {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  // Any explicit scheme other than http(s) is rejected outright. Without this check
  // "ftp://host" would fall through to the bare-host branch and become
  // "http://ftp://host", which parses as a valid URL pointing nowhere useful.
  const explicitScheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  if (explicitScheme && !/^https?$/i.test(explicitScheme[1])) return "";

  // Accept a bare host ("localhost:3000") by assuming http, which is what a
  // local instance will almost always be.
  const withScheme = explicitScheme ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname) return "";
    return withScheme;
  } catch {
    return "";
  }
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["serverUrl", "reporterName", "reporterEmail"], (stored) => {
      resolve({
        serverUrl: normalizeServerUrl(stored?.serverUrl),
        reporterName: stored?.reporterName || "",
        reporterEmail: stored?.reporterEmail || "",
      });
    });
  });
}

function saveSettings(next) {
  return new Promise((resolve) => chrome.storage.sync.set(next, resolve));
}

/** Probes the reports endpoint so a bad URL is caught before a report is written. */
async function testConnection(serverUrl) {
  try {
    const response = await fetch(`${serverUrl}/api/reports?limit=1`, { method: "GET" });
    if (!response.ok) return { ok: false, message: `Server responded ${response.status}` };
    await response.json();
    return { ok: true, message: "Connected" };
  } catch {
    return { ok: false, message: "Could not reach server" };
  }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

async function captureSessionReplay(tabId) {
  const result = await sendTabMessage(tabId, { type: "GET_RECORDING" });
  const events = result?.events;
  if (!events || events.length === 0) return null;
  try {
    const json = JSON.stringify(events);
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressedBuffer = await new Response(stream).arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(compressedBuffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch (e) {
    console.error("Failed to package session replay", e);
    return null;
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const screenshotPreview = document.getElementById("screenshot-preview");
  const screenshotLoading = document.getElementById("screenshot-loading");

  // 0. Settings panel. Opens automatically on first run, since without a server
  //    URL there is nowhere to submit and the form would fail on submit instead.
  const settingsPanel = document.getElementById("settings-panel");
  const mainView = document.getElementById("main-view");
  const serverUrlInput = document.getElementById("server-url");
  const reporterNameInput = document.getElementById("reporter-name");
  const reporterEmailInput = document.getElementById("reporter-email");
  const settingsStatus = document.getElementById("settings-status");
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  const testConnectionBtn = document.getElementById("test-connection-btn");

  settings = await loadSettings();
  serverUrlInput.value = settings.serverUrl;
  reporterNameInput.value = settings.reporterName;
  reporterEmailInput.value = settings.reporterEmail;

  function setSettingsStatus(message, kind) {
    settingsStatus.textContent = message;
    settingsStatus.className = `settings-status${kind ? ` ${kind}` : ""}`;
  }

  function showSettings(show) {
    settingsPanel.classList.toggle("hidden", !show);
    mainView.classList.toggle("hidden", show);
  }

  const isFirstRun = !settings.serverUrl;
  if (isFirstRun) {
    serverUrlInput.placeholder = DEFAULT_SERVER_URL;
    setSettingsStatus("Set the server URL to start reporting.", null);
  }
  showSettings(isFirstRun);

  document.getElementById("settings-btn").addEventListener("click", () => {
    showSettings(settingsPanel.classList.contains("hidden"));
  });

  testConnectionBtn.addEventListener("click", async () => {
    const candidate = normalizeServerUrl(serverUrlInput.value) || DEFAULT_SERVER_URL;
    testConnectionBtn.disabled = true;
    setSettingsStatus("Testing…", null);
    const result = await testConnection(candidate);
    setSettingsStatus(
      result.ok ? `${result.message} to ${candidate}` : result.message,
      result.ok ? "ok" : "error"
    );
    testConnectionBtn.disabled = false;
  });

  saveSettingsBtn.addEventListener("click", async () => {
    const serverUrl = normalizeServerUrl(serverUrlInput.value);
    if (!serverUrl) {
      setSettingsStatus("Enter a valid http(s) URL.", "error");
      return;
    }
    settings = {
      serverUrl,
      reporterName: reporterNameInput.value.trim(),
      reporterEmail: reporterEmailInput.value.trim(),
    };
    await saveSettings(settings);
    serverUrlInput.value = serverUrl;
    setSettingsStatus("Saved", "ok");
    showSettings(false);
  });

  // 1. Get current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabInfo = tab;

  // 2. Inject script to get innerWidth, innerHeight
  if (tab && tab.id) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            colorDepth: window.screen.colorDepth,
            userAgent: navigator.userAgent,
            language: navigator.language,
            cookieEnabled: navigator.cookieEnabled,
            touchEnabled: navigator.maxTouchPoints > 0
          };
        }
      });
      if (results && results[0]) {
        injectedInfo = results[0].result;
      }
    } catch (e) {
      console.error("Could not inject script - this is expected on chrome:// URLs", e);
    }
  }

  // 2b. Fetch buffered diagnostics (console errors, exceptions, build version, etc.)
  //     from the persistent content script, and network failures from the background worker.
  if (tab && tab.id) {
    diagnostics = await sendTabMessage(tab.id, { type: "GET_DIAGNOSTICS" });
    networkFailures = (await sendRuntimeMessage({ type: "GET_NETWORK_FAILURES", tabId: tab.id })) || [];
    const diagnosticsNote = document.getElementById("diagnostics-note");
    if (diagnosticsNote) {
      const count = (diagnostics?.consoleErrors?.length || 0) + (diagnostics?.jsExceptions?.length || 0) + networkFailures.length;
      diagnosticsNote.textContent = count > 0
        ? `${count} console/network diagnostic${count === 1 ? "" : "s"} will be attached`
        : "No console or network errors detected";
    }
  }

  // 2c. Session recording toggle (opt-in, separate from the bug form itself).
  const recordingToggle = document.getElementById("recording-toggle");
  const recordingStatus = document.getElementById("recording-status");
  let isRecording = false;

  function setRecordingUi(active) {
    isRecording = active;
    recordingToggle.textContent = active ? "Stop Recording" : "Start Recording";
    recordingToggle.classList.toggle("recording", active);
    recordingStatus.textContent = active ? "⏺ Recording session…" : "Session recording off";
    recordingStatus.classList.toggle("active", active);
    if (tab && tab.id) {
      chrome.action.setBadgeText({ text: active ? "REC" : "", tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: "#dc2626", tabId: tab.id });
    }
  }

  if (tab && tab.id) {
    const current = await sendTabMessage(tab.id, { type: "GET_RECORDING" });
    setRecordingUi(Boolean(current?.recording));
  }

  recordingToggle.addEventListener("click", async () => {
    if (!tab || !tab.id) return;
    recordingToggle.disabled = true;
    const type = isRecording ? "STOP_RECORDING" : "START_RECORDING";
    const result = await sendTabMessage(tab.id, { type });
    setRecordingUi(Boolean(result?.recording));
    recordingToggle.disabled = false;
  });

  // 3. Capture visible tab
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 80 });
    capturedScreenshot = dataUrl;
    screenshotPreview.src = dataUrl;
    screenshotPreview.style.display = "block";
    screenshotLoading.style.display = "none";
  } catch (e) {
    console.error("Could not capture screenshot", e);
    screenshotLoading.innerText = "Screenshot unavailable";
  }

  // 4. Handle Form Submission
  const form = document.getElementById("bug-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("submit-btn");

    // Without a server there is nowhere to submit; send the user to settings
    // rather than failing after they have written up the whole report.
    if (!settings.serverUrl) {
      showSettings(true);
      setSettingsStatus("Set the server URL before submitting.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerText = "Submitting...";

    const title = document.getElementById("title").value;
    const description = document.getElementById("description").value;
    const severity = document.getElementById("severity").value;

    let sessionReplay = null;
    if (isRecording && tab && tab.id) {
      submitBtn.innerText = "Packaging recording...";
      sessionReplay = await captureSessionReplay(tab.id);
      await sendTabMessage(tab.id, { type: "STOP_RECORDING" });
      setRecordingUi(false);
      submitBtn.innerText = "Submitting...";
    }

    const payload = {
      title,
      description,
      severity,
      websiteUrl: tabInfo?.url || "Unknown URL",
      pageTitle: tabInfo?.title || "Unknown Title",
      screenshot: capturedScreenshot,
      browser: "Chrome", 
      browserVersion: "Extension", 
      os: navigator.platform || "Unknown OS",
      deviceType: "desktop", 
      screenWidth: window.screen.width || 0,
      screenHeight: window.screen.height || 0,
      viewportWidth: injectedInfo?.innerWidth || window.innerWidth || 0,
      viewportHeight: injectedInfo?.innerHeight || window.innerHeight || 0,
      devicePixelRatio: injectedInfo?.devicePixelRatio || window.devicePixelRatio || 1,
      colorDepth: injectedInfo?.colorDepth || window.screen.colorDepth || 24,
      userAgent: injectedInfo?.userAgent || navigator.userAgent || "Unknown",
      language: injectedInfo?.language || navigator.language || null,
      cookieEnabled: injectedInfo?.cookieEnabled ?? navigator.cookieEnabled ?? true,
      touchEnabled: injectedInfo?.touchEnabled ?? (navigator.maxTouchPoints > 0) ?? false,
      online: navigator.onLine,
      bugTimestamp: new Date().toISOString(),
      reporterName: settings.reporterName || "Anonymous User",
      reporterEmail: settings.reporterEmail || null,
      buildVersion: diagnostics?.buildVersion || "",
      referrer: diagnostics?.referrer || "",
      hardwareConcurrency: diagnostics?.hardwareConcurrency ?? null,
      deviceMemory: diagnostics?.deviceMemory ?? null,
      connectionType: diagnostics?.connectionType || "",
      connectionDownlink: diagnostics?.connectionDownlink ?? null,
      consoleErrors: diagnostics?.consoleErrors?.length ? JSON.stringify(diagnostics.consoleErrors) : null,
      jsExceptions: diagnostics?.jsExceptions?.length ? JSON.stringify(diagnostics.jsExceptions) : null,
      networkFailures: networkFailures.length ? JSON.stringify(networkFailures) : null,
      sessionReplay,
    };

    try {
      const response = await fetch(`${settings.serverUrl}/api/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`Server responded ${response.status}`);
      }

      const created = await response.json().catch(() => null);

      // Only the confirmation should remain: a "Start Recording" control or a diagnostics
      // count above it reads as if there were more to do.
      for (const id of ["bug-form", "screenshot-preview-container", "diagnostics-note", "recording-controls"]) {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
      }
      document.getElementById("success-message").classList.remove("hidden");

      // Link straight to the new report so it can be opened or handed to an agent.
      if (created?.id) {
        const link = document.getElementById("view-report-link");
        link.href = `${settings.serverUrl}/report/${created.id}`;
        link.classList.remove("hidden");
      }
    } catch (err) {
      console.error(err);
      // A browser dialog would block the extension, so report inline instead.
      const note = document.getElementById("diagnostics-note");
      if (note) {
        note.textContent = `Submit failed: ${err.message}. Check the server URL in settings.`;
        note.classList.add("submit-error");
      }
      submitBtn.disabled = false;
      submitBtn.innerText = "Submit Report";
    }
  });

  document.getElementById("close-btn").addEventListener("click", () => {
    window.close();
  });
});
