import Link from 'next/link';
import { Suspense } from 'react';
import { BugReportForm } from './BugReportForm';

export const metadata = {
  title: 'Submit a Bug Report',
  description: 'File a detailed bug report with automatic browser and system information.',
};

export default function NewReportPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
            <span className="text-xl">🐛</span>
            <span>BugShot</span>
          </Link>
          <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">
            Dashboard
          </Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Submit a Bug Report</h1>
          <p className="text-slate-500 text-sm">
            Your browser, OS, and screen info are captured automatically. Just describe what went wrong.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <Suspense fallback={
            <div className="py-12 text-center text-slate-400 text-sm">Loading form…</div>
          }>
            <BugReportForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
