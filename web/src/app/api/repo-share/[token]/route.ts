import { NextRequest, NextResponse } from 'next/server';

import { F, queryConvex } from '@/lib/with-md/convex-client';
import {
  buildRepoShareRealtimeAuthToken,
  hashRepoShareEditSecret,
  hashRepoShareShortId,
  repoShareEditUrl,
  repoShareViewUrl,
} from '@/lib/with-md/repo-share-link';

interface Params {
  params: Promise<{ token: string }>;
}

function titleFromPath(path: string): string {
  const fileName = path.split('/').pop() ?? '';
  const withoutExt = fileName.replace(/\.markdown$/i, '').replace(/\.md$/i, '');
  return withoutExt || 'Shared markdown';
}

export async function GET(request: NextRequest, { params }: Params) {
  const { token } = await params;
  const shortId = token.trim();
  if (!shortId) {
    return NextResponse.json({ error: 'Share not found.' }, { status: 404 });
  }

  const editSecret = request.nextUrl.searchParams.get('edit')?.trim() ?? '';
  const shareAccess = await queryConvex<{
    mdFileId: string;
    expiresAt: number;
    canEdit: boolean;
  } | null>(F.queries.repoSharesResolve, {
    shortIdHash: hashRepoShareShortId(shortId),
    editSecretHash: editSecret ? hashRepoShareEditSecret(editSecret) : undefined,
  });
  if (!shareAccess) {
    return NextResponse.json({ error: 'Share not found.' }, { status: 404 });
  }

  const file = await queryConvex<{
    _id: string;
    repoId: string;
    path: string;
    content: string;
    contentHash: string;
    syntaxSupportStatus?: string;
    syntaxSupportReasons?: string[];
    isDeleted?: boolean;
  } | null>(F.queries.mdFilesGet, {
    mdFileId: shareAccess.mdFileId,
  });

  if (!file || file.isDeleted) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  const origin = request.nextUrl.origin;
  const viewUrl = repoShareViewUrl(origin, shortId);
  const editUrl = shareAccess.canEdit ? repoShareEditUrl(origin, shortId, editSecret) : '';
  const realtimeAuthToken = shareAccess.canEdit
    ? buildRepoShareRealtimeAuthToken(shortId, editSecret)
    : '';

  return NextResponse.json({
    ok: true,
    canEdit: shareAccess.canEdit,
    editRejected: Boolean(editSecret) && !shareAccess.canEdit,
    share: {
      mdFileId: file._id,
      repoId: file.repoId,
      path: file.path,
      title: titleFromPath(file.path),
      content: file.content,
      contentHash: file.contentHash,
      syntaxSupportStatus: file.syntaxSupportStatus ?? 'unknown',
      syntaxSupportReasons: file.syntaxSupportReasons ?? [],
      expiresAt: shareAccess.expiresAt,
      viewUrl,
      editUrl,
      realtimeAuthToken,
    },
  });
}
