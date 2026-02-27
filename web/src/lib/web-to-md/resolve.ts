import { createHash } from 'node:crypto';
import { canonicalizeUrl } from './canonicalize';
import { runPipeline } from './pipeline';
import { F, mutateConvex, queryConvex } from '@/lib/with-md/convex-client';

const STALE_DAYS = 30;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

export interface Snapshot {
  urlHash: string;
  normalizedUrl: string;
  displayUrl: string;
  title: string;
  markdown: string;
  markdownHash: string;
  sourceEngine: string;
  fetchedAt: number;
  staleAt: number;
  version: number;
  tokenEstimate?: number;
  isStale: boolean;
}

function hashMarkdown(md: string): string {
  return createHash('sha256').update(md).digest('hex').slice(0, 16);
}

/** In-flight deduplication: urlHash → Promise<Snapshot> */
const inFlight = new Map<string, Promise<Snapshot>>();

async function generateAndStore(
  normalizedUrl: string,
  urlHash: string,
  displayUrl: string,
  trigger: string,
  currentVersion: number,
): Promise<Snapshot> {
  const result = await runPipeline(normalizedUrl);
  const now = Date.now();
  const markdownHash = hashMarkdown(result.markdown);
  const version = currentVersion + 1;

  const snapshotData = {
    urlHash,
    normalizedUrl,
    displayUrl,
    title: result.title,
    markdown: result.markdown,
    markdownHash,
    sourceEngine: result.sourceEngine,
    fetchedAt: now,
    staleAt: now + STALE_MS,
    version,
    tokenEstimate: result.tokenEstimate,
  };

  const snapshotId = await mutateConvex<string>(F.mutations.webSnapshotsUpsert, snapshotData);

  await mutateConvex(F.mutations.webSnapshotsCreateVersion, {
    snapshotId,
    urlHash,
    version,
    normalizedUrl,
    markdown: result.markdown,
    markdownHash,
    sourceEngine: result.sourceEngine,
    trigger,
    createdAt: now,
  });

  return { ...snapshotData, isStale: false };
}

export async function resolveSnapshot(
  rawUrl: string,
  revalidate = false,
): Promise<Snapshot> {
  const { normalizedUrl, urlHash, displayUrl } = canonicalizeUrl(rawUrl);

  // Check cache
  const cached = await queryConvex<Snapshot | null>(
    F.queries.webSnapshotsGetByUrlHash,
    { urlHash },
  );

  const now = Date.now();

  if (cached && !revalidate) {
    return { ...cached, isStale: now > cached.staleAt };
  }

  // Deduplicate in-flight generations for same URL
  const existing = inFlight.get(urlHash);
  if (existing) return existing;

  const trigger = revalidate ? 'revalidate' : 'initial';
  const currentVersion = cached?.version ?? 0;

  const promise = generateAndStore(normalizedUrl, urlHash, displayUrl, trigger, currentVersion)
    .finally(() => inFlight.delete(urlHash));

  inFlight.set(urlHash, promise);
  return promise;
}
