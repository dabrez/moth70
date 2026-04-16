'use client';

import { useState } from 'react';
import { STATUS_CONFIG } from '@/lib/utils';

const statuses = Object.keys(STATUS_CONFIG) as (keyof typeof STATUS_CONFIG)[];

export function StatusUpdater({
  reportId,
  currentStatus,
}: {
  reportId: string;
  currentStatus: string;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  async function update(newStatus: string) {
    if (newStatus === status) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setStatus(newStatus);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {statuses.map((s) => {
          const cfg = STATUS_CONFIG[s];
          return (
            <button
              key={s}
              onClick={() => update(s)}
              disabled={loading}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all disabled:opacity-50 ${
                status === s
                  ? cfg.color + ' ring-2 ring-offset-1 ring-current'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {cfg.label}
            </button>
          );
        })}
      </div>
      {saved && (
        <p className="text-xs text-emerald-600 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Status updated
        </p>
      )}
    </div>
  );
}
