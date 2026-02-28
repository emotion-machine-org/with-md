import { createHash } from 'node:crypto';

export interface CanonicalUrlResult {
  normalizedUrl: string;
  displayUrl: string;
  urlHash: string;
}

function sortQueryString(input: URLSearchParams): string {
  const entries = [...input.entries()];
  entries.sort((a, b) => {
    if (a[0] === b[0]) return a[1].localeCompare(b[1]);
    return a[0].localeCompare(b[0]);
  });

  const sorted = new URLSearchParams();
  for (const [key, value] of entries) {
    sorted.append(key, value);
  }
  return sorted.toString();
}

function stripDefaultPort(protocol: string, port: string): string {
  if (!port) return '';
  if (protocol === 'http:' && port === '80') return '';
  if (protocol === 'https:' && port === '443') return '';
  return port;
}

export function canonicalizeUrl(rawUrl: string): CanonicalUrlResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Missing target URL.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL.');
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }

  parsed.protocol = protocol;
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';

  const normalizedPort = stripDefaultPort(parsed.protocol, parsed.port);
  parsed.port = normalizedPort;

  if (!parsed.pathname) {
    parsed.pathname = '/';
  }

  const sortedQuery = sortQueryString(parsed.searchParams);
  parsed.search = sortedQuery ? `?${sortedQuery}` : '';

  const normalizedUrl = parsed.toString();
  const displayUrl = trimmed;
  const urlHash = createHash('sha256').update(normalizedUrl).digest('hex');

  return {
    normalizedUrl,
    displayUrl,
    urlHash,
  };
}
