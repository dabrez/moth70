#!/usr/bin/env node
// MCP server exposing Moth70 bug reports to coding agents.
//
// The workflow this enables: a user reports a bug in the browser, then a developer tells
// their agent "fix the open bugs on checkout". The agent lists reports, pulls the full
// evidence bundle for one, fixes it, and marks it resolved — without leaving the editor.
//
// This talks to the Moth70 HTTP API rather than the database directly, so it works
// against a deployed instance and needs no Prisma client of its own.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (process.env.MOTH70_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const API_KEY = process.env.MOTH70_API_KEY;
const REQUEST_TIMEOUT_MS = 15_000;

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['open', 'acknowledged', 'in-progress', 'resolved', 'closed'] as const;

type ReportSummary = {
  id: string;
  title: string;
  severity: string;
  status: string;
  websiteUrl: string;
  pageTitle?: string | null;
  browser: string;
  browserVersion?: string;
  os: string;
  deviceType: string;
  createdAt: string;
};

type ListResponse = {
  reports: ReportSummary[];
  total: number;
  page: number;
  pages: number;
};

/** Returned to the agent as an error result rather than thrown, so it can recover. */
class ApiError extends Error {}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers ?? {}),
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ApiError(
        `${init.method ?? 'GET'} ${path} failed with ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`
      );
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(`Request to ${BASE_URL}${path} timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }
    throw new ApiError(
      `Could not reach Moth70 at ${BASE_URL}. Is it running? (${(error as Error).message})`
    );
  } finally {
    clearTimeout(timer);
  }
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

const server = new McpServer({
  name: 'moth70',
  version: '0.1.0',
});

server.registerTool(
  'list_bugs',
  {
    title: 'List bug reports',
    description:
      'List bug reports captured by Moth70, newest first. Filter by status, severity, ' +
      'website domain, or a free-text search over title, description and URL. ' +
      'Returns summaries only — call get_bug for the full evidence bundle.',
    inputSchema: {
      status: z.enum(STATUSES).optional().describe('Only reports with this status.'),
      severity: z.enum(SEVERITIES).optional().describe('Only reports with this severity.'),
      domain: z
        .string()
        .optional()
        .describe('Only reports whose URL contains this string, e.g. "checkout" or "app.example.com".'),
      search: z.string().optional().describe('Free-text search over title, description and URL.'),
      limit: z.number().int().min(1).max(100).optional().describe('Max reports to return (default 20).'),
      page: z.number().int().min(1).optional().describe('1-based page number (default 1).'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ status, severity, domain, search, limit, page }) => {
    try {
      const query = new URLSearchParams();
      if (status) query.set('status', status);
      if (severity) query.set('severity', severity);
      if (domain) query.set('domain', domain);
      if (search) query.set('search', search);
      if (limit) query.set('limit', String(limit));
      if (page) query.set('page', String(page));

      const response = await api(`/api/reports?${query.toString()}`);
      const data = (await response.json()) as ListResponse;

      if (data.reports.length === 0) {
        return textResult('No bug reports matched those filters.');
      }

      const lines = data.reports.map((report) => {
        const env = `${report.browser}${report.browserVersion ? ` ${report.browserVersion}` : ''} / ${report.os}`;
        return [
          `- **${report.title}**`,
          `  id: \`${report.id}\``,
          `  ${report.severity} · ${report.status} · ${env} · ${report.deviceType}`,
          `  ${report.websiteUrl}`,
          `  reported ${report.createdAt}`,
        ].join('\n');
      });

      const header =
        `Showing ${data.reports.length} of ${data.total} report(s) — page ${data.page} of ${data.pages}.`;
      return textResult(`${header}\n\n${lines.join('\n\n')}`);
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  'get_bug',
  {
    title: 'Get a bug report',
    description:
      'Fetch the complete evidence bundle for one bug report as markdown: the failing URL, ' +
      'reported and observed reproduction steps (the observed click path is reconstructed from ' +
      'a session recording), JavaScript exceptions with stack traces, console output, failed ' +
      'network requests, and the full browser/OS environment. This is everything needed to ' +
      'reproduce and fix the bug.',
    inputSchema: {
      id: z.string().min(1).describe('The bug report id, as returned by list_bugs.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ id }) => {
    try {
      const response = await api(`/api/reports/${encodeURIComponent(id)}?format=md`);
      return textResult(await response.text());
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  'update_bug_status',
  {
    title: 'Update bug status',
    description:
      'Change a bug report\'s status — for example marking it "in-progress" when starting a ' +
      'fix, or "resolved" once the fix has landed.',
    inputSchema: {
      id: z.string().min(1).describe('The bug report id.'),
      status: z.enum(STATUSES).describe('The new status.'),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ id, status }) => {
    try {
      const response = await api(`/api/reports/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const report = (await response.json()) as ReportSummary;
      return textResult(`Set "${report.title}" (${report.id}) to status "${report.status}".`);
    } catch (error) {
      return errorResult(error);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout carries the MCP protocol, so all logging must go to stderr.
  console.error(`moth70 MCP server running (target: ${BASE_URL})`);
}

main().catch((error) => {
  console.error('Fatal error starting moth70 MCP server:', error);
  process.exit(1);
});
