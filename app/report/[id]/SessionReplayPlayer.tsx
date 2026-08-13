'use client';

import { useEffect, useRef, useState } from 'react';
import 'rrweb-player/dist/style.css';

export function SessionReplayPlayer({ data, truncated }: { data: string; truncated: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        const json = await new Response(stream).text();
        const events = JSON.parse(json);
        if (cancelled || !containerRef.current || !Array.isArray(events) || events.length === 0) return;

        const { default: RrwebPlayer } = await import('rrweb-player');
        new RrwebPlayer({
          target: containerRef.current,
          props: { events, width: 720, height: 450, autoPlay: false },
        });
      } catch (e) {
        console.error('Failed to load session replay', e);
        if (!cancelled) setError('Could not load this session replay — it may be corrupted or truncated.');
      }
    }
    load();

    return () => {
      cancelled = true;
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [data]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm font-semibold text-slate-700">Session Replay</span>
        {truncated && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full font-medium">
            Truncated — recording exceeded the size limit
          </span>
        )}
      </div>
      <div className="p-4 overflow-x-auto">
        {error ? <p className="text-sm text-rose-500">{error}</p> : <div ref={containerRef} />}
      </div>
    </div>
  );
}
