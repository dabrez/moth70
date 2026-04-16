'use client';

import { useState } from 'react';

export function CopyLinkButton({
  reportId,
  variant = 'icon',
}: {
  reportId: string;
  variant?: 'icon' | 'full';
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const url = `${window.location.origin}/report/${reportId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (variant === 'full') {
    return (
      <button
        onClick={copy}
        className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm rounded-xl hover:bg-slate-700 transition-colors font-medium"
      >
        {copied ? (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Copied!
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy Shareable Link
          </>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={copy}
      title="Copy shareable link"
      className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition-colors"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Share
        </>
      )}
    </button>
  );
}
