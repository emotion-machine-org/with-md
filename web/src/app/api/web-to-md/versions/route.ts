import { NextRequest, NextResponse } from 'next/server';
import { F, queryConvex } from '@/lib/with-md/convex-client';

export interface SnapshotVersion {
  version: number;
  sourceEngine: string;
  trigger: string;
  createdAt: number;
  markdownHash: string;
}

export async function GET(req: NextRequest) {
  const urlHash = req.nextUrl.searchParams.get('urlHash')?.trim();

  if (!urlHash) {
    return NextResponse.json({ ok: false, error: 'Missing urlHash parameter' }, { status: 400 });
  }

  // Basic sanity check — urlHash should be a 64-char hex string
  if (!/^[0-9a-f]{64}$/.test(urlHash)) {
    return NextResponse.json({ ok: false, error: 'Invalid urlHash' }, { status: 400 });
  }

  try {
    const versions = await queryConvex<SnapshotVersion[]>(
      F.queries.webSnapshotsListVersionsByUrlHash,
      { urlHash },
    );
    return NextResponse.json({ ok: true, versions }, { status: 200 });
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
