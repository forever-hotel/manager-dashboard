import { NextResponse } from 'next/server';
import { backend } from '@/lib/backend';

export async function GET() {
  const result = await backend('/health/ready');
  const ready = result.status === 200;
  return NextResponse.json(
    { status: ready ? 'ok' : 'unavailable', service: 'mad-frontend' },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
