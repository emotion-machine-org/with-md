import { NextRequest, NextResponse } from 'next/server';
import { canonicalizeUrl } from '@/lib/web-to-md/canonicalize';
import { resolveSnapshot } from '@/lib/web-to-md/resolve';

function toSafeFilename(displayUrl: string): string {
  const base = displayUrl
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return (base || 'page') + '.md';
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url')?.trim();

  if (!rawUrl) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  let normalizedUrl: string;
  let displayUrl: string;
  try {
    const canon = canonicalizeUrl(rawUrl);
    normalizedUrl = canon.normalizedUrl;
    displayUrl = canon.displayUrl;
  } catch (e: unknown) {
    return new NextResponse((e as Error).message, { status: 400 });
  }

  try {
    const snapshot = await resolveSnapshot(normalizedUrl);
    const filename = toSafeFilename(displayUrl);
    return new NextResponse(snapshot.markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e: unknown) {
    return new NextResponse((e as Error).message, { status: 502 });
  }
}
