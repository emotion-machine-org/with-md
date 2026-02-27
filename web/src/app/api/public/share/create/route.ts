/**
 * Public API for AI agents to create shareable markdown files.
 * No authentication required, but rate limited.
 *
 * POST /api/public/share/create
 *
 * Body: {
 *   title: string;        // Optional, defaults to filename or "Shared Document"
 *   content: string;      // Required, markdown content
 *   filename?: string;    // Optional, e.g., "plan.md"
 *   expiresInHours?: number; // Optional, default 168 (7 days), max 720 (30 days)
 * }
 *
 * Response: {
 *   ok: true;
 *   shareId: string;
 *   viewUrl: string;      // Public read-only URL
 *   editUrl: string;      // URL with edit secret for the creator
 *   expiresAt: number;    // Unix timestamp in milliseconds
 * }
 */

import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { F, mutateConvex } from '@/lib/with-md/convex-client';
import {
  generateClientId,
  checkRateLimit,
  MAX_CREATES_PER_WINDOW,
  MAX_REQUESTS_PER_WINDOW,
} from '@/lib/with-md/rate-limit';

const MAX_UPLOAD_BYTES = 1024 * 1024; // 1MB
const DEFAULT_EXPIRY_HOURS = 7 * 24; // 7 days
const MAX_EXPIRY_HOURS = 30 * 24; // 30 days

function sanitizeFileName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'shared.md';
  const safe = trimmed.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-').slice(0, 120);
  return safe || 'shared.md';
}

function normalizeTitleFromFileName(fileName: string): string {
  const normalized = sanitizeFileName(fileName);
  const withoutExt = normalized.replace(/\.markdown$/i, '').replace(/\.md$/i, '');
  return withoutExt || 'Shared Document';
}

function markdownByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function generateShortId(): string {
  // URL-safe base64, 8 characters = 48 bits of entropy
  return randomBytes(6).toString('base64url');
}

function generateEditSecret(): string {
  // 32 bytes = 256 bits of entropy
  return randomBytes(32).toString('base64url');
}

export async function POST(request: NextRequest) {
  const clientId = generateClientId(request);
  const rateLimit = checkRateLimit(clientId, 'create');

  if (!rateLimit.allowed) {
    return NextResponse.json({
      error: 'Rate limit exceeded. Please try again later.',
      resetAt: rateLimit.resetAt,
      retryAfter: rateLimit.retryAfter,
    }, {
      status: 429,
      headers: {
        'X-RateLimit-Limit': String(MAX_CREATES_PER_WINDOW),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt / 1000)),
        'Retry-After': String(rateLimit.retryAfter ?? 3600),
      },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = body as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  // Validate content
  const content = parsed.content;
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid "content" field.' }, { status: 400 });
  }

  const normalizedContent = content.replace(/\r\n/g, '\n');
  const sizeBytes = markdownByteLength(normalizedContent);

  if (sizeBytes <= 0) {
    return NextResponse.json({ error: 'Content cannot be empty.' }, { status: 400 });
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json({
      error: `Content too large. Maximum size is ${Math.floor(MAX_UPLOAD_BYTES / 1024)}KB.`,
    }, { status: 413 });
  }

  // Get title/filename
  const filename = typeof parsed.filename === 'string' ? sanitizeFileName(parsed.filename) : null;
  const titleFromFile = filename ? normalizeTitleFromFileName(filename) : null;
  const title = typeof parsed.title === 'string' && parsed.title.trim()
    ? parsed.title.trim().slice(0, 200)
    : (titleFromFile ?? 'Shared Document');

  // Calculate expiry
  let expiresInHours = DEFAULT_EXPIRY_HOURS;
  if (typeof parsed.expiresInHours === 'number' && Number.isFinite(parsed.expiresInHours)) {
    expiresInHours = Math.min(Math.max(1, parsed.expiresInHours), MAX_EXPIRY_HOURS);
  }
  const now = Date.now();
  const expiresAt = now + expiresInHours * 60 * 60 * 1000;

  const editSecret = generateEditSecret();

  // Try to create share with collision handling
  let shareId: string | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateShortId();
    try {
      await mutateConvex<{
        ok: boolean;
        shortId: string;
        createdAt: number;
        expiresAt: number | null;
      }>(F.mutations.anonSharesCreate, {
        shortId: candidate,
        title,
        content: normalizedContent,
        editSecret,
        createdByIpHash: clientId, // Use clientId instead of IP for public API
        expiresAt,
      });
      shareId = candidate;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      if (!message.includes('Short ID already exists')) {
        throw error;
      }
      // Collision, try again
    }
  }

  if (!shareId) {
    return NextResponse.json({ error: 'Unable to create share. Please try again.' }, { status: 500 });
  }

  const origin = request.nextUrl.origin;
  const viewUrl = `${origin}/s/${encodeURIComponent(shareId)}`;
  const editUrl = `${viewUrl}?edit=${encodeURIComponent(editSecret)}`;

  return NextResponse.json({
    ok: true,
    shareId,
    viewUrl,
    editUrl,
    expiresAt,
  }, {
    headers: {
      'X-RateLimit-Limit': String(MAX_CREATES_PER_WINDOW),
      'X-RateLimit-Remaining': String(rateLimit.remaining),
      'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt / 1000)),
    },
  });
}
