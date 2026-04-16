import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { SEVERITY_CONFIG, STATUS_CONFIG, formatRelativeDate, getDomain } from '@/lib/utils';

export const metadata = { title: 'Bug Report Dashboard' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ severity?: string; status?: string; search?: string; page?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = parseInt(params.page || '1');
  const limit = 20;
  const { severity, status, search } = params;

  const where = {
    ...(severity ? { severity } : {}),
    ...(status ? { status } : {}),
    ...(search ? { OR: [{ title: { contains: search } }, { websiteUrl: { contains: search } }, { description: { contains: search } }] } : {}),
  };

  const [reports, total, stats, openCount, totalCount] = await Promise.all([
    prisma.bugReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, createdAt: true, title: true, severity: true, status: true,
        websiteUrl: true, pageTitle: true, browser: true, browserVersion: true,
        os: true, deviceType: true, reporterName: true, screenshot: false,
      },
    }),
    prisma.bugReport.count({ where }),
    prisma.bugReport.groupBy({ by: ['severity'], _count: true, where: { status: { not: 'closed' } } }),
    prisma.bugReport.count({ where: { status: 'open' } }),
    prisma.bugReport.count(),
  ]);

  const pages = Math.ceil(total / limit);

  function buildUrl(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = { severity, status, search, page: String(page), ...overrides };
    Object.entries(merged).forEach(([k, v]) => { if (v && v !== 'undefined') p.set(k, v); });
    return `/dashboard?${p.toString()}`;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
            <span className="text-xl">🐛</span><span>BugShot</span>
          </Link>
          <Link href="/report/new" className="text-sm bg-rose-500 text-white px-3 py-1.5 rounded-lg hover:bg-rose-600 transition-colors font-medium">New Report</Link>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-4">Bug Reports</h1>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-2xl font-bold text-slate-900">{totalCount}</div>
              <div className="text-xs text-slate-500 mt-0.5">Total Reports</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-2xl font-bold text-blue-600">{openCount}</div>
              <div className="text-xs text-slate-500 mt-0.5">Open</div>
            </div>
            {stats.filter((s) => s.severity === 'critical' || s.severity === 'high').map((s) => {
              const cfg = SEVERITY_CONFIG[s.severity as keyof typeof SEVERITY_CONFIG];
              return (
                <div key={s.severity} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className={`text-2xl font-bold ${s.severity === 'critical' ? 'text-red-600' : 'text-orange-600'}`}>{s._count}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{cfg.label} Severity</div>
                </div>
              );
            })}
          </div>
        </div>

        <form method="get" action="/dashboard" className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
          <input name="search" defaultValue={search} placeholder="Search title, URL, description…"
            className="flex-1 min-w-48 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
          <select name="severity" defaultValue={severity || ''} className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-300 bg-white">
            <option value="">All severities</option>
            {Object.entries(SEVERITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select name="status" defaultValue={status || ''} className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-300 bg-white">
            <option value="">All statuses</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button type="submit" className="px-4 py-2 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 transition-colors font-medium">Filter</button>
          {(severity || status || search) && <Link href="/dashboard" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">Clear</Link>}
        </form>

        <p className="text-sm text-slate-500 mb-3">
          {total} report{total !== 1 ? 's' : ''}{(severity || status || search) ? ' (filtered)' : ''}
        </p>

        {reports.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <div className="text-4xl mb-3">🎉</div>
            <p className="text-slate-600 font-medium mb-1">No bug reports found</p>
            <p className="text-slate-400 text-sm">{(severity || status || search) ? 'Try clearing your filters' : 'Be the first to submit one!'}</p>
            <Link href="/report/new" className="inline-block mt-4 px-4 py-2 bg-rose-500 text-white text-sm rounded-lg hover:bg-rose-600 transition-colors">Submit a Report</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => {
              const sev = SEVERITY_CONFIG[report.severity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.medium;
              const sta = STATUS_CONFIG[report.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open;
              return (
                <Link key={report.id} href={`/report/${report.id}`}
                  className="flex items-start sm:items-center gap-3 bg-white rounded-xl border border-slate-200 p-4 hover:border-rose-200 hover:shadow-sm transition-all group"
                >
                  <span className={`mt-0.5 sm:mt-0 w-2 h-2 rounded-full shrink-0 ${sev.dot}`}></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 group-hover:text-rose-600 transition-colors truncate">{report.title}</p>
                    <p className="text-xs text-slate-400 font-mono truncate mt-0.5">
                      {getDomain(report.websiteUrl)}{report.pageTitle ? ` · ${report.pageTitle}` : ''}
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${sev.color}`}>{sev.label}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${sta.color}`}>{sta.label}</span>
                  </div>
                  <div className="hidden lg:block text-xs text-slate-400 shrink-0 text-right">
                    <div>{report.browser} {report.browserVersion?.split('.')[0]}</div>
                    <div>{report.os} · {report.deviceType}</div>
                  </div>
                  <div className="text-xs text-slate-400 shrink-0 whitespace-nowrap">{formatRelativeDate(report.createdAt)}</div>
                </Link>
              );
            })}
          </div>
        )}

        {pages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            {page > 1 && <Link href={buildUrl({ page: String(page - 1) })} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">← Prev</Link>}
            <span className="text-sm text-slate-500">Page {page} of {pages}</span>
            {page < pages && <Link href={buildUrl({ page: String(page + 1) })} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">Next →</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
