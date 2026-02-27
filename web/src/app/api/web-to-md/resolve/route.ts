import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { canonicalizeUrl } from '@/lib/web-to-md/canonicalize';
import { resolveSnapshot } from '@/lib/web-to-md/resolve';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Hourly burst limits
const MAX_READS_PER_HOUR = 50;
const MAX_REVALIDATES_PER_HOUR = 10;

// Daily quota limits
const MAX_READS_PER_DAY = 200;
const MAX_REVALIDATES_PER_DAY = 50;

const store = new Map<string, { count: number; resetAt: number }>();

function clientId(req: NextRequest): string {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  return createHash('sha256').update(`webtomd:${ip}`).digest('hex').slice(0, 24);
}

function checkWindow(key: string, limit: number, resetAt: number): boolean {
  const now = Date.now();
  const rec = store.get(key);
  if (!rec || now > rec.resetAt) {
    store.set(key, { count: 1, resetAt });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count += 1;
  return true;
}

function checkLimit(id: string, type: 'read' | 'revalidate'): boolean {
  const now = Date.now();

  // Hourly window (burst control)
  const hourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
  const hourLimit = type === 'revalidate' ? MAX_REVALIDATES_PER_HOUR : MAX_READS_PER_HOUR;
  if (!checkWindow(`${id}:h:${hourStart}:${type}`, hourLimit, hourStart + HOUR_MS)) return false;

  // Daily window (quota control)
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const dayLimit = type === 'revalidate' ? MAX_REVALIDATES_PER_DAY : MAX_READS_PER_DAY;
  if (!checkWindow(`${id}:d:${dayStart}:${type}`, dayLimit, dayStart + DAY_MS)) return false;

  return true;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const rawUrl = searchParams.get('url')?.trim();
  const mode = searchParams.get('mode') ?? 'normal';
  const revalidate = mode === 'revalidate';

  if (!rawUrl) {
    return NextResponse.json({ ok: false, error: 'Missing url parameter' }, { status: 400 });
  }

  // Validate URL scheme before rate check
  let normalizedUrl: string;
  try {
    const canon = canonicalizeUrl(rawUrl);
    normalizedUrl = canon.normalizedUrl;
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 400 },
    );
  }

  const id = clientId(req);
  const limitType = revalidate ? 'revalidate' : 'read';
  if (!checkLimit(id, limitType)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  try {
    const snapshot = await resolveSnapshot(normalizedUrl, revalidate);
    return NextResponse.json({ ok: true, snapshot }, { status: 200 });
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
