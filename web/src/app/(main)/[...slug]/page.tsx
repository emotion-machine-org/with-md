import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { parseWebTarget, canonicalizeUrl } from '@/lib/web-to-md/canonicalize';
import { resolveSnapshot, type Snapshot } from '@/lib/web-to-md/resolve';
import WebSnapshotShell from '@/components/with-md/web-snapshot-shell';

interface Props {
  params: Promise<{ slug: string[] }>;
}

function isWebUrl(slug: string[]): boolean {
  if (slug.length < 2) return false;
  // Next.js URL-encodes ':' to '%3A' in path segments
  const first = decodeURIComponent(slug[0]);
  return first === 'https:' || first === 'http:';
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isWebUrl(slug)) return { title: 'with.md' };

  const { rawUrl } = parseWebTarget(slug);
  let displayUrl: string;
  try {
    displayUrl = canonicalizeUrl(rawUrl).displayUrl;
  } catch {
    displayUrl = rawUrl;
  }

  return {
    title: `${displayUrl} — with.md`,
    robots: { index: false, follow: false },
  };
}

export default async function WebSnapshotPage({ params }: Props) {
  const { slug } = await params;

  if (!isWebUrl(slug)) {
    notFound();
  }

  const { rawUrl, revalidate } = parseWebTarget(slug);

  let normalizedUrl: string;
  try {
    normalizedUrl = canonicalizeUrl(rawUrl).normalizedUrl;
  } catch {
    notFound();
  }

  let snapshot: Snapshot;
  try {
    snapshot = await resolveSnapshot(normalizedUrl, revalidate);
  } catch {
    notFound();
  }

  return <WebSnapshotShell snapshot={snapshot} />;
}
