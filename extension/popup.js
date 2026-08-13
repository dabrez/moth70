let capturedScreenshot = null;
let tabInfo = null;
let injectedInfo = null;
let diagnostics = null;
let networkFailures = [];

const API_URL = "http://localhost:3000/api/reports";

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
      reporterName: "Anonymous User",
      reporterEmail: null,
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
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error("Failed to submit");
      }

      form.style.display = "none";
      document.getElementById("screenshot-preview-container").style.display = "none";
      document.getElementById("success-message").classList.remove("hidden");
    } catch (err) {
      console.error(err);
      alert("Failed to submit report. Ensure the Next.js app is running on localhost:3000.");
      submitBtn.disabled = false;
      submitBtn.innerText = "Submit Report";
    }
  });

  document.getElementById("close-btn").addEventListener("click", () => {
    window.close();
  });
});
