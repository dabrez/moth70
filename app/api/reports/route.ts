import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
  const severity = searchParams.get('severity');
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const domain = searchParams.get('domain');

  const where = {
    ...(severity ? { severity } : {}),
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search } },
            { description: { contains: search } },
            { websiteUrl: { contains: search } },
          ],
        }
      : {}),
    ...(domain ? { websiteUrl: { contains: domain } } : {}),
  };

  const [reports, total] = await Promise.all([
    prisma.bugReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        createdAt: true,
        title: true,
        severity: true,
        status: true,
        websiteUrl: true,
        pageTitle: true,
        browser: true,
        browserVersion: true,
        os: true,
        deviceType: true,
        reporterName: true,
        screenshot: false,
      },
    }),
    prisma.bugReport.count({ where }),
  ]);

  return NextResponse.json(
    { reports, total, page, pages: Math.ceil(total / limit) },
    { headers: CORS_HEADERS }
  );
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const {
    title, description, steps, expected, actual, severity,
    websiteUrl, pageTitle, screenshot,
    browser, browserVersion, os, osVersion, deviceType,
    screenWidth, screenHeight, viewportWidth, viewportHeight,
    devicePixelRatio, colorDepth, userAgent, language, timezone,
    cookieEnabled, touchEnabled, online, bugTimestamp,
    reporterName, reporterEmail,
  } = body;

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return NextResponse.json({ error: 'title is required' }, { status: 400, headers: CORS_HEADERS });
  }
  if (!description || typeof description !== 'string') {
    return NextResponse.json({ error: 'description is required' }, { status: 400, headers: CORS_HEADERS });
  }
  if (!websiteUrl || typeof websiteUrl !== 'string') {
    return NextResponse.json({ error: 'websiteUrl is required' }, { status: 400, headers: CORS_HEADERS });
  }

  const report = await prisma.bugReport.create({
    data: {
      title: String(title).trim().slice(0, 200),
      description: String(description).trim().slice(0, 10000),
      steps: steps ? String(steps).trim().slice(0, 5000) : null,
      expected: expected ? String(expected).trim().slice(0, 2000) : null,
      actual: actual ? String(actual).trim().slice(0, 2000) : null,
      severity: ['low', 'medium', 'high', 'critical'].includes(String(severity)) ? String(severity) : 'medium',
      websiteUrl: String(websiteUrl).slice(0, 2000),
      pageTitle: pageTitle ? String(pageTitle).slice(0, 500) : null,
      screenshot: screenshot ? String(screenshot) : null,
      browser: String(browser || 'Unknown'),
      browserVersion: String(browserVersion || ''),
      os: String(os || 'Unknown'),
      osVersion: osVersion ? String(osVersion) : null,
      deviceType: ['desktop', 'mobile', 'tablet'].includes(String(deviceType)) ? String(deviceType) : 'desktop',
      screenWidth: parseInt(String(screenWidth || 0)) || 0,
      screenHeight: parseInt(String(screenHeight || 0)) || 0,
      viewportWidth: parseInt(String(viewportWidth || 0)) || 0,
      viewportHeight: parseInt(String(viewportHeight || 0)) || 0,
      devicePixelRatio: parseFloat(String(devicePixelRatio || 1)) || 1,
      colorDepth: colorDepth ? parseInt(String(colorDepth)) : null,
      userAgent: String(userAgent || '').slice(0, 1000),
      language: language ? String(language) : null,
      timezone: timezone ? String(timezone) : null,
      cookieEnabled: Boolean(cookieEnabled ?? true),
      touchEnabled: Boolean(touchEnabled ?? false),
      online: Boolean(online ?? true),
      bugTimestamp: bugTimestamp ? new Date(String(bugTimestamp)) : null,
      reporterName: reporterName ? String(reporterName).slice(0, 200) : null,
      reporterEmail: reporterEmail ? String(reporterEmail).slice(0, 200) : null,
    },
  });

  return NextResponse.json(report, { status: 201, headers: CORS_HEADERS });
}
