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

  // Programmatic clients (curl, API clients, terminal agents) send Accept: */*
  // and get raw text. AI web browsing tools (ChatGPT, Gemini) send browser-like
  // Accept headers and only process text/html, so we wrap in minimal HTML.
  if (wantsPlainText(request)) {
    return new NextResponse(share.content, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(share.title)}</title></head><body><pre>${escapeHtml(share.content)}</pre></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
