import type { AnchorMatch, CommentAnchorSnapshot } from '@/lib/with-md/types';

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

function span(start: number, len: number): AnchorMatch {
  return { start, end: start + len };
}

function indexAtLine(markdown: string, line: number): number {
  if (!Number.isFinite(line) || line <= 1) return 0;
  let currentLine = 1;
  for (let i = 0; i < markdown.length; i += 1) {
    if (currentLine >= line) return i;
    if (markdown[i] === '\n') currentLine += 1;
  }
  return markdown.length;
}

function lineSpan(markdown: string, line: number): AnchorMatch | null {
  const start = indexAtLine(markdown, line);
  if (start < 0 || start > markdown.length) return null;
  let end = markdown.indexOf('\n', start);
  if (end === -1) end = markdown.length;
  if (end <= start) return null;
  return { start, end };
}

export function lineNumberAtIndex(markdown: string, index: number): number {
  if (index <= 0) return 1;
  return markdown.slice(0, Math.min(index, markdown.length)).split('\n').length;
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

interface NormalizedText {
  value: string;
  sourceIndexByNormalizedIndex: number[];
}

function normalizeSearchChar(char: string): string {
  if (char === '\u00a0') return ' ';
  if (char === '•' || char === '◦' || char === '▪') return '-';
  if (char === '’' || char === '‘') return "'";
  if (char === '“' || char === '”') return '"';
  return char;
}

function normalizeForSearch(input: string): NormalizedText {
  let value = '';
  const sourceIndexByNormalizedIndex: number[] = [];
  let lastWasSpace = false;

  for (let i = 0; i < input.length; i += 1) {
    const raw = normalizeSearchChar(input[i]);
    const isSpace = /\s/.test(raw);

    if (isSpace) {
      if (lastWasSpace) continue;
      value += ' ';
      sourceIndexByNormalizedIndex.push(i);
      lastWasSpace = true;
      continue;
    }

    value += raw.toLowerCase();
    sourceIndexByNormalizedIndex.push(i);
    lastWasSpace = false;
  }

  return { value, sourceIndexByNormalizedIndex };
}

/** Like normalizeForSearch but also strips markdown inline formatting (*, _, `, ~~). */
function normalizeMarkdownForSearch(input: string): NormalizedText {
  let value = '';
  const sourceIndexByNormalizedIndex: number[] = [];
  let lastWasSpace = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Skip ~~ (strikethrough)
    if (ch === '~' && input[i + 1] === '~') { i += 2; continue; }
    // Skip * and _ (bold/italic markers)
    if (ch === '*' || ch === '_') { i += 1; continue; }
    // Skip ` (inline code marker)
    if (ch === '`') { i += 1; continue; }

    const raw = normalizeSearchChar(ch);
    const isSpace = /\s/.test(raw);

    if (isSpace) {
      if (lastWasSpace) { i += 1; continue; }
      value += ' ';
      sourceIndexByNormalizedIndex.push(i);
      lastWasSpace = true;
      i += 1;
      continue;
    }

    value += raw.toLowerCase();
    sourceIndexByNormalizedIndex.push(i);
    lastWasSpace = false;
    i += 1;
  }

  return { value, sourceIndexByNormalizedIndex };
}

function normalizedEquals(a: string, b: string): boolean {
  return normalizeForSearch(a).value.trim() === normalizeForSearch(b).value.trim();
}

export function findApproximateQuoteInMarkdown(markdown: string, quote: string): AnchorMatch | null {
  if (!quote.trim()) return null;

  // Use markdown-aware normalization that strips *, _, `, ~~ so quotes
  // spanning formatted text (e.g. "bold text" from "**bold** text") can match.
  const normalizedMarkdown = normalizeMarkdownForSearch(markdown);
  const normalizedQuote = normalizeMarkdownForSearch(quote);
  const needle = normalizedQuote.value.trim();
  if (!needle) return null;

  const haystack = normalizedMarkdown.value;
  const hit = haystack.indexOf(needle);
  if (hit < 0) return null;

  const startSource = normalizedMarkdown.sourceIndexByNormalizedIndex[hit];
  const endNormIndex = hit + needle.length - 1;
  const endSourceRaw = normalizedMarkdown.sourceIndexByNormalizedIndex[endNormIndex];
  if (typeof startSource !== 'number' || typeof endSourceRaw !== 'number') return null;

  return { start: startSource, end: Math.min(markdown.length, endSourceRaw + 1) };
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

export function pickBestQuoteIndex(
  markdown: string,
  quote: string,
  options?: {
    fallbackLine?: number;
    preferredStart?: number;
    anchorPrefix?: string;
    anchorSuffix?: string;
    anchorHeadingPath?: string[];
  },
): number | undefined {
  const candidates = findAllIndices(markdown, quote);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const fallbackLine = options?.fallbackLine;
  const preferredStart = options?.preferredStart;
  const prefix = options?.anchorPrefix ?? '';
  const suffix = options?.anchorSuffix ?? '';
  const headingPath = options?.anchorHeadingPath ?? [];
  const section = headingPath.length > 0 ? findSectionByHeadingPath(markdown, headingPath) : null;

  let best: { index: number; score: number } | null = null;

  for (const index of candidates) {
    let score = 0;
    score += contextScore(markdown, index, prefix, suffix) * 20;

    if (typeof preferredStart === 'number') {
      const delta = Math.abs(index - preferredStart);
      score += Math.max(0, 220 - delta / 4);
    }

    if (typeof fallbackLine === 'number' && Number.isFinite(fallbackLine)) {
      const lineDelta = Math.abs(lineNumberAtIndex(markdown, index) - fallbackLine);
      score += Math.max(0, 160 - lineDelta * 18);
    }

    if (section) {
      const inSection = index >= section.start && index < section.end;
      if (inSection) score += 90;
    }

    if (!best || score > best.score) {
      best = { index, score };
    }
  }

  return best?.index;
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

  if (typeof anchor.rangeStart === 'number' && anchor.rangeStart >= 0) {
    const start = anchor.rangeStart;
    const end = typeof anchor.rangeEnd === 'number' && anchor.rangeEnd >= start
      ? anchor.rangeEnd
      : (quote ? start + quote.length : start);
    const slice = markdown.slice(start, end);
    if (!quote || slice === quote || normalizedEquals(slice, quote)) {
      if (quote) {
        const duplicateHits = findAllIndices(markdown, quote);
        if (duplicateHits.length > 1) {
          const contextBest = pickBestQuoteIndex(markdown, quote, {
            fallbackLine: anchor.fallbackLine,
            anchorPrefix: anchor.anchorPrefix,
            anchorSuffix: anchor.anchorSuffix,
            anchorHeadingPath: anchor.anchorHeadingPath,
          });
          if (typeof contextBest === 'number' && contextBest !== start) {
            return span(contextBest, quote.length);
          }
        }
      }
      return { start, end };
    }
  }

  if (!quote) return null;

  const bestExact = pickBestQuoteIndex(markdown, quote, {
    fallbackLine: anchor.fallbackLine,
    preferredStart: anchor.rangeStart,
    anchorPrefix: anchor.anchorPrefix,
    anchorSuffix: anchor.anchorSuffix,
    anchorHeadingPath: anchor.anchorHeadingPath,
  });
  if (typeof bestExact === 'number') {
    return span(bestExact, quote.length);
  }

  const section = findSectionByHeadingPath(markdown, anchor.anchorHeadingPath);
  if (section) {
    const inSection = section.content.indexOf(quote);
    if (inSection >= 0) {
      return span(section.start + inSection, quote.length);
    }

    const approxInSection = findApproximateQuoteInMarkdown(section.content, quote);
    if (approxInSection) {
      return { start: section.start + approxInSection.start, end: section.start + approxInSection.end };
    }
  }

  const approximate = findApproximateQuoteInMarkdown(markdown, quote);
  if (approximate) return approximate;

  // Graceful approximation fallback for stubborn cases: highlight the recorded line.
  // This keeps user-visible persistence even when exact/approx quote recovery fails.
  const lineFallback = lineSpan(markdown, anchor.fallbackLine);
  if (lineFallback) return lineFallback;

  return null;
}
