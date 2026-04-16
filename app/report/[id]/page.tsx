import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { SEVERITY_CONFIG, STATUS_CONFIG, formatDate, formatRelativeDate, getDomain } from '@/lib/utils';
import { CopyLinkButton } from './CopyLinkButton';
import { StatusUpdater } from './StatusUpdater';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await prisma.bugReport.findUnique({ where: { id }, select: { title: true, websiteUrl: true } });
  if (!report) return { title: 'Report not found' };
  return {
    title: `${report.title} — ${getDomain(report.websiteUrl)}`,
    description: `Bug report for ${getDomain(report.websiteUrl)}: ${report.title}`,
  };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await prisma.bugReport.findUnique({ where: { id } });
  if (!report) notFound();

  const severity = SEVERITY_CONFIG[report.severity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.medium;
  const status = STATUS_CONFIG[report.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open;

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
            <span className="text-xl">🐛</span><span>BugShot</span>
          </Link>
          <div className="flex items-center gap-3">
            <CopyLinkButton reportId={report.id} />
            <Link href="/report/new" className="text-sm bg-rose-500 text-white px-3 py-1.5 rounded-lg hover:bg-rose-600 transition-colors font-medium">New Report</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${severity.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${severity.dot}`}></span>{severity.label}
            </span>
            <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border ${status.color}`}>{status.label}</span>
            <span className="text-xs text-slate-400 ml-auto">{formatRelativeDate(report.createdAt)} · {formatDate(report.createdAt)}</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">{report.title}</h1>
          <a href={report.websiteUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-rose-500 hover:text-rose-600 font-mono break-all">
            {report.websiteUrl}
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
          {report.reporterName && (
            <p className="mt-2 text-xs text-slate-400">
              Reported by <span className="font-medium text-slate-600">{report.reporterName}</span>
              {report.reporterEmail && <> · <a href={`mailto:${report.reporterEmail}`} className="text-rose-500 hover:underline">{report.reporterEmail}</a></>}
            </p>
          )}
        </div>

        {/* Screenshot */}
        {report.screenshot && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-700">Screenshot</span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={report.screenshot} alt="Bug screenshot" className="w-full object-contain bg-slate-100 max-h-[600px]" />
          </div>
        )}

        {/* Description */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Description</h2>
            <p className="text-slate-800 text-sm leading-relaxed whitespace-pre-wrap">{report.description}</p>
          </div>
          {report.steps && (
            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Steps to Reproduce</h2>
              <p className="text-slate-800 text-sm leading-relaxed whitespace-pre-wrap">{report.steps}</p>
            </div>
          )}
          {(report.expected || report.actual) && (
            <div className="grid sm:grid-cols-2 gap-4">
              {report.expected && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                  <h2 className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-1.5">Expected</h2>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{report.expected}</p>
                </div>
              )}
              {report.actual && (
                <div className="bg-rose-50 border border-rose-100 rounded-xl p-4">
                  <h2 className="text-xs font-semibold text-rose-700 uppercase tracking-wider mb-1.5">Actual</h2>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{report.actual}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Technical Environment */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Technical Environment</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
            {[
              { icon: '🌐', label: 'Browser', value: `${report.browser}${report.browserVersion ? ' ' + report.browserVersion.split('.')[0] : ''}`, sub: report.browserVersion },
              { icon: '💻', label: 'OS', value: `${report.os}${report.osVersion ? ' ' + report.osVersion : ''}` },
              { icon: '📱', label: 'Device', value: report.deviceType.charAt(0).toUpperCase() + report.deviceType.slice(1) },
              { icon: '📐', label: 'Screen', value: `${report.screenWidth}×${report.screenHeight}`, sub: `${report.devicePixelRatio}× DPI` },
              { icon: '🖥️', label: 'Viewport', value: `${report.viewportWidth}×${report.viewportHeight}` },
              { icon: '🎨', label: 'Color Depth', value: report.colorDepth ? `${report.colorDepth}-bit` : '—' },
              { icon: '🌍', label: 'Language', value: report.language || '—' },
              { icon: '🕐', label: 'Timezone', value: report.timezone || '—' },
              { icon: '🍪', label: 'Cookies', value: report.cookieEnabled ? 'Enabled' : 'Disabled' },
              { icon: '👆', label: 'Touch', value: report.touchEnabled ? 'Yes' : 'No' },
              { icon: '📡', label: 'Online', value: report.online ? 'Yes' : 'No' },
              {
                icon: '⏱️', label: 'Captured at',
                value: report.bugTimestamp ? new Date(report.bugTimestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—',
                sub: report.bugTimestamp ? new Date(report.bugTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : undefined,
              },
            ].map((item) => (
              <div key={item.label} className="bg-slate-50 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">{item.icon}</span>
                  <span className="text-xs text-slate-400 font-medium">{item.label}</span>
                </div>
                <div className="text-sm font-semibold text-slate-800 leading-tight">{item.value}</div>
                {item.sub && <div className="text-xs text-slate-400 mt-0.5">{item.sub}</div>}
              </div>
            ))}
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-xs text-slate-400 font-medium mb-1">User Agent</div>
            <code className="text-xs text-slate-600 break-all font-mono leading-relaxed">{report.userAgent}</code>
          </div>
        </div>

        {/* Status */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Update Status</h2>
          <StatusUpdater reportId={report.id} currentStatus={report.status} />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 pb-8">
          <CopyLinkButton reportId={report.id} variant="full" />
          <Link href="/dashboard" className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-xl hover:bg-slate-50 transition-colors">← All Reports</Link>
          <Link href="/report/new" className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-xl hover:bg-slate-50 transition-colors">Submit Another</Link>
        </div>
      </div>
    </div>
  );
}
