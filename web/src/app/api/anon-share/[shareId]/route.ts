import { NextRequest, NextResponse } from 'next/server';

import { F, queryConvex } from '@/lib/with-md/convex-client';

interface Params {
  params: Promise<{ shareId: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { shareId } = await params;
  const normalizedShareId = shareId.trim();
  if (!normalizedShareId) {
    return NextResponse.json({ error: 'Missing share ID.' }, { status: 400 });
  }

  const share = await queryConvex<{
    shortId: string;
    title: string;
    content: string;
    contentHash: string;
    sizeBytes: number;
    syntaxSupportStatus: string;
    syntaxSupportReasons: string[];
    createdAt: number;
    updatedAt: number;
    expiresAt: number | null;
  } | null>(F.queries.anonSharesGetPublic, {
    shortId: normalizedShareId,
  });

  if (!share) {
    return NextResponse.json({ error: 'Share not found.' }, { status: 404 });
  }

  const editSecret = request.nextUrl.searchParams.get('edit')?.trim() ?? '';
  let canEdit = false;
  if (editSecret) {
    const access = await queryConvex<{ ok: boolean }>(F.queries.anonSharesCanEdit, {
      shortId: normalizedShareId,
      editSecret,
    });
    canEdit = access.ok;
  }

  return NextResponse.json({
    ok: true,
    share,
    canEdit,
  });
}
