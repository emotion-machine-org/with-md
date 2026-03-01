import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex, queryConvex } from '@/lib/with-md/convex-client';
import {
  MAX_PUBLIC_SHARE_BYTES,
  markdownByteLength,
  normalizeMarkdownInput,
  readExpectedVersion,
  toSafeMarkdownFilename,
  tryHocuspocusEdit,
} from '@/lib/with-md/public-share-api';
import {
  buildRepoShareRealtimeAuthToken,
  hashRepoShareEditSecret,
  hashRepoShareShortId,
  repoShareViewUrl,
} from '@/lib/with-md/repo-share-link';
import { checkRateLimit, generateClientId, MAX_REQUESTS_PER_WINDOW } from '@/lib/with-md/rate-limit';

interface Params {
  params: Promise<{ token: string }>;
}

function titleFromPath(path: string): string {
  const fileName = path.split('/').pop() ?? '';
  const withoutExt = fileName.replace(/\.markdown$/i, '').replace(/\.md$/i, '');
  return withoutExt || 'Shared markdown';
}

function rateLimitedResponse(rateLimit: { resetAt: number; retryAfter?: number }): NextResponse {
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

export async function GET(request: NextRequest, { params }: Params) {
  const clientId = generateClientId(request);
  const rateLimit = checkRateLimit(clientId, 'read');
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit);
  }

  const { token } = await params;
  const shortId = token.trim();
  if (!shortId) {
    return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
  }

  const shareAccess = await queryConvex<{
    mdFileId: string;
    expiresAt: number;
  } | null>(F.queries.repoSharesResolve, {
    shortIdHash: hashRepoShareShortId(shortId),
  });
  if (!shareAccess) {
    return NextResponse.json({ error: 'Share not found or expired.' }, { status: 404 });
  }

  const file = await queryConvex<{
    _id: string;
    path: string;
    content: string;
    contentHash: string;
    isDeleted?: boolean;
    lastSyncedAt?: number;
  } | null>(F.queries.mdFilesGet, {
    mdFileId: shareAccess.mdFileId,
  });
  if (!file || file.isDeleted) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  const origin = request.nextUrl.origin;
  const viewUrl = repoShareViewUrl(origin, shortId);

  return NextResponse.json(
    {
      ok: true,
      token: shortId,
      shareId: shortId,
      title: titleFromPath(file.path),
      filename: toSafeMarkdownFilename(file.path.split('/').pop() ?? 'shared-markdown.md'),
      path: file.path,
      content: file.content,
      version: file.contentHash,
      sizeBytes: markdownByteLength(file.content),
      updatedAt: file.lastSyncedAt ?? null,
      expiresAt: shareAccess.expiresAt,
      viewUrl,
      rawUrl: `${viewUrl}/raw`,
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

export async function PUT(request: NextRequest, { params }: Params) {
  const clientId = generateClientId(request);
  const rateLimit = checkRateLimit(clientId, 'update');
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit);
  }

  const { token } = await params;
  const shortId = token.trim();
  if (!shortId) {
    return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
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

  const editSecret = typeof parsed.editSecret === 'string' ? parsed.editSecret.trim() : '';
  if (!editSecret) {
    return NextResponse.json({ error: 'Missing or invalid "editSecret" field.' }, { status: 400 });
  }

  const content = parsed.content;
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid "content" field.' }, { status: 400 });
  }

  const normalizedContent = normalizeMarkdownInput(content);
  const sizeBytes = markdownByteLength(normalizedContent);
  const expectedContentHash = readExpectedVersion(parsed, request);
  if (sizeBytes <= 0) {
    return NextResponse.json({ error: 'Content cannot be empty.' }, { status: 400 });
  }
  if (sizeBytes > MAX_PUBLIC_SHARE_BYTES) {
    return NextResponse.json(
      { error: `Content too large. Maximum size is ${Math.floor(MAX_PUBLIC_SHARE_BYTES / 1024)}KB.` },
      { status: 413 },
    );
  }

  const result = await mutateConvex<{
    ok: boolean;
    reason?: string;
    mdFileId?: string;
    path?: string;
    contentHash?: string;
    updatedAt?: number;
    currentContentHash?: string;
  }>(F.mutations.repoSharesUpdateViaApi, {
    shortIdHash: hashRepoShareShortId(shortId),
    editSecretHash: hashRepoShareEditSecret(editSecret),
    content: normalizedContent,
    expectedContentHash,
  });

  if (!result.ok) {
    if (result.reason === 'missing') {
      return NextResponse.json({ error: 'Share not found or expired.' }, { status: 404 });
    }
    if (result.reason === 'forbidden') {
      return NextResponse.json({ error: 'Invalid editSecret.' }, { status: 403 });
    }
    if (result.reason === 'version_mismatch') {
      return NextResponse.json(
        {
          error: 'Version mismatch.',
          expectedVersion: expectedContentHash,
          currentVersion: result.currentContentHash,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
  }

  if (result.mdFileId) {
    const realtimeToken = buildRepoShareRealtimeAuthToken(shortId, editSecret);
    void tryHocuspocusEdit(result.mdFileId, realtimeToken, normalizedContent);
  }

  const origin = request.nextUrl.origin;
  const viewUrl = repoShareViewUrl(origin, shortId);

  return NextResponse.json(
    {
      ok: true,
      token: shortId,
      shareId: shortId,
      path: result.path,
      title: titleFromPath(result.path ?? ''),
      filename: toSafeMarkdownFilename((result.path ?? '').split('/').pop() ?? ''),
      version: result.contentHash,
      updatedAt: result.updatedAt,
      sizeBytes,
      shareUrl: viewUrl,
      rawUrl: `${viewUrl}/raw`,
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
