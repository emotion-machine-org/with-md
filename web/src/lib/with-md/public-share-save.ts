import { hasMeaningfulDiff } from './markdown-diff';

export interface PublicShareSnapshot {
  content: string;
  contentHash: string;
  sizeBytes?: number;
  updatedAt?: number;
}

export interface PublicShareSaveResult {
  content: string;
  version: string;
  sizeBytes?: number;
  updatedAt?: number;
  retried: boolean;
  latestBeforeRetry?: PublicShareSnapshot;
}

export type PublicShareFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ShareVersionConflictError extends Error {
  latestShare?: PublicShareSnapshot;

  constructor(message: string, latestShare?: PublicShareSnapshot) {
    super(message);
    this.name = 'ShareVersionConflictError';
    this.latestShare = latestShare;
  }
}

interface SavePublicShareContentOptions {
  shareId: string;
  editSecret: string;
  nextContent: string;
  baselineContent: string;
  currentVersion: string;
  fetchImpl?: PublicShareFetch;
}

interface ShareSaveResponseBody {
  version?: unknown;
  sizeBytes?: unknown;
  updatedAt?: unknown;
  error?: unknown;
}

function normalizeMarkdown(content: string) {
  return content.replace(/\r\n/g, '\n');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(body: unknown, fallback: string) {
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    typeof (body as { error?: unknown }).error === 'string'
  ) {
    return (body as { error: string }).error;
  }

  return fallback;
}

function snapshotFromBody(body: unknown): PublicShareSnapshot | null {
  if (!body || typeof body !== 'object' || !('share' in body)) return null;

  const share = (body as { share?: unknown }).share;
  if (!share || typeof share !== 'object') return null;

  const content = (share as { content?: unknown }).content;
  const contentHash = (share as { contentHash?: unknown }).contentHash;
  if (typeof content !== 'string' || typeof contentHash !== 'string') return null;

  const sizeBytes = (share as { sizeBytes?: unknown }).sizeBytes;
  const updatedAt = (share as { updatedAt?: unknown }).updatedAt;

  return {
    content,
    contentHash,
    sizeBytes: typeof sizeBytes === 'number' ? sizeBytes : undefined,
    updatedAt: typeof updatedAt === 'number' ? updatedAt : undefined,
  };
}

async function fetchLatestShare(
  fetchImpl: PublicShareFetch,
  shareId: string,
  editSecret: string,
) {
  const response = await fetchImpl(
    `/api/anon-share/${encodeURIComponent(shareId)}?edit=${encodeURIComponent(
      editSecret,
    )}`,
    {
      method: 'GET',
      cache: 'no-store',
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(errorMessage(body, 'Could not reload the latest share.'));
  }

  const snapshot = snapshotFromBody(body);
  if (!snapshot) {
    throw new Error('Could not read the latest share version.');
  }

  if (
    body &&
    typeof body === 'object' &&
    'canEdit' in body &&
    (body as { canEdit?: unknown }).canEdit === false
  ) {
    throw new Error('This share is no longer editable with the current link.');
  }

  return snapshot;
}

async function writeShareContent(
  fetchImpl: PublicShareFetch,
  shareId: string,
  editSecret: string,
  content: string,
  ifMatch: string,
) {
  const response = await fetchImpl(`/api/public/share/${encodeURIComponent(shareId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      editSecret,
      content,
      ifMatch,
    }),
  });
  const body = (await readJson(response)) as ShareSaveResponseBody | null;

  return { response, body };
}

function buildResult(
  content: string,
  body: ShareSaveResponseBody | null,
  fallbackVersion: string,
  retried: boolean,
  latestBeforeRetry?: PublicShareSnapshot,
): PublicShareSaveResult {
  return {
    content,
    version: typeof body?.version === 'string' ? body.version : fallbackVersion,
    sizeBytes: typeof body?.sizeBytes === 'number' ? body.sizeBytes : undefined,
    updatedAt: typeof body?.updatedAt === 'number' ? body.updatedAt : undefined,
    retried,
    latestBeforeRetry,
  };
}

export async function savePublicShareContent({
  shareId,
  editSecret,
  nextContent,
  baselineContent,
  currentVersion,
  fetchImpl = globalThis.fetch.bind(globalThis),
}: SavePublicShareContentOptions): Promise<PublicShareSaveResult> {
  const normalizedContent = normalizeMarkdown(nextContent);
  const normalizedBaseline = normalizeMarkdown(baselineContent);

  const first = await writeShareContent(
    fetchImpl,
    shareId,
    editSecret,
    normalizedContent,
    currentVersion,
  );

  if (first.response.ok) {
    return buildResult(normalizedContent, first.body, currentVersion, false);
  }

  if (first.response.status !== 409) {
    throw new Error(errorMessage(first.body, 'Could not save changes.'));
  }

  const latest = await fetchLatestShare(fetchImpl, shareId, editSecret);
  if (hasMeaningfulDiff(latest.content, normalizedBaseline)) {
    throw new ShareVersionConflictError(
      'This share changed before your edit saved. The latest version has been reloaded; apply your change again.',
      latest,
    );
  }

  const retry = await writeShareContent(
    fetchImpl,
    shareId,
    editSecret,
    normalizedContent,
    latest.contentHash,
  );

  if (retry.response.ok) {
    return buildResult(normalizedContent, retry.body, latest.contentHash, true, latest);
  }

  if (retry.response.status === 409) {
    const newest = await fetchLatestShare(fetchImpl, shareId, editSecret);
    throw new ShareVersionConflictError(
      'This share changed again before your edit saved. The latest version has been reloaded; apply your change again.',
      newest,
    );
  }

  throw new Error(errorMessage(retry.body, 'Could not save changes.'));
}
