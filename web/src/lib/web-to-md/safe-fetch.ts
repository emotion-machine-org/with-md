import { promises as dnsPromises } from 'node:dns';

const PRIVATE_IP_RE = [
  // IPv4 private, loopback, link-local, CGNAT
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.18\./,
  /^198\.19\./,
  /^192\.0\.2\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^240\./,
  /^255\.255\.255\.255$/,
  // IPv6 loopback + private
  /^::1$/,
  /^fc[\da-f]{2}:/i,
  /^fd[\da-f]{2}:/i,
  /^fe80:/i,
  /^::$/,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RE.some(re => re.test(ip));
}

async function validateHostname(hostname: string): Promise<void> {
  let address: string;
  try {
    const result = await dnsPromises.lookup(hostname);
    address = result.address;
  } catch (e: unknown) {
    throw new Error(`DNS lookup failed for ${hostname}: ${(e as Error).message}`);
  }
  if (isPrivateIp(address)) {
    throw new Error(`SSRF: ${hostname} resolves to private IP ${address}`);
  }
}

export interface FetchResult {
  html: string;
  finalUrl: string;
  status: number;
  contentType: string;
}

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_TIMEOUT_MS = 15_000;

export async function safeFetchHtml(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  extraHeaders: Record<string, string> = {},
): Promise<FetchResult> {
  const parsed = new URL(url);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported scheme: ${parsed.protocol}`);
  }

  await validateHostname(parsed.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; withmd-webtomd/1.0)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...extraHeaders,
      },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }

  const finalUrl = resp.url || url;

  // Re-validate after redirects (best-effort)
  if (finalUrl !== url) {
    try {
      const finalParsed = new URL(finalUrl);
      await validateHostname(finalParsed.hostname);
    } catch {
      // If redirect SSRF check fails, fail the whole fetch
      throw new Error(`SSRF: redirect target ${finalUrl} failed validation`);
    }
  }

  const contentType = resp.headers.get('content-type') ?? '';

  // Stream response with size cap
  const reader = resp.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          reader.cancel();
          break;
        }
        chunks.push(value);
      }
    } catch {
      // Partial read is fine
    }
  }

  const merged = new Uint8Array(chunks.reduce((acc, c) => acc + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const html = new TextDecoder().decode(merged);
  return { html, finalUrl, status: resp.status, contentType };
}
