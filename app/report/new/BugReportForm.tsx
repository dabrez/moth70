'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { SEVERITY_CONFIG } from '@/lib/utils';

interface EnvInfo {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  deviceType: string;
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  colorDepth: number;
  language: string;
  timezone: string;
  cookieEnabled: boolean;
  touchEnabled: boolean;
  online: boolean;
  userAgent: string;
  buildVersion: string;
  referrer: string;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  connectionType: string;
  connectionDownlink: number | null;
}

function detectBuildVersion(): string {
  try {
    const meta = document.querySelector('meta[name="build-version"]');
    if (meta?.getAttribute('content')) return meta.getAttribute('content')!;
    const w = window as unknown as Record<string, unknown>;
    if (w.__BUILD__) return String(w.__BUILD__);
    if (w.__COMMIT_SHA__) return String(w.__COMMIT_SHA__);
  } catch {
    // ignore
  }
  return '';
}

function detectEnv(overrides: Record<string, string> = {}): EnvInfo {
  const ua = navigator.userAgent;

  let browser = 'Unknown', browserVersion = '';
  if (/Edg\//.test(ua)) {
    browser = 'Edge'; browserVersion = ua.match(/Edg\/([\d.]+)/)?.[1] ?? '';
  } else if (/OPR\//.test(ua) || /Opera\//.test(ua)) {
    browser = 'Opera'; browserVersion = ua.match(/(?:OPR|Opera)\/([\d.]+)/)?.[1] ?? '';
  } else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) {
    browser = 'Chrome'; browserVersion = ua.match(/Chrome\/([\d.]+)/)?.[1] ?? '';
  } else if (/Firefox\//.test(ua)) {
    browser = 'Firefox'; browserVersion = ua.match(/Firefox\/([\d.]+)/)?.[1] ?? '';
  } else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) {
    browser = 'Safari'; browserVersion = ua.match(/Version\/([\d.]+)/)?.[1] ?? '';
  }

  let os = 'Unknown', osVersion = '', deviceType = 'desktop';
  if (/Windows NT/.test(ua)) {
    os = 'Windows';
    const v = ua.match(/Windows NT ([\d.]+)/)?.[1] ?? '';
    const winMap: Record<string, string> = { '10.0': '10 / 11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    osVersion = winMap[v] ?? v;
  } else if (/Android/.test(ua)) {
    os = 'Android'; osVersion = ua.match(/Android ([\d.]+)/)?.[1] ?? '';
    deviceType = /Tablet/.test(ua) ? 'tablet' : 'mobile';
  } else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    os = 'iPadOS'; osVersion = ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? '';
    deviceType = 'tablet';
  } else if (/iPhone|iPod/.test(ua)) {
    os = 'iOS'; osVersion = ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? '';
    deviceType = 'mobile';
  } else if (/Mac OS X/.test(ua)) {
    os = 'macOS'; osVersion = ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? '';
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  } else if (/CrOS/.test(ua)) {
    os = 'ChromeOS';
  }

  const conn = (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number } }).connection ?? {};
  const nav = navigator as unknown as { deviceMemory?: number };

  return {
    browser, browserVersion, os, osVersion, deviceType,
    screenWidth: overrides.sw ? parseInt(overrides.sw) : screen.width,
    screenHeight: overrides.sh ? parseInt(overrides.sh) : screen.height,
    viewportWidth: overrides.vw ? parseInt(overrides.vw) : window.innerWidth,
    viewportHeight: overrides.vh ? parseInt(overrides.vh) : window.innerHeight,
    devicePixelRatio: overrides.dpr ? parseFloat(overrides.dpr) : window.devicePixelRatio ?? 1,
    colorDepth: screen.colorDepth ?? 24,
    language: overrides.lang || navigator.language || '',
    timezone: overrides.tz || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : ''),
    cookieEnabled: navigator.cookieEnabled,
    touchEnabled: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    online: navigator.onLine,
    userAgent: ua,
    buildVersion: overrides.build || detectBuildVersion(),
    referrer: document.referrer || '',
    hardwareConcurrency: overrides.hc ? parseInt(overrides.hc) : navigator.hardwareConcurrency ?? null,
    deviceMemory: overrides.dm ? parseFloat(overrides.dm) : nav.deviceMemory ?? null,
    connectionType: overrides.ct || conn.effectiveType || '',
    connectionDownlink: overrides.cd ? parseFloat(overrides.cd) : conn.downlink ?? null,
  };
}

export function BugReportForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    websiteUrl: '',
    title: '',
    description: '',
    steps: '',
    expected: '',
    actual: '',
    severity: 'medium' as 'low' | 'medium' | 'high' | 'critical',
    reporterName: '',
    reporterEmail: '',
  });

  useEffect(() => {
    const url = searchParams.get('url') ?? '';
    if (url) setForm((f) => ({ ...f, websiteUrl: url }));

    const overrides: Record<string, string> = {};
    ['sw', 'sh', 'vw', 'vh', 'dpr', 'lang', 'tz', 'build', 'hc', 'dm', 'ct', 'cd'].forEach((k) => {
      const v = searchParams.get(k);
      if (v) overrides[k] = v;
    });
    setEnv(detectEnv(overrides));
  }, [searchParams]);

  const handleGlobalPaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) loadImageFile(file);
        break;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [handleGlobalPaste]);

  function loadImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const ratio = Math.min(MAX / width, MAX / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        setScreenshot(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) loadImageFile(file);
  }

  function validate() {
    const errs: Record<string, string> = {};
    if (!form.websiteUrl.trim()) errs.websiteUrl = 'Please enter the URL where you found the bug';
    if (!form.title.trim()) errs.title = 'Please give the bug a brief title';
    if (!form.description.trim()) errs.description = 'Please describe what happened';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || !env) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form, ...env, screenshot,
          pageTitle: searchParams.get('title') ?? '',
          bugTimestamp: searchParams.get('ts')
            ? new Date(parseInt(searchParams.get('ts')!)).toISOString()
            : new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error('Server error');
      const report = await res.json();
      setSubmittedId(report.id);
    } catch {
      alert('Failed to submit the report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function copyLink() {
    const url = `${window.location.origin}/report/${submittedId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (submittedId) {
    const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/report/${submittedId}`;
    return (
      <div className="text-center py-10 px-4">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">✓</div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Bug report submitted!</h2>
        <p className="text-slate-500 mb-6 text-sm">Share this link with the website&apos;s team so they can see the full technical details.</p>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3 max-w-lg mx-auto mb-6">
          <code className="flex-1 text-sm text-slate-700 truncate font-mono">{link}</code>
          <button onClick={copyLink} className="shrink-0 px-3 py-1.5 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 transition-colors font-medium">
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button onClick={() => router.push(`/report/${submittedId}`)} className="px-5 py-2.5 bg-rose-500 text-white rounded-xl hover:bg-rose-600 transition-colors font-medium text-sm">
            View Full Report →
          </button>
          <button
            onClick={() => { setSubmittedId(null); setScreenshot(null); setForm({ websiteUrl: '', title: '', description: '', steps: '', expected: '', actual: '', severity: 'medium', reporterName: '', reporterEmail: '' }); setErrors({}); }}
            className="px-5 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors font-medium text-sm"
          >
            Submit Another Report
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-12">

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="websiteUrl">
          URL where the bug occurs <span className="text-rose-500">*</span>
        </label>
        <input id="websiteUrl" type="url" value={form.websiteUrl}
          onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
          placeholder="https://example.com/some/page"
          className={`w-full px-3.5 py-2.5 rounded-xl border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-300 transition-all ${errors.websiteUrl ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white'}`}
        />
        {errors.websiteUrl && <p className="mt-1 text-xs text-rose-500">{errors.websiteUrl}</p>}
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="title">
          Bug title <span className="text-rose-500">*</span>
        </label>
        <input id="title" type="text" value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="e.g. Checkout button does nothing on mobile"
          className={`w-full px-3.5 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 transition-all ${errors.title ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white'}`}
          maxLength={200}
        />
        {errors.title && <p className="mt-1 text-xs text-rose-500">{errors.title}</p>}
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="description">
          What happened? <span className="text-rose-500">*</span>
        </label>
        <textarea id="description" value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Describe the bug clearly. What did you do, and what went wrong?"
          rows={4}
          className={`w-full px-3.5 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 transition-all resize-none ${errors.description ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white'}`}
        />
        {errors.description && <p className="mt-1 text-xs text-rose-500">{errors.description}</p>}
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
          Screenshot <span className="text-slate-400 font-normal">(optional but very helpful)</span>
        </label>
        {screenshot ? (
          <div className="relative rounded-xl overflow-hidden border border-slate-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={screenshot} alt="Bug screenshot" className="w-full max-h-80 object-contain bg-slate-100" />
            <button type="button" onClick={() => setScreenshot(null)}
              className="absolute top-2 right-2 w-7 h-7 bg-slate-800/80 text-white rounded-full flex items-center justify-center text-sm hover:bg-slate-900 transition-colors"
              aria-label="Remove screenshot">×</button>
          </div>
        ) : (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${isDragging ? 'border-rose-400 bg-rose-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
          >
            <div className="text-3xl mb-2">📸</div>
            <p className="text-sm font-medium text-slate-600 mb-1">
              Drop an image, click to browse, or{' '}
              <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs font-mono">Ctrl+V</kbd>{' '}
              to paste
            </p>
            <p className="text-xs text-slate-400">PNG, JPG, GIF, WebP — will be compressed automatically</p>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) loadImageFile(f); }} />
          </div>
        )}
        <p className="mt-1.5 text-xs text-slate-400">
          Tip: On Mac use <kbd className="px-1 bg-slate-100 border border-slate-200 rounded font-mono">⌘ Shift 4</kbd>,
          on Windows use <kbd className="px-1 bg-slate-100 border border-slate-200 rounded font-mono">Win+Shift+S</kbd> to screenshot, then paste here.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="steps">
            Steps to reproduce <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <textarea id="steps" value={form.steps}
            onChange={(e) => setForm((f) => ({ ...f, steps: e.target.value }))}
            placeholder={"1. Go to checkout\n2. Fill in address\n3. Click 'Place Order'\n4. Nothing happens"}
            rows={4}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 transition-all resize-none"
          />
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="expected">
              Expected behaviour <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea id="expected" value={form.expected}
              onChange={(e) => setForm((f) => ({ ...f, expected: e.target.value }))}
              placeholder="The order should be placed and I should see a confirmation"
              rows={2}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 transition-all resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="actual">
              Actual behaviour <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea id="actual" value={form.actual}
              onChange={(e) => setForm((f) => ({ ...f, actual: e.target.value }))}
              placeholder="The button does nothing, no error shown"
              rows={2}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 transition-all resize-none"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">Severity</label>
        <div className="flex gap-2 flex-wrap">
          {(Object.entries(SEVERITY_CONFIG) as [string, typeof SEVERITY_CONFIG[keyof typeof SEVERITY_CONFIG]][]).map(([key, cfg]) => (
            <button key={key} type="button"
              onClick={() => setForm((f) => ({ ...f, severity: key as typeof form.severity }))}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${form.severity === key ? cfg.color + ' ring-2 ring-offset-1 ring-current' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >
              <span className={`w-2 h-2 rounded-full ${cfg.dot}`}></span>{cfg.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="reporterName">
            Your name <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input id="reporterName" type="text" value={form.reporterName}
            onChange={(e) => setForm((f) => ({ ...f, reporterName: e.target.value }))}
            placeholder="Jane Smith"
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="reporterEmail">
            Your email <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input id="reporterEmail" type="email" value={form.reporterEmail}
            onChange={(e) => setForm((f) => ({ ...f, reporterEmail: e.target.value }))}
            placeholder="jane@example.com"
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 transition-all"
          />
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <button type="button" onClick={() => setShowTech(!showTech)}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">Technical info</span>
            <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full font-medium">Auto-detected</span>
          </div>
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${showTech ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showTech && env && (
          <div className="px-4 py-4 grid grid-cols-2 sm:grid-cols-3 gap-3 bg-white">
            {[
              { label: 'Browser', value: `${env.browser} ${env.browserVersion}` },
              { label: 'OS', value: `${env.os}${env.osVersion ? ' ' + env.osVersion : ''}` },
              { label: 'Device', value: env.deviceType.charAt(0).toUpperCase() + env.deviceType.slice(1) },
              { label: 'Screen', value: `${env.screenWidth}×${env.screenHeight}` },
              { label: 'Viewport', value: `${env.viewportWidth}×${env.viewportHeight}` },
              { label: 'Pixel ratio', value: `${env.devicePixelRatio}×` },
              { label: 'Color depth', value: `${env.colorDepth}-bit` },
              { label: 'Language', value: env.language || '—' },
              { label: 'Timezone', value: env.timezone || '—' },
              { label: 'Cookies', value: env.cookieEnabled ? 'Enabled' : 'Disabled' },
              { label: 'Touch', value: env.touchEnabled ? 'Yes' : 'No' },
              { label: 'Online', value: env.online ? 'Yes' : 'No' },
              { label: 'Build version', value: env.buildVersion || '—' },
              { label: 'CPU cores', value: env.hardwareConcurrency ? String(env.hardwareConcurrency) : '—' },
              { label: 'Device memory', value: env.deviceMemory ? `${env.deviceMemory} GB` : '—' },
              { label: 'Connection', value: env.connectionType ? `${env.connectionType}${env.connectionDownlink ? ` (${env.connectionDownlink}Mbps)` : ''}` : '—' },
              { label: 'Referrer', value: env.referrer ? new URL(env.referrer, location.href).hostname : '—' },
            ].map((item) => (
              <div key={item.label} className="bg-slate-50 rounded-lg p-2.5">
                <div className="text-xs text-slate-400 mb-0.5">{item.label}</div>
                <div className="text-sm font-medium text-slate-700 truncate">{item.value}</div>
              </div>
            ))}
            <div className="col-span-2 sm:col-span-3 bg-slate-50 rounded-lg p-2.5">
              <div className="text-xs text-slate-400 mb-0.5">User Agent</div>
              <div className="text-xs font-mono text-slate-600 break-all">{env.userAgent}</div>
            </div>
          </div>
        )}

        {!showTech && (
          <div className="px-4 py-2.5 bg-white border-t border-slate-100">
            {env ? (
              <p className="text-xs text-slate-500">
                {env.browser} {env.browserVersion} · {env.os}{env.osVersion ? ' ' + env.osVersion : ''} · {env.screenWidth}×{env.screenHeight} · {env.deviceType}
              </p>
            ) : (
              <p className="text-xs text-slate-400">Detecting…</p>
            )}
          </div>
        )}
      </div>

      <button type="submit" disabled={isSubmitting}
        className="w-full py-3 bg-rose-500 text-white rounded-xl font-semibold text-sm hover:bg-rose-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
      >
        {isSubmitting ? 'Submitting…' : 'Submit Bug Report'}
      </button>
      <p className="text-center text-xs text-slate-400">No account needed. The report gets a permanent, shareable link.</p>
    </form>
  );
}
