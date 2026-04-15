import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { SEVERITY_CONFIG, formatRelativeDate, getDomain } from '@/lib/utils';
import { BookmarkletButton } from './BookmarkletButton';

async function getRecentReports() {
  return prisma.bugReport.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      severity: true,
      websiteUrl: true,
      browser: true,
      os: true,
      createdAt: true,
    },
  });
}

export default async function Home() {
  const recentReports = await getRecentReports();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  // Bookmarklet: collects env metadata from the target page, opens our form pre-filled
  const bookmarklet = `javascript:(function(){var m={url:location.href,title:document.title,ua:navigator.userAgent,sw:screen.width,sh:screen.height,vw:innerWidth,vh:innerHeight,dpr:window.devicePixelRatio||1,lang:navigator.language||'',tz:(Intl&&Intl.DateTimeFormat)?Intl.DateTimeFormat().resolvedOptions().timeZone:'',cook:navigator.cookieEnabled?1:0,touch:('ontouchstart'in window||navigator.maxTouchPoints>0)?1:0,ts:Date.now()};var p=Object.keys(m).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(m[k])}).join('&');window.open('${appUrl}/report/new?'+p,'_blank','width=820,height=750,scrollbars=yes');})();`;

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
            <span className="text-xl">🐛</span>
            <span>BugShot</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">Dashboard</Link>
            <Link href="/report/new" className="text-sm bg-rose-500 text-white px-3 py-1.5 rounded-lg hover:bg-rose-600 transition-colors font-medium">Report a Bug</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-rose-50 text-rose-600 text-sm font-medium px-3 py-1 rounded-full border border-rose-100 mb-6">
          <span className="w-2 h-2 bg-rose-500 rounded-full"></span>
          No account required
        </div>
        <h1 className="text-5xl font-bold text-slate-900 tracking-tight mb-4">
          Report website bugs<br />
          <span className="text-rose-500">like a developer</span>
        </h1>
        <p className="text-xl text-slate-600 max-w-2xl mx-auto mb-8 leading-relaxed">
          Found a bug on a website? BugShot automatically captures your browser, OS,
          screen size, and more — giving developers everything they need to reproduce and fix it.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
          <Link href="/report/new" className="inline-flex items-center justify-center gap-2 bg-rose-500 text-white px-6 py-3 rounded-xl text-base font-semibold hover:bg-rose-600 transition-colors shadow-sm">
            Submit a Bug Report
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
          <BookmarkletButton bookmarklet={bookmarklet} />
        </div>
        <p className="text-sm text-slate-400">
          Drag the button above to your browser&apos;s bookmarks bar for one-click bug reporting on any website
        </p>
      </section>

      {/* How it works */}
      <section className="bg-slate-50 border-y border-slate-100 py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-10">How it works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: '🔖', title: '1. Add the bookmarklet', desc: 'Drag the "Drag to Bookmarks Bar" button to your browser toolbar. One-time setup.' },
              { icon: '🖱️', title: '2. Click it on any page', desc: 'When you spot a bug, click the bookmarklet. It opens a pre-filled report with your browser and page details.' },
              { icon: '🔗', title: '3. Share the link', desc: 'Add a screenshot and description, submit, and get a shareable link to send to the dev team via email or support.' },
            ].map((item) => (
              <div key={item.title} className="text-center">
                <div className="w-12 h-12 bg-rose-100 rounded-xl flex items-center justify-center text-2xl mx-auto mb-4">{item.icon}</div>
                <h3 className="font-semibold text-slate-800 mb-2">{item.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What gets captured */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">
              Everything developers need to reproduce the bug
            </h2>
            <p className="text-slate-600 mb-6 leading-relaxed">
              Developers waste hours asking &ldquo;what browser were you using?&rdquo;
              BugShot captures it automatically — no more back-and-forth.
            </p>
            <ul className="space-y-3">
              {[
                { icon: '🌐', label: 'Exact page URL', desc: 'including query params and hash' },
                { icon: '🔍', label: 'Browser & version', desc: 'Chrome 125, Firefox 127, Safari 17...' },
                { icon: '💻', label: 'Operating system', desc: 'macOS 14.5, Windows 11, Ubuntu...' },
                { icon: '📐', label: 'Screen & viewport', desc: 'resolution, viewport size, device pixel ratio' },
                { icon: '📱', label: 'Device type', desc: 'desktop, mobile, or tablet' },
                { icon: '🌍', label: 'Language & timezone', desc: 'for locale-specific bugs' },
                { icon: '📸', label: 'Screenshot', desc: 'paste or drag & drop your own' },
              ].map((item) => (
                <li key={item.label} className="flex items-start gap-3">
                  <span className="text-lg mt-0.5">{item.icon}</span>
                  <div>
                    <span className="font-medium text-slate-800">{item.label}</span>
                    <span className="text-slate-500 text-sm ml-2">{item.desc}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Sample report card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-800 text-slate-400 text-xs font-mono px-4 py-2 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-400"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-green-400"></span>
              <span className="ml-2">Bug Report #example</span>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <span className="inline-flex items-center gap-1.5 bg-orange-100 text-orange-700 text-xs font-medium px-2 py-0.5 rounded-full border border-orange-200 mb-2">
                  <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>High
                </span>
                <h3 className="font-semibold text-slate-800 text-sm">Checkout button unresponsive on mobile</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[['Browser','Safari 17.4'],['OS','iOS 17.4'],['Device','Mobile'],['Screen','390×844 @3x'],['Viewport','390×664'],['Language','en-US'],['Timezone','America/Chicago'],['Touch','Yes']].map(([l, v]) => (
                  <div key={l} className="bg-slate-50 rounded-lg p-2">
                    <div className="text-slate-400 mb-0.5">{l}</div>
                    <div className="font-medium text-slate-700">{v}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2 font-mono truncate">
                https://shop.example.com/checkout?cart=true
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Recent reports */}
      {recentReports.length > 0 && (
        <section className="bg-slate-50 border-t border-slate-100 py-16">
          <div className="max-w-6xl mx-auto px-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900">Recent Reports</h2>
              <Link href="/dashboard" className="text-sm text-rose-500 hover:text-rose-600 font-medium">View all →</Link>
            </div>
            <div className="space-y-2">
              {recentReports.map((report) => {
                const sev = SEVERITY_CONFIG[report.severity as keyof typeof SEVERITY_CONFIG] || SEVERITY_CONFIG.medium;
                return (
                  <Link key={report.id} href={`/report/${report.id}`}
                    className="flex items-center gap-4 bg-white rounded-xl border border-slate-200 p-4 hover:border-rose-200 hover:shadow-sm transition-all group"
                  >
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${sev.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`}></span>{sev.label}
                    </span>
                    <span className="flex-1 font-medium text-slate-800 text-sm truncate group-hover:text-rose-600 transition-colors">{report.title}</span>
                    <span className="text-xs text-slate-400 hidden sm:block whitespace-nowrap">{getDomain(report.websiteUrl)}</span>
                    <span className="text-xs text-slate-400 hidden md:block whitespace-nowrap">{report.browser} / {report.os}</span>
                    <span className="text-xs text-slate-400 whitespace-nowrap">{formatRelativeDate(report.createdAt)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-100 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <span>🐛</span>
            <span className="font-semibold text-slate-700">BugShot</span>
            <span>—</span>
            <span>Report frontend bugs with full context</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <Link href="/dashboard" className="hover:text-slate-600 transition-colors">Dashboard</Link>
            <Link href="/report/new" className="hover:text-slate-600 transition-colors">Submit Report</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
