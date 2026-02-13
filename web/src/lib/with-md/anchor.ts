import type { AnchorMatch, CommentAnchorSnapshot } from '@/lib/with-md/types';

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

function span(start: number, len: number): AnchorMatch {
  return { start, end: start + len };
}

export function findAllIndices(haystack: string, needle: string): number[] {
  if (!needle) return [];

  const out: number[] = [];
  let idx = 0;

  while (idx < haystack.length) {
    const next = haystack.indexOf(needle, idx);
    if (next === -1) break;
    out.push(next);
    idx = next + Math.max(needle.length, 1);
  }

  return out;
}

export function contextScore(
  source: string,
  index: number,
  prefix: string,
  suffix: string,
): number {
  let score = 0;
  const before = source.slice(Math.max(0, index - prefix.length), index);
  const after = source.slice(index, index + suffix.length + 128);

  if (prefix && before.endsWith(prefix)) score += 2;
  if (suffix && after.includes(suffix)) score += 2;

  return score;
}

export function extractHeadingPathAtIndex(markdown: string, index: number): string[] {
  const headings = Array.from(markdown.matchAll(HEADING_RE));
  const path: Array<{ level: number; text: string; at: number }> = [];

  for (const h of headings) {
    const at = h.index ?? 0;
    if (at > index) break;

    const level = h[1].length;
    const text = h[2].trim();

    while (path.length > 0 && path[path.length - 1].level >= level) {
      path.pop();
    }

    path.push({ level, text, at });
  }

  return path.map((p) => p.text);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function findSectionByHeadingPath(
  markdown: string,
  headingPath: string[],
): { start: number; end: number; content: string } | null {
  if (headingPath.length === 0) return null;

  const lines = markdown.split('\n');
  let offset = 0;
  const path: string[] = [];
  let sectionStart = -1;
  let sectionLevel = 7;

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      const level = m[1].length;
      const text = m[2].trim();

      while (path.length >= level) path.pop();
      path.push(text);

      if (arraysEqual(path, headingPath)) {
        sectionStart = offset + line.length + 1;
        sectionLevel = level;
      } else if (sectionStart >= 0 && level <= sectionLevel) {
        return {
          start: sectionStart,
          end: offset,
          content: markdown.slice(sectionStart, offset),
        };
      }
    }

    offset += line.length + 1;
  }

  if (sectionStart >= 0) {
    return {
      start: sectionStart,
      end: markdown.length,
      content: markdown.slice(sectionStart),
    };
  }

  return null;
}

export function recoverAnchor(markdown: string, anchor: CommentAnchorSnapshot): AnchorMatch | null {
  const quote = anchor.textQuote;
  if (!quote) return null;

  const exact = findAllIndices(markdown, quote);
  if (exact.length === 1) {
    return span(exact[0], quote.length);
  }

  if (exact.length > 1) {
    const best = exact
      .map((i) => ({
        i,
        score: contextScore(markdown, i, anchor.anchorPrefix, anchor.anchorSuffix),
      }))
      .sort((a, b) => b.score - a.score)[0];

    return span(best.i, quote.length);
  }

  const section = findSectionByHeadingPath(markdown, anchor.anchorHeadingPath);
  if (section) {
    const inSection = section.content.indexOf(quote);
    if (inSection >= 0) {
      return span(section.start + inSection, quote.length);
    }
  }

  return null;
}
