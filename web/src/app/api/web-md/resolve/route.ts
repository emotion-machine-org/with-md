import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

import { F, mutateConvex, queryConvex } from '@/lib/with-md/convex-client';
import { canonicalizeUrl } from '@/lib/with-md/web2md/canonicalize-url';
import { runWeb2MdPipeline } from '@/lib/with-md/web2md/pipeline';
import { checkWebMdRateLimit } from '@/lib/with-md/web2md/rate-limit';

type ResolveMode = 'normal' | 'revalidate';

interface WebSnapshotRecord {
  _id: string;
  urlHash: string;
  normalizedUrl: string;
  displayUrl: string;
  title: string;
  markdown: string;
  markdownHash: string;
  sourceEngine: string;
  sourceDetail?: string;
  httpStatus?: number;
  contentType?: string;
  fetchedAt: number;
  staleAt: number;
  version: number;
  tokenEstimate?: number;
  lastError?: string;
}

interface ResolveBody {
  targetUrl?: string;
  mode?: ResolveMode;
  trigger?: string;
  openRouterModel?: string;
}

interface SnapshotPayload {
  urlHash: string;
  normalizedUrl: string;
  displayUrl: string;
  title: string;
  markdown: string;
  sourceEngine: string;
  sourceDetail?: string;
  httpStatus?: number;
  contentType?: string;
  fetchedAt: number;
  staleAt: number;
  version: number;
  tokenEstimate?: number;
  isStale: boolean;
  lastError?: string;
}

const DEFAULT_CACHE_TTL_DAYS = 30;
const CACHE_TTL_DAYS = (() => {
  const raw = Number.parseInt(process.env.WEB2MD_CACHE_TTL_DAYS ?? `${DEFAULT_CACHE_TTL_DAYS}`, 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CACHE_TTL_DAYS;
  return raw;
})();

const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
const inflight = new Map<string, Promise<SnapshotPayload>>();

function toSnapshotPayload(snapshot: WebSnapshotRecord): SnapshotPayload {
  return {
    urlHash: snapshot.urlHash,
    normalizedUrl: snapshot.normalizedUrl,
    displayUrl: snapshot.displayUrl,
    title: snapshot.title,
    markdown: snapshot.markdown,
    sourceEngine: snapshot.sourceEngine,
    sourceDetail: snapshot.sourceDetail,
    httpStatus: snapshot.httpStatus,
    contentType: snapshot.contentType,
    fetchedAt: snapshot.fetchedAt,
    staleAt: snapshot.staleAt,
    version: snapshot.version,
    tokenEstimate: snapshot.tokenEstimate,
    isStale: Date.now() > snapshot.staleAt,
    lastError: snapshot.lastError,
  };
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

function parseMode(raw: unknown): ResolveMode {
  return raw === 'revalidate' ? 'revalidate' : 'normal';
}

function parseTrigger(raw: unknown, mode: ResolveMode): string {
  if (mode !== 'revalidate') return 'initial';
  if (raw === 'redo') return 'redo';
  return 'revalidate';
}

function estimateTokenCount(markdown: string): number {
  return Math.ceil(markdown.length / 4);
}

function hashMarkdown(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

async function readSnapshot(urlHash: string): Promise<WebSnapshotRecord | null> {
  return await queryConvex<WebSnapshotRecord | null>(F.queries.webSnapshotsGetByUrlHash, { urlHash });
}

async function generateSnapshot(input: {
  normalizedUrl: string;
  displayUrl: string;
  urlHash: string;
  trigger: string;
  openRouterModel?: string;
}): Promise<SnapshotPayload> {
  const pipeline = await runWeb2MdPipeline({
    targetUrl: input.normalizedUrl,
    openRouterModel: input.openRouterModel,
  });

  const now = Date.now();
  const staleAt = now + CACHE_TTL_MS;

  const metadata = JSON.stringify({
    attempts: pipeline.attempts,
    quality: pipeline.quality,
  });

  const upsertResult = await mutateConvex<{ snapshotId: string; version: number }>(
    F.mutations.webSnapshotsUpsertSnapshot,
    {
      urlHash: input.urlHash,
      normalizedUrl: input.normalizedUrl,
      displayUrl: input.displayUrl,
      title: pipeline.title,
      markdown: pipeline.markdown,
      markdownHash: hashMarkdown(pipeline.markdown),
      sourceEngine: pipeline.engine,
      sourceDetail: pipeline.sourceDetail,
      httpStatus: pipeline.httpStatus,
      contentType: pipeline.contentType,
      fetchedAt: now,
      staleAt,
      tokenEstimate: pipeline.tokenEstimate ?? estimateTokenCount(pipeline.markdown),
      trigger: input.trigger,
      metadata,
      lastError: pipeline.quality.passed ? undefined : pipeline.quality.reasons.join(','),
    },
  );

  return {
    urlHash: input.urlHash,
    normalizedUrl: input.normalizedUrl,
    displayUrl: input.displayUrl,
    title: pipeline.title,
    markdown: pipeline.markdown,
    sourceEngine: pipeline.engine,
    sourceDetail: pipeline.sourceDetail,
    httpStatus: pipeline.httpStatus,
    contentType: pipeline.contentType,
    fetchedAt: now,
    staleAt,
    version: upsertResult.version,
    tokenEstimate: pipeline.tokenEstimate ?? estimateTokenCount(pipeline.markdown),
    isStale: false,
    lastError: pipeline.quality.passed ? undefined : pipeline.quality.reasons.join(','),
  };
}

async function getOrCreateSnapshot(input: {
  normalizedUrl: string;
  displayUrl: string;
  urlHash: string;
  trigger: string;
  openRouterModel?: string;
}): Promise<SnapshotPayload> {
  const key = input.urlHash;
  const existing = inflight.get(key);
  if (existing) {
    return await existing;
  }

  const promise = generateSnapshot(input)
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return await promise;
}

export async function POST(request: NextRequest) {
  let body: ResolveBody;
  try {
    body = await request.json() as ResolveBody;
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  const targetUrl = typeof body.targetUrl === 'string' ? body.targetUrl.trim() : '';
  if (!targetUrl) {
    return jsonError('Missing targetUrl.', 400);
  }

  const mode = parseMode(body.mode);
  const rateLimit = checkWebMdRateLimit(request, mode);
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
          'Cache-Control': 'no-store',
          'Retry-After': String(rateLimit.retryAfter ?? 60),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt / 1000)),
        },
      },
    );
  }

  let canonical: { normalizedUrl: string; displayUrl: string; urlHash: string };
  try {
    canonical = canonicalizeUrl(targetUrl);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Invalid URL.', 400);
  }

  const trigger = parseTrigger(body.trigger, mode);
  const existing = await readSnapshot(canonical.urlHash);

  if (mode === 'normal' && existing) {
    return NextResponse.json(
      {
        snapshot: toSnapshotPayload(existing),
        fromCache: true,
        mode,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt / 1000)),
        },
      },
    );
  }

  try {
    const snapshot = await getOrCreateSnapshot({
      normalizedUrl: canonical.normalizedUrl,
      displayUrl: canonical.displayUrl,
      urlHash: canonical.urlHash,
      trigger,
      openRouterModel: typeof body.openRouterModel === 'string' ? body.openRouterModel : undefined,
    });

    return NextResponse.json(
      {
        snapshot,
        fromCache: false,
        mode,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt / 1000)),
        },
      },
    );
  } catch (error) {
    if (existing) {
      return NextResponse.json(
        {
          snapshot: toSnapshotPayload(existing),
          fromCache: true,
          fallbackToCache: true,
          warning: error instanceof Error ? error.message : 'Revalidation failed; returned cached snapshot.',
          mode,
        },
        {
          headers: {
            'Cache-Control': 'no-store',
            'X-RateLimit-Remaining': String(rateLimit.remaining),
            'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt / 1000)),
          },
        },
      );
    }

    return jsonError(error instanceof Error ? error.message : 'Failed to convert URL.', 502);
  }
}
