export interface ContentStructureStats {
  linkCount: number;
  listItemCount: number;
  codeBlockCount: number;
  tableCount: number;
}

export interface ExtractedMainContent {
  title: string;
  html: string;
  text: string;
  excerpt?: string;
  structure: ContentStructureStats;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  const named = value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

  return named.replace(/&#(x?[0-9a-f]+);/gi, (_match, rawCode) => {
    const isHex = rawCode.toLowerCase().startsWith('x');
    const parsed = Number.parseInt(isHex ? rawCode.slice(1) : rawCode, isHex ? 16 : 10);
    if (!Number.isFinite(parsed)) return ' ';
    return String.fromCodePoint(parsed);
  });
}

function stripTags(value: string): string {
  return collapseWhitespace(
    decodeHtmlEntities(
      value
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

function stripBoilerplateBlocks(value: string): string {
  const blockTags = [
    'script',
    'style',
    'noscript',
    'template',
    'iframe',
    'svg',
    'canvas',
    'nav',
    'aside',
    'form',
    'header',
    'footer',
  ];

  let output = value;
  for (const tag of blockTags) {
    output = output.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  }

  return output
    .replace(/<(?:input|button|select|textarea|option)\b[^>]*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

function collectStructureStats(value: string): ContentStructureStats {
  return {
    linkCount: countMatches(value, /<a\b[^>]*href=/gi),
    listItemCount: countMatches(value, /<li\b/gi),
    codeBlockCount: countMatches(value, /<(?:pre|code)\b/gi),
    tableCount: countMatches(value, /<table\b/gi),
  };
}

function extractBodyHtml(html: string): string {
  const match = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return match?.[1] ?? html;
}

function extractTagBlocks(html: string, tag: string): Array<{ attrs: string; content: string }> {
  const blocks: Array<{ attrs: string; content: string }> = [];
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  for (const match of html.matchAll(pattern)) {
    const attrs = match[1] ?? '';
    const content = match[2] ?? '';
    if (content.trim()) {
      blocks.push({ attrs, content });
    }
  }
  return blocks;
}

function extractFirstTagText(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match?.[1]) return null;
  const text = stripTags(match[1]);
  return text || null;
}

function extractMetaContent(html: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta\\b[^>]*\\bproperty\\s*=\\s*["']${escapedKey}["'][^>]*>`, 'i'),
    new RegExp(`<meta\\b[^>]*\\bname\\s*=\\s*["']${escapedKey}["'][^>]*>`, 'i'),
  ];

  for (const pattern of patterns) {
    const metaTag = html.match(pattern)?.[0];
    if (!metaTag) continue;
    const contentMatch = metaTag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const content = contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? '';
    const clean = collapseWhitespace(decodeHtmlEntities(content));
    if (clean) return clean;
  }

  return null;
}

function linkTextLength(html: string): number {
  let total = 0;
  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    total += stripTags(match[1] ?? '').length;
  }
  return total;
}

function scoreCandidate(content: string, attrs: string): number {
  const text = stripTags(content);
  const textLength = text.length;
  if (textLength < 120) return -1_000_000;

  const paragraphs = countMatches(content, /<p\b/gi);
  const headings = countMatches(content, /<h[1-4]\b/gi);
  const sentences = countMatches(text, /[.!?](?:\s|$)/g);
  const linksLength = linkTextLength(content);
  const linkDensity = textLength > 0 ? linksLength / textLength : 1;

  const positiveAttr = /(article|post|entry|content|main|prose|markdown|blog|doc)/i.test(attrs);
  const negativeAttr = /(nav|menu|footer|header|sidebar|social|share|comment|related|popup|modal|cookie|ad)/i.test(attrs);
  const noiseText = /(sign up|log in|subscribe|cookie|privacy policy|all rights reserved)/i.test(text);

  return (
    textLength
    + paragraphs * 60
    + headings * 40
    + sentences * 20
    + (positiveAttr ? 180 : 0)
    - (negativeAttr ? 260 : 0)
    - (noiseText ? 180 : 0)
    - linkDensity * 460
  );
}

function pickBestContentRoot(html: string): string {
  const body = extractBodyHtml(html);

  const candidates: Array<{ attrs: string; content: string; score: number }> = [];

  for (const block of extractTagBlocks(body, 'article')) {
    candidates.push({ ...block, score: scoreCandidate(block.content, block.attrs) });
  }
  for (const block of extractTagBlocks(body, 'main')) {
    candidates.push({ ...block, score: scoreCandidate(block.content, block.attrs) });
  }
  for (const block of extractTagBlocks(body, 'section')) {
    if (/(article|post|entry|content|main|prose|markdown|blog|doc)/i.test(block.attrs)) {
      candidates.push({ ...block, score: scoreCandidate(block.content, block.attrs) });
    }
  }
  for (const block of extractTagBlocks(body, 'div')) {
    if (/(article|post|entry|content|main|prose|markdown|blog|doc|readme)/i.test(block.attrs)) {
      candidates.push({ ...block, score: scoreCandidate(block.content, block.attrs) });
    }
  }

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  const bestContent = best?.content?.trim();
  if (bestContent && stripTags(bestContent).length >= 180) {
    return bestContent;
  }

  return body;
}

function pickTitle(html: string, selectedHtml: string): string {
  const title =
    extractMetaContent(html, 'og:title')
    ?? extractMetaContent(html, 'twitter:title')
    ?? extractFirstTagText(html, 'title')
    ?? extractFirstTagText(selectedHtml, 'h1')
    ?? 'Untitled';

  return collapseWhitespace(title) || 'Untitled';
}

function buildExcerpt(text: string): string | undefined {
  if (!text) return undefined;
  const sentence = text.match(/^(.{80,320}?[.!?])(?:\s|$)/)?.[1];
  if (sentence) return sentence;
  return text.length > 220 ? `${text.slice(0, 220).trimEnd()}...` : text;
}

function normalizeHtml(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shouldKeepRawUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('#')) return true;
  if (/^(mailto|tel|javascript|data):/i.test(trimmed)) return true;
  return false;
}

function absolutizeHtmlUrls(html: string, baseUrl: string): string {
  return html.replace(/\b(href|src)\s*=\s*(['"])([^'"]*)\2/gi, (match, attr, quote, rawValue) => {
    const value = rawValue.trim();
    if (shouldKeepRawUrl(value)) return match;
    try {
      const absolute = new URL(value, baseUrl).toString();
      return `${attr}=${quote}${absolute}${quote}`;
    } catch {
      return match;
    }
  });
}

export function extractMainContent(html: string, sourceUrl: string): ExtractedMainContent {
  const cleaned = stripBoilerplateBlocks(html);
  const selectedHtml = absolutizeHtmlUrls(normalizeHtml(pickBestContentRoot(cleaned)), sourceUrl);
  const text = stripTags(selectedHtml);
  const structure = collectStructureStats(selectedHtml);
  const title = pickTitle(cleaned, selectedHtml);

  return {
    title,
    html: selectedHtml,
    text,
    excerpt: buildExcerpt(text),
    structure,
  };
}
