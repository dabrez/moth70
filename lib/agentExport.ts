// Renders a BugReport as a single self-contained markdown document for a coding agent.
//
// The audience is an agent that has the codebase open but has never seen the app running.
// It needs the failing URL, the action sequence, the errors with stack traces, and the
// environment — in one paste, with no links to follow and no binary blobs to decode.

import type { BugReport } from '@prisma/client';
import { buildClickPath, decodeSessionReplay, formatOffset } from './replay';

type ConsoleEntry = { type?: string; message?: string; timestamp?: number };
type ExceptionEntry = {
  type?: string;
  message?: string;
  stack?: string | null;
  source?: string | null;
  timestamp?: number;
};
type NetworkEntry = {
  url?: string;
  method?: string;
  statusCode?: number | null;
  error?: string;
  timestamp?: number;
};

/** Log blobs are stored as JSON strings; a malformed one must not break the export. */
function parseJsonArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function fence(body: string, lang = ''): string {
  // A stack trace containing ``` would otherwise break out of the code block.
  const longestRun = [...body.matchAll(/`+/g)].reduce((max, m) => Math.max(max, m[0].length), 0);
  const delimiter = '`'.repeat(Math.max(3, longestRun + 1));
  return `${delimiter}${lang}\n${body}\n${delimiter}`;
}

function relativeTime(timestamp: number | undefined, anchor: Date | null): string {
  if (!timestamp || !anchor) return '';
  const delta = timestamp - anchor.getTime();
  const seconds = (delta / 1000).toFixed(1);
  return delta >= 0 ? ` (+${seconds}s)` : ` (${seconds}s)`;
}

export async function renderAgentMarkdown(
  report: BugReport,
  options: { appUrl?: string } = {}
): Promise<string> {
  const lines: string[] = [];
  const anchor = report.bugTimestamp ?? report.createdAt ?? null;

  lines.push(`# Bug report: ${report.title}`);
  lines.push('');
  lines.push(
    `> ${report.severity.toUpperCase()} severity · status \`${report.status}\` · reported ${report.createdAt.toISOString()}`
  );
  if (options.appUrl) {
    lines.push('>');
    lines.push(`> Source: ${options.appUrl}/report/${report.id}`);
  }
  lines.push('');

  // --- Where -------------------------------------------------------------
  lines.push('## Where');
  lines.push('');
  lines.push(`- **URL:** ${report.websiteUrl}`);
  if (report.pageTitle) lines.push(`- **Page title:** ${report.pageTitle}`);
  if (report.buildVersion) lines.push(`- **Build:** \`${report.buildVersion}\``);
  if (report.referrer) lines.push(`- **Referrer:** ${report.referrer}`);
  lines.push('');

  // --- What happened -----------------------------------------------------
  lines.push('## What happened');
  lines.push('');
  lines.push(report.description.trim());
  lines.push('');

  if (report.expected || report.actual) {
    if (report.expected) {
      lines.push(`**Expected:** ${report.expected.trim()}`);
      lines.push('');
    }
    if (report.actual) {
      lines.push(`**Actual:** ${report.actual.trim()}`);
      lines.push('');
    }
  }

  if (report.steps) {
    lines.push('## Steps to reproduce (reported)');
    lines.push('');
    lines.push(report.steps.trim());
    lines.push('');
  }

  // --- Click path --------------------------------------------------------
  // The highest-value section: the actual action sequence, derived from the
  // rrweb recording rather than from what the reporter remembered to write down.
  if (report.sessionReplay) {
    const events = await decodeSessionReplay(report.sessionReplay);
    if (events) {
      const { steps, durationMs, eventCount, degraded } = buildClickPath(events);
      lines.push('## Observed click path');
      lines.push('');
      lines.push(
        `_Reconstructed from a ${(durationMs / 1000).toFixed(1)}s session recording (${eventCount} events)._`
      );
      if (report.sessionReplayTruncated) {
        lines.push('');
        lines.push(
          '> ⚠️ The recording exceeded the size cap and was truncated, so the earliest actions may be missing.'
        );
      }
      if (degraded) {
        lines.push('');
        lines.push(
          '> ⚠️ No DOM snapshot was present in the retained recording window, so element targets could not be resolved.'
        );
      }
      lines.push('');
      if (steps.length === 0) {
        lines.push('_No discrete interactions were captured in the retained window._');
      } else {
        for (const step of steps) {
          const target = step.target ? ` \`${step.target}\`` : '';
          const detail = step.detail ? ` — ${step.detail}` : '';
          lines.push(`- \`${formatOffset(step.offsetMs)}\` ${step.action}${target}${detail}`);
        }
      }
      lines.push('');
    }
  }

  // --- Errors ------------------------------------------------------------
  const exceptions = parseJsonArray<ExceptionEntry>(report.jsExceptions);
  if (exceptions.length > 0) {
    lines.push('## JavaScript exceptions');
    lines.push('');
    for (const ex of exceptions) {
      const when = relativeTime(ex.timestamp, anchor);
      lines.push(`**${ex.type ?? 'error'}**${when}: ${ex.message ?? '(no message)'}`);
      if (ex.source) lines.push(`Source: \`${ex.source}\``);
      if (ex.stack) {
        lines.push('');
        lines.push(fence(ex.stack));
      }
      lines.push('');
    }
  }

  const consoleEntries = parseJsonArray<ConsoleEntry>(report.consoleErrors);
  if (consoleEntries.length > 0) {
    lines.push('## Console output');
    lines.push('');
    const body = consoleEntries
      .map((entry) => {
        const when = relativeTime(entry.timestamp, anchor);
        return `[${(entry.type ?? 'log').toUpperCase()}]${when} ${entry.message ?? ''}`.trim();
      })
      .join('\n');
    lines.push(fence(body));
    lines.push('');
  }

  const networkFailures = parseJsonArray<NetworkEntry>(report.networkFailures);
  if (networkFailures.length > 0) {
    lines.push('## Failed network requests');
    lines.push('');
    lines.push('| Status | Method | URL |');
    lines.push('| --- | --- | --- |');
    for (const failure of networkFailures) {
      const status = failure.statusCode ?? failure.error ?? 'failed';
      // Pipes inside a URL would split the table cell.
      const url = (failure.url ?? '').replace(/\|/g, '%7C');
      lines.push(`| ${status} | ${failure.method ?? '?'} | ${url} |`);
    }
    lines.push('');
  }

  // --- Environment -------------------------------------------------------
  lines.push('## Environment');
  lines.push('');
  lines.push(
    `- **Browser:** ${report.browser}${report.browserVersion ? ` ${report.browserVersion}` : ''}`
  );
  lines.push(`- **OS:** ${report.os}${report.osVersion ? ` ${report.osVersion}` : ''}`);
  lines.push(`- **Device:** ${report.deviceType}`);
  lines.push(
    `- **Viewport:** ${report.viewportWidth}×${report.viewportHeight} (screen ${report.screenWidth}×${report.screenHeight}, DPR ${report.devicePixelRatio})`
  );
  if (report.language) lines.push(`- **Language:** ${report.language}`);
  if (report.timezone) lines.push(`- **Timezone:** ${report.timezone}`);
  if (report.connectionType) {
    const downlink = report.connectionDownlink ? ` (${report.connectionDownlink} Mbps)` : '';
    lines.push(`- **Connection:** ${report.connectionType}${downlink}`);
  }
  if (report.hardwareConcurrency) lines.push(`- **CPU cores:** ${report.hardwareConcurrency}`);
  if (report.deviceMemory) lines.push(`- **Device memory:** ${report.deviceMemory} GB`);
  lines.push(`- **Touch:** ${report.touchEnabled ? 'yes' : 'no'}`);
  lines.push(`- **Online:** ${report.online ? 'yes' : 'no'}`);
  lines.push(`- **User agent:** \`${report.userAgent}\``);
  lines.push('');

  // Screenshots are stored as data URIs and can run to megabytes; inlining one would
  // blow up an agent's context for no benefit, so we only note that it exists.
  if (report.screenshot) {
    lines.push(
      options.appUrl
        ? `_A screenshot is attached to this report; view it at ${options.appUrl}/report/${report.id}._`
        : '_A screenshot is attached to this report._'
    );
    lines.push('');
  }

  return lines.join('\n');
}
