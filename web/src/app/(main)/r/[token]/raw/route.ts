import { NextResponse } from 'next/server';

import { F, queryConvex } from '@/lib/with-md/convex-client';
import { hashRepoShareShortId } from '@/lib/with-md/repo-share-link';

interface Params {
  params: Promise<{ token: string }>;
}

function toSafeMarkdownFileName(path: string): string {
  const fileName = path.split('/').pop()?.trim() ?? '';
  const normalized = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = normalized || 'shared-markdown.md';
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

function wantsPlainText(request: Request): boolean {
  const accept = request.headers.get('accept') || '';
  return (
    accept === '*/*' ||
    accept.includes('text/plain') ||
    accept.includes('text/markdown')
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const shortId = token.trim();
  if (!shortId) {
    return textError('Share not found.', 404);
  }

  const shareAccess = await queryConvex<{
    mdFileId: string;
  } | null>(F.queries.repoSharesResolve, {
    shortIdHash: hashRepoShareShortId(shortId),
  });
  if (!shareAccess) {
    return textError('Share not found.', 404);
  }

  const file = await queryConvex<{
    path: string;
    content: string;
    isDeleted?: boolean;
  } | null>(F.queries.mdFilesGet, {
    mdFileId: shareAccess.mdFileId,
  });
  if (!file || file.isDeleted) {
    return textError('Document not found.', 404);
  }

  const fileName = toSafeMarkdownFileName(file.path);

  if (wantsPlainText(request)) {
    return new NextResponse(file.content, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  }

  const title = file.path.split('/').pop() || 'Shared Document';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><pre>${escapeHtml(file.content)}</pre></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
