const DEFAULT_MAX_PUBLIC_SHARE_BYTES = 1024 * 1024; // 1MB

export const MAX_PUBLIC_SHARE_BYTES = DEFAULT_MAX_PUBLIC_SHARE_BYTES;

export function markdownByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function normalizeMarkdownInput(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function stripWeakEtags(value: string): string {
  return value.replace(/^W\//i, '');
}

function stripSurroundingQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

export function normalizeVersionTag(value: string): string {
  return stripSurroundingQuotes(stripWeakEtags(value.trim()));
}

export function readExpectedVersion(
  parsedBody: Record<string, unknown>,
  request: Request,
): string | undefined {
  const ifMatchBody = parsedBody.ifMatch;
  if (typeof ifMatchBody === 'string' && ifMatchBody.trim()) {
    return normalizeVersionTag(ifMatchBody);
  }

  const ifMatchHeader = request.headers.get('if-match');
  if (ifMatchHeader && ifMatchHeader.trim()) {
    return normalizeVersionTag(ifMatchHeader);
  }

  return undefined;
}

export function toSafeMarkdownFilename(title: string, fallback = 'shared-markdown'): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = normalized || fallback;
  return base.endsWith('.md') || base.endsWith('.markdown') ? base : `${base}.md`;
}

function getHocuspocusHttpUrl(): string | null {
  const explicit = process.env.HOCUSPOCUS_HTTP_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const wsUrl = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
  if (!wsUrl) return null;

  return wsUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/$/, '');
}

export async function tryHocuspocusEdit(
  documentName: string,
  editSecret: string,
  content: string,
  timeoutMs = 5000,
): Promise<boolean> {
  const baseUrl = getHocuspocusHttpUrl();
  if (!baseUrl) return false;

  try {
    const res = await fetch(`${baseUrl}/api/agent/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentName, editSecret, content }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
