export type WebResolveMode = 'normal' | 'revalidate';

const REVALIDATE_SUFFIXES = new Set(['revalidate', 'redo']);

export interface ParsedWebTarget {
  targetUrl: string;
  mode: WebResolveMode;
  suffix: 'revalidate' | 'redo' | null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parseSingleSegment(raw: string): string | null {
  const decoded = decodeSegment(raw).trim();
  if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
    return decoded;
  }
  return null;
}

function parseProtocolSegments(segments: string[]): string | null {
  if (segments.length < 2) return null;

  const first = decodeSegment(segments[0]).trim();
  const protocol = first.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return null;
  }

  const host = decodeSegment(segments[1]).trim();
  if (!host) return null;

  const path = segments
    .slice(2)
    .map((segment) => decodeSegment(segment))
    .join('/');

  if (!path) {
    return `${protocol}//${host}`;
  }

  return `${protocol}//${host}/${path}`;
}

export function parseWebTargetSegments(rawSegments: string[] | undefined): ParsedWebTarget | null {
  if (!rawSegments || rawSegments.length === 0) return null;

  const segments = [...rawSegments];
  let suffix: 'revalidate' | 'redo' | null = null;
  const tail = decodeSegment(segments[segments.length - 1]).trim().toLowerCase();
  if (REVALIDATE_SUFFIXES.has(tail)) {
    suffix = tail === 'redo' ? 'redo' : 'revalidate';
    segments.pop();
  }

  if (segments.length === 0) return null;

  const fromSingle = segments.length === 1 ? parseSingleSegment(segments[0]) : null;
  const fromProtocol = parseProtocolSegments(segments);
  const targetUrl = fromSingle ?? fromProtocol;
  if (!targetUrl) return null;

  return {
    targetUrl,
    mode: suffix ? 'revalidate' : 'normal',
    suffix,
  };
}
