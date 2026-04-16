import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const report = await prisma.bugReport.findUnique({ where: { id } });
  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404, headers: CORS_HEADERS });
  }
  return NextResponse.json(report, { headers: CORS_HEADERS });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS_HEADERS });
  }

  const validStatuses = ['open', 'acknowledged', 'in-progress', 'resolved', 'closed'];
  const { status } = body;

  if (status && !validStatuses.includes(String(status))) {
    return NextResponse.json(
      { error: `status must be one of: ${validStatuses.join(', ')}` },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const report = await prisma.bugReport.update({
      where: { id },
      data: { ...(status ? { status: String(status) } : {}) },
    });
    return NextResponse.json(report, { headers: CORS_HEADERS });
  } catch {
    return NextResponse.json({ error: 'Report not found' }, { status: 404, headers: CORS_HEADERS });
  }
}
