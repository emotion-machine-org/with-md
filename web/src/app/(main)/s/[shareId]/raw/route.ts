import { NextResponse } from 'next/server';

import { F, queryConvex } from '@/lib/with-md/convex-client';

interface Params {
  params: Promise<{ shareId: string }>;
}

function toSafeMarkdownFileName(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = normalized || 'shared-markdown';
  if (base.endsWith('.md') || base.endsWith('.markdown')) return base;
  return `${base}.md`;
}

function textError(message: string, status: number): NextResponse {
  return new NextResponse(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}

export async function GET(_request: Request, { params }: Params) {
  const { shareId } = await params;
  const shortId = shareId.trim();
  if (!shortId) {
    return textError('Missing share ID.', 400);
  }

  const share = await queryConvex<{
    title: string;
    content: string;
  } | null>(F.queries.anonSharesGetPublic, {
    shortId,
  });

  if (!share) {
    return textError('Share not found.', 404);
  }

  const fileName = toSafeMarkdownFileName(share.title);
  return new NextResponse(share.content, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}
