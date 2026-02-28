import dns from 'node:dns/promises';
import net from 'node:net';

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  finalUrl: string;
  contentType: string;
  headers: Record<string, string>;
  body: string;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 4;

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return -1;
  }
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3];
}

function ipv4InRange(ip: string, cidrBase: string, prefix: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(cidrBase);
  if (ipInt < 0 || baseInt < 0) return false;
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipInt & mask) === (baseInt & mask);
}

function isBlockedIpv4(ip: string): boolean {
  const blockedRanges: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
  ];

  return blockedRanges.some(([base, prefix]) => ipv4InRange(ip, base, prefix));
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('2001:db8:')) return true;

  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (net.isIPv4(mapped)) {
      return isBlockedIpv4(mapped);
    }
  }

  return false;
}

function isBlockedIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true;
}

async function assertPublicHostname(hostname: string): Promise<void> {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Missing host in URL.');
  }

  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal')
    || normalized.endsWith('.home')
  ) {
    throw new Error('Localhost addresses are blocked.');
  }

  if (net.isIP(normalized)) {
    if (isBlockedIp(normalized)) {
      throw new Error('Private or reserved IP targets are blocked.');
    }
    return;
  }

  const addresses = await dns.lookup(normalized, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error('Could not resolve target host.');
  }

  for (const entry of addresses) {
    if (isBlockedIp(entry.address)) {
      throw new Error('Target resolved to a private or reserved IP range.');
    }
  }
}

export async function assertPublicHttpTarget(targetUrl: string): Promise<URL> {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }
  await assertPublicHostname(parsed.hostname);
  return parsed;
}

function parseLocation(from: string, locationHeader: string | null): string {
  if (!locationHeader) {
    throw new Error('Redirect response is missing a Location header.');
  }
  const next = new URL(locationHeader, from);
  return next.toString();
}

function contentTypeOf(response: Response): string {
  return (response.headers.get('content-type') ?? '').toLowerCase();
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(`Response exceeded ${maxBytes} bytes.`);
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function shouldRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function flattenHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key.toLowerCase()] = value;
  });
  return output;
}

async function fetchWithTimeout(url: string, timeoutMs: number, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function safeFetchText(startUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const headers = options.headers ?? {};

  let currentUrl = startUrl;
  let redirects = 0;

  while (true) {
    const parsed = await assertPublicHttpTarget(currentUrl);

    const response = await fetchWithTimeout(parsed.toString(), timeoutMs, headers);

    if (shouldRedirect(response.status)) {
      if (redirects >= maxRedirects) {
        throw new Error(`Too many redirects (>${maxRedirects}).`);
      }
      const nextUrl = parseLocation(parsed.toString(), response.headers.get('location'));
      currentUrl = nextUrl;
      redirects += 1;
      continue;
    }

    const body = await readTextWithLimit(response, maxBytes);
    return {
      status: response.status,
      finalUrl: parsed.toString(),
      contentType: contentTypeOf(response),
      headers: flattenHeaders(response.headers),
      body,
    };
  }
}

export function looksLikeHtml(contentType: string, body: string): boolean {
  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
    return true;
  }
  const head = body.slice(0, 500).toLowerCase();
  return head.includes('<html') || head.includes('<body') || head.includes('<!doctype html');
}

export function looksLikeMarkdown(contentType: string): boolean {
  return (
    contentType.includes('text/markdown')
    || contentType.includes('text/plain')
    || contentType.includes('application/markdown')
    || contentType.includes('text/x-markdown')
  );
}
