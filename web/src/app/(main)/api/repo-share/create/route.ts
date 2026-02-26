import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex, queryConvex } from '@/lib/with-md/convex-client';
import { getSessionOrNull } from '@/lib/with-md/session';
import {
  generateRepoShareEditSecret,
  generateRepoShareShortId,
  hashRepoShareEditSecret,
  hashRepoShareShortId,
  repoShareEditUrl,
  repoShareViewUrl,
} from '@/lib/with-md/repo-share-link';

const DEFAULT_REPO_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const session = await getSessionOrNull();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { mdFileId?: string } | null;
  const mdFileId = body?.mdFileId?.trim() ?? '';
  if (!mdFileId) {
    return NextResponse.json({ error: 'Missing mdFileId.' }, { status: 400 });
  }

  const file = await queryConvex<{
    _id: string;
    repoId: string;
    isDeleted?: boolean;
  } | null>(F.queries.mdFilesGet, {
    mdFileId,
  });

  if (!file || file.isDeleted) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  const repo = await queryConvex<{
    _id: string;
    installationId: string;
  } | null>(F.queries.reposGet, {
    repoId: file.repoId,
  });
  if (!repo) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  const installation = await queryConvex<{
    _id: string;
    connectedBy?: string;
  } | null>(F.queries.installationsGet, {
    installationId: repo.installationId,
  });
  if (!installation || installation.connectedBy !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const createdByUserId = session.userId;
  const expiresAt = Date.now() + DEFAULT_REPO_SHARE_TTL_MS;
  let shortId: string | null = null;
  let editSecret: string | null = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const nextShortId = generateRepoShareShortId();
    const nextEditSecret = generateRepoShareEditSecret();
    try {
      await mutateConvex<{ ok: boolean }>(F.mutations.repoSharesCreate, {
        shortIdHash: hashRepoShareShortId(nextShortId),
        editSecretHash: hashRepoShareEditSecret(nextEditSecret),
        mdFileId,
        createdByUserId,
        expiresAt,
      });
      shortId = nextShortId;
      editSecret = nextEditSecret;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      if (!message.includes('Short ID already exists')) {
        console.error('repo-share:create failed', error);
        return NextResponse.json({ error: 'Could not create share link.' }, { status: 500 });
      }
    }
  }

  if (!shortId || !editSecret) {
    return NextResponse.json({ error: 'Could not allocate share ID.' }, { status: 500 });
  }

  const origin = request.nextUrl.origin;
  const viewUrl = repoShareViewUrl(origin, shortId);
  const editUrl = repoShareEditUrl(origin, shortId, editSecret);

  return NextResponse.json({
    ok: true,
    viewUrl,
    editUrl,
    expiresAt,
  });
}
