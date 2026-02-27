/**
 * Public API for AI agents to retrieve and update shareable markdown files.
 * No authentication required, but edit operations require the editSecret from creation.
 *
 * GET /api/public/share/:shareId
 *   Returns JSON with content and metadata for the share.
 *
 * PUT /api/public/share/:shareId
 *   Body: { editSecret: string; content: string; title?: string }
 *   Updates content (requires the editSecret returned at creation time).
 *   Returns updated metadata.
 */

import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex, queryConvex } from '@/lib/with-md/convex-client';
import { generateClientId, checkRateLimit, MAX_REQUESTS_PER_WINDOW } from '@/lib/with-md/rate-limit';

interface Params {
  params: Promise<{ shareId: string }>;
}

const MAX_UPLOAD_BYTES = 1024 * 1024; // 1MB

// ─── Hocuspocus real-time sync ────────────────────────────────────────────────

function getHocuspocusHttpUrl(): string | null {
  const explicit = process.env.HOCUSPOCUS_HTTP_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const wsUrl = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
  if (!wsUrl) return null;

  return wsUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/$/, '');
}

async function tryHocuspocusEdit(
  documentName: string,
  editSecret: string,
  content: string,
): Promise<boolean> {
  const baseUrl = getHocuspocusHttpUrl();
  if (!baseUrl) return false;

  try {
    const res = await fetch(`${baseUrl}/api/agent/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentName, editSecret, content }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function toSafeFilename(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = normalized || 'shared-markdown';
  return base.endsWith('.md') || base.endsWith('.markdown') ? base : `${base}.md`;
}

function markdownByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: Params) {
  const clientId = generateClientId(request);
  const rateLimit = checkRateLimit(clientId, 'read');

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded. Please try again later.',
        resetAt: rateLimit.resetAt,
        retryAfter: rateLimit.retryAfter,
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(MAX_REQUESTS_PER_WINDOW),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt / 1000)),
          'Retry-After': String(rateLimit.retryAfter ?? 3600),
        },
      },
    );
  }

  const { shareId } = await params;
  const shortId = shareId.trim();

  if (!shortId) {
    return NextResponse.json({ error: 'Missing share ID.' }, { status: 400 });
  }

  let share: {
    shortId: string;
    title: string;
    content: string;
    contentHash: string;
    sizeBytes: number;
    createdAt: number;
    updatedAt: number;
    expiresAt: number | null;
  } | null;

  try {
    share = await queryConvex(F.queries.anonSharesGetPublic, { shortId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!share) {
    return NextResponse.json({ error: 'Share not found or expired.' }, { status: 404 });
  }

  return NextResponse.json(
    {
      ok: true,
      shareId: share.shortId,
      title: share.title,
      filename: toSafeFilename(share.title),
      content: share.content,
      version: share.contentHash,
      sizeBytes: share.sizeBytes,
      createdAt: share.createdAt,
      updatedAt: share.updatedAt,
      expiresAt: share.expiresAt,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-RateLimit-Limit': String(MAX_REQUESTS_PER_WINDOW),
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt / 1000)),
      },
    },
  );
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest, { params }: Params) {
  const clientId = generateClientId(request);
  const rateLimit = checkRateLimit(clientId, 'update');

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded. Please try again later.',
        resetAt: rateLimit.resetAt,
        retryAfter: rateLimit.retryAfter,
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(MAX_REQUESTS_PER_WINDOW),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt / 1000)),
          'Retry-After': String(rateLimit.retryAfter ?? 3600),
        },
      },
    );
  }

  const { shareId } = await params;
  const shortId = shareId.trim();

  if (!shortId) {
    return NextResponse.json({ error: 'Missing share ID.' }, { status: 400 });
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

  const editSecret = parsed.editSecret;
  if (typeof editSecret !== 'string' || !editSecret.trim()) {
    return NextResponse.json(
      { error: 'Missing or invalid "editSecret" field.' },
      { status: 400 },
    );
  }

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
    return NextResponse.json(
      { error: `Content too large. Maximum size is ${Math.floor(MAX_UPLOAD_BYTES / 1024)}KB.` },
      { status: 413 },
    );
  }

  const title =
    typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title.trim().slice(0, 200)
      : undefined;

  let result: {
    ok: boolean;
    reason?: string;
    shortId?: string;
    title?: string;
    contentHash?: string;
    sizeBytes?: number;
    updatedAt?: number;
  };

  type UpdateResult = typeof result;

  // Run Convex mutation and Hocuspocus real-time update in parallel.
  // Hocuspocus sync is best-effort — if it fails the Convex write still succeeds.
  try {
    [result] = await Promise.all([
      mutateConvex<UpdateResult>(F.mutations.anonSharesUpdateViaApi, {
        shortId,
        editSecret: editSecret.trim(),
        content: normalizedContent,
        ...(title !== undefined ? { title } : {}),
      }),
      tryHocuspocusEdit(`share:${shortId}`, editSecret.trim(), normalizedContent),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!result.ok) {
    if (result.reason === 'missing') {
      return NextResponse.json({ error: 'Share not found or expired.' }, { status: 404 });
    }
    if (result.reason === 'forbidden') {
      return NextResponse.json({ error: 'Invalid editSecret.' }, { status: 403 });
    }
    if (result.reason === 'too_large') {
      return NextResponse.json(
        { error: `Content too large. Maximum size is ${Math.floor(MAX_UPLOAD_BYTES / 1024)}KB.` },
        { status: 413 },
      );
    }
    return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
  }

  const origin = request.nextUrl.origin;
  const shareUrl = `${origin}/s/${encodeURIComponent(shortId)}`;

  return NextResponse.json(
    {
      ok: true,
      shareId: result.shortId,
      title: result.title,
      filename: toSafeFilename(result.title ?? ''),
      version: result.contentHash,
      sizeBytes: result.sizeBytes,
      updatedAt: result.updatedAt,
      shareUrl,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-RateLimit-Limit': String(MAX_REQUESTS_PER_WINDOW),
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt / 1000)),
      },
    },
  );
}
