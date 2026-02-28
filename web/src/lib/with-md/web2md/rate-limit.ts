import type { NextRequest } from 'next/server';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_NORMAL_LIMIT = 60;
const DEFAULT_REVALIDATE_LIMIT = 18;

function parseLimit(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

const NORMAL_LIMIT = parseLimit(process.env.WITHMD_WEB2MD_RATE_LIMIT_NORMAL, DEFAULT_NORMAL_LIMIT);
const REVALIDATE_LIMIT = parseLimit(process.env.WITHMD_WEB2MD_RATE_LIMIT_REVALIDATE, DEFAULT_REVALIDATE_LIMIT);

const buckets = new Map<string, RateLimitBucket>();

function cleanupExpiredBuckets(now: number): void {
  for (const [key, value] of buckets.entries()) {
    if (now >= value.resetAt) {
      buckets.delete(key);
    }
  }
}

function getClientId(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = request.headers.get('x-real-ip')?.trim();
  const userAgent = (request.headers.get('user-agent') ?? '').slice(0, 80);
  const ip = forwarded || realIp || 'unknown';
  return `${ip}:${userAgent}`;
}

export function checkWebMdRateLimit(
  request: NextRequest,
  mode: 'normal' | 'revalidate',
): { allowed: boolean; remaining: number; resetAt: number; retryAfter?: number } {
  const now = Date.now();
  cleanupExpiredBuckets(now);
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const key = `${getClientId(request)}:${mode}:${windowStart}`;
  const limit = mode === 'revalidate' ? REVALIDATE_LIMIT : NORMAL_LIMIT;

  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, {
      count: 1,
      resetAt: windowStart + WINDOW_MS,
    });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      resetAt: windowStart + WINDOW_MS,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfter: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}
