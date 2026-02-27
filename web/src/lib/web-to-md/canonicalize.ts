import { createHash } from 'node:crypto';

const REVALIDATE_SUFFIXES = new Set(['revalidate', 'redo']);

/**
 * Parse the catch-all slug into a target URL + revalidate flag.
 * Slug segments come from Next.js [...slug] params, e.g.:
 *   /https://example.com/path → ['https:', '', 'example.com', 'path']
 */
export function parseWebTarget(slug: string[]): { rawUrl: string; revalidate: boolean } {
  // Next.js URL-encodes special chars in path segments, so 'https:' becomes 'https%3A'
  const decoded = slug.map(s => decodeURIComponent(s));
  const last = decoded[decoded.length - 1]?.toLowerCase() ?? '';
  const revalidate = REVALIDATE_SUFFIXES.has(last);
  const urlSegments = revalidate ? decoded.slice(0, -1) : decoded;
  // Joining with '/' reconstructs the URL.
  // ['https:', '', 'example.com', 'path'].join('/') === 'https://example.com/path' ✓
  // But Next.js normalizes '//' to '/' in paths, so we may also get:
  // ['https:', 'example.com', 'path'].join('/') === 'https:/example.com/path' ← fix needed
  const joined = urlSegments.join('/');
  // Fix single-slash after scheme: 'https:/X' → 'https://X'
  const rawUrl = joined.replace(/^(https?:)\/([^/])/, '$1//$2');
  return { rawUrl, revalidate };
}

export interface CanonicalUrl {
  normalizedUrl: string;
  urlHash: string;
  displayUrl: string;
}

/**
 * Canonicalize a URL deterministically:
 * - Only http/https allowed
 * - Lowercase scheme + host
 * - Drop default ports (80/443)
 * - Drop fragment
 * - Preserve path + query
 */
export function canonicalizeUrl(rawUrl: string): CanonicalUrl {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Unsupported scheme: ${u.protocol}`);
  }

  // Lowercase host
  u.hostname = u.hostname.toLowerCase();

  // Remove default ports
  if ((u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')) {
    u.port = '';
  }

  // Drop fragment
  u.hash = '';

  const normalizedUrl = u.toString();
  const urlHash = createHash('sha256').update(normalizedUrl).digest('hex');
  const displayUrl = u.hostname + (u.pathname !== '/' ? u.pathname : '');

  return { normalizedUrl, urlHash, displayUrl };
}
