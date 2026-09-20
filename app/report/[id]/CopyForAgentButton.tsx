'use client';

import { useState } from 'react';

type State = 'idle' | 'loading' | 'copied' | 'error';

/**
 * Fetches the agent-ready markdown for this report and puts it on the clipboard,
 * so a developer can paste the whole evidence bundle straight into a coding agent.
 */
export function CopyForAgentButton({ reportId }: { reportId: string }) {
  const [state, setState] = useState<State>('idle');

  async function copy() {
    setState('loading');
    try {
      const response = await fetch(`/api/reports/${reportId}?format=md`);
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      await navigator.clipboard.writeText(await response.text());
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch (e) {
      console.error('Failed to copy agent export', e);
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }

  const label =
    state === 'loading'
      ? 'Preparing…'
      : state === 'copied'
        ? 'Copied!'
        : state === 'error'
          ? 'Failed — retry'
          : 'Copy for agent';

  return (
    <button
      onClick={copy}
      disabled={state === 'loading'}
      title="Copy a self-contained markdown bug report for a coding agent"
      className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60"
    >
      {state === 'copied' ? (
        <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )}
      {label}
    </button>
  );
}
