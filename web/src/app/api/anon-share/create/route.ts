import { randomBytes, createHash } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex } from '@/lib/with-md/convex-client';

const MAX_UPLOAD_BYTES = 1024 * 1024;
const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CREATES_PER_DAY_PER_IP = 20;

function isMarkdownFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function sanitizeFileName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'shared.md';
  const safe = trimmed.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-').slice(0, 120);
  return safe || 'shared.md';
}

function normalizeTitleFromFileName(fileName: string): string {
  const normalized = sanitizeFileName(fileName);
  const withoutExt = normalized.replace(/\.markdown$/i, '').replace(/\.md$/i, '');
  return withoutExt || 'Shared Markdown';
}

function markdownByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function readClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

function hashIp(value: string): string {
  const salt = process.env.ANON_SHARE_IP_HASH_SALT ?? 'withmd-anon-share-ip';
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32);
}

function generateShortId(): string {
  return randomBytes(5).toString('base64url');
}

function generateEditSecret(): string {
  return randomBytes(24).toString('base64url');
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { fileName?: string; content?: string }
    | null;
  const fileName = sanitizeFileName(body?.fileName ?? 'shared.md');
  if (!isMarkdownFileName(fileName)) {
    return NextResponse.json({ error: 'Only .md and .markdown files are supported.' }, { status: 400 });
  }

  if (typeof body?.content !== 'string') {
    return NextResponse.json({ error: 'Missing markdown content.' }, { status: 400 });
  }

  const normalizedContent = body.content.replace(/\r\n/g, '\n');
  const sizeBytes = markdownByteLength(normalizedContent);
  if (sizeBytes <= 0) {
    return NextResponse.json({ error: 'Markdown content is empty.' }, { status: 400 });
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json({
      error: `Markdown file is too large. Max size is ${Math.floor(MAX_UPLOAD_BYTES / 1024)}KB.`,
    }, { status: 413 });
  }

  const now = Date.now();
  const expiresAt = now + DEFAULT_EXPIRY_MS;
  const ipHash = hashIp(readClientIp(request));
  const quota = await mutateConvex<{
    ok: boolean;
    remaining: number;
    resetAt: number;
  }>(F.mutations.anonSharesConsumeCreateQuota, {
    ipHash,
    now,
    maxPerDay: MAX_CREATES_PER_DAY_PER_IP,
  });
  if (!quota.ok) {
    return NextResponse.json({
      error: 'Daily anonymous share limit reached for this IP.',
      resetAt: quota.resetAt,
    }, { status: 429 });
  }

  const title = normalizeTitleFromFileName(fileName);
  const editSecret = generateEditSecret();
  let shareId: string | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = generateShortId();
    try {
      await mutateConvex(F.mutations.anonSharesCreate, {
        shortId: candidate,
        title,
        content: normalizedContent,
        editSecret,
        createdByIpHash: ipHash,
        expiresAt,
      });
      shareId = candidate;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      if (!message.includes('Short ID already exists')) {
        throw error;
      }
    }
  }

  if (!shareId) {
    return NextResponse.json({ error: 'Could not allocate share ID.' }, { status: 500 });
  }

  const origin = request.nextUrl.origin;
  const viewUrl = `${origin}/s/${encodeURIComponent(shareId)}`;
  const editUrl = `${viewUrl}?edit=${encodeURIComponent(editSecret)}`;

  return NextResponse.json({
    ok: true,
    shareId,
    viewUrl,
    editUrl,
    expiresAt,
  });
}
