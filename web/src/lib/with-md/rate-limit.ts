/**
 * Shared in-memory rate limiting for the public share API.
 * All route handlers that import this module share the same store within a process.
 */

import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 100;
export const MAX_CREATES_PER_WINDOW = 50;

export const MAX_REQUESTS_PER_WINDOW = (() => {
  const raw = process.env.WITHMD_PUBLIC_API_RATE_LIMIT;
  if (!raw) return DEFAULT_MAX_REQUESTS_PER_WINDOW;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_REQUESTS_PER_WINDOW;
})();

// Shared store — all route handlers in the same process see the same Map.
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function generateClientId(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const userAgent = request.headers.get('user-agent') ?? '';
  const ip = (forwarded?.split(',')[0]?.trim() ?? realIp ?? 'unknown').trim();
  const raw = `${ip}:${userAgent.slice(0, 100)}`;
  const salt = process.env.WITHMD_PUBLIC_API_SALT ?? 'withmd-public-api-v1';
  return createHash('sha256').update(`${salt}:${raw}`).digest('hex').slice(0, 32);
}

export type RateLimitType = 'create' | 'read' | 'update';

export function checkRateLimit(
  clientId: string,
  type: RateLimitType,
): { allowed: boolean; remaining: number; resetAt: number; retryAfter?: number } {
  const now = Date.now();
  const windowStart = Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS;
  const key = `${clientId}:${windowStart}:${type}`;
  const limit =
    type === 'create'
      ? Math.min(MAX_CREATES_PER_WINDOW, MAX_REQUESTS_PER_WINDOW)
      : MAX_REQUESTS_PER_WINDOW;

  const record = rateLimitStore.get(key);

  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: windowStart + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: limit - 1, resetAt: windowStart + RATE_LIMIT_WINDOW_MS };
  }

  if (record.count >= limit) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, resetAt: record.resetAt, retryAfter };
  }

  record.count += 1;
  return { allowed: true, remaining: limit - record.count, resetAt: record.resetAt };
}
