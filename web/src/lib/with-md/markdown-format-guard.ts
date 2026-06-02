export type ProtectedMarkdownKind =
  | 'code'
  | 'frontmatter'
  | 'html'
  | 'image'
  | 'link'
  | 'reference'
  | 'table'
  | 'task_list';

export interface ProtectedMarkdownLoss {
  missing: Array<{
    kind: ProtectedMarkdownKind;
    value: string;
  }>;
}

export type ProtectedMarkdownSaveDecision =
  | { safe: true; content: string }
  | { safe: false; content: string; loss: ProtectedMarkdownLoss };

interface ProtectedMarkdownToken {
  kind: ProtectedMarkdownKind;
  value: string;
}

const FENCED_CODE_RE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---(?=\n|$)/g;
const INLINE_CODE_RE = /`+[^`\n]+`+/g;
const IMAGE_RE = /!\[(?:\\.|[^\]\\\n]|\[[^\]\n]*\])*\]\([^)\n]+\)/g;
const REFERENCE_IMAGE_RE = /!\[(?:\\.|[^\]\\\n]|\[[^\]\n]*\])*\]\[(?:\\.|[^\]\\\n]|\[[^\]\n]*\])*\]/g;
const INLINE_LINK_RE = /(^|[^!])(\[[^\]\n]+\]\([^)\n]+\))/g;
const REFERENCE_LINK_RE = /(^|[^!])(\[[^\]\n]+\]\[[^\]\n]*\])/g;
const REFERENCE_DEFINITION_RE = /^[ \t]{0,3}\[[^\]\n]+]:[ \t]+\S.*$/gm;
const AUTOLINK_RE = /<(?:https?:\/\/|mailto:)[^>\s]+>/gi;
const RAW_HTML_RE = /<\/?[A-Za-z][\w-]*(?:\s+[^>\n]*)?\s*\/?>/g;
const TASK_LIST_RE = /^[ \t]*[-*+]\s+\[[ xX]\]\s+.+$/gm;

function normalizeMarkdown(content: string) {
  return content.replace(/\r\n/g, '\n');
}

function stripFencedCode(markdown: string) {
  return markdown.replace(FENCED_CODE_RE, (match) => '\n'.repeat(match.split('\n').length - 1));
}

function pushWholeMatches(
  tokens: ProtectedMarkdownToken[],
  source: string,
  pattern: RegExp,
  kind: ProtectedMarkdownKind,
) {
  for (const match of source.matchAll(pattern)) {
    const value = match[0];
    if (value) tokens.push({ kind, value });
  }
}

function pushCapturedMatches(
  tokens: ProtectedMarkdownToken[],
  source: string,
  pattern: RegExp,
  kind: ProtectedMarkdownKind,
  groupIndex: number,
) {
  for (const match of source.matchAll(pattern)) {
    const value = match[groupIndex];
    if (value) tokens.push({ kind, value });
  }
}

function extractTableBlocks(markdown: string): ProtectedMarkdownToken[] {
  const tokens: ProtectedMarkdownToken[] = [];
  const lines = markdown.split('\n');

  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index] ?? '';
    const separator = lines[index + 1] ?? '';
    const hasHeaderPipes = header.includes('|');
    const isSeparator = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator);
    if (!hasHeaderPipes || !isSeparator) continue;

    let end = index + 2;
    while (end < lines.length && (lines[end] ?? '').includes('|')) {
      end += 1;
    }

    tokens.push({ kind: 'table', value: lines.slice(index, end).join('\n') });
    index = end - 1;
  }

  return tokens;
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let position = 0;
  while (position <= haystack.length) {
    const next = haystack.indexOf(needle, position);
    if (next < 0) break;
    count += 1;
    position = next + Math.max(1, needle.length);
  }
  return count;
}

export function extractProtectedMarkdownTokens(markdown: string): ProtectedMarkdownToken[] {
  const normalized = normalizeMarkdown(markdown);
  const withoutFencedCode = stripFencedCode(normalized);
  const tokens: ProtectedMarkdownToken[] = [];

  pushWholeMatches(tokens, normalized, FENCED_CODE_RE, 'code');
  pushWholeMatches(tokens, normalized, FRONTMATTER_RE, 'frontmatter');
  pushWholeMatches(tokens, withoutFencedCode, INLINE_CODE_RE, 'code');
  pushWholeMatches(tokens, withoutFencedCode, IMAGE_RE, 'image');
  pushWholeMatches(tokens, withoutFencedCode, REFERENCE_IMAGE_RE, 'image');
  pushCapturedMatches(tokens, withoutFencedCode, INLINE_LINK_RE, 'link', 2);
  pushCapturedMatches(tokens, withoutFencedCode, REFERENCE_LINK_RE, 'reference', 2);
  pushWholeMatches(tokens, withoutFencedCode, REFERENCE_DEFINITION_RE, 'reference');
  pushWholeMatches(tokens, withoutFencedCode, AUTOLINK_RE, 'link');
  pushWholeMatches(tokens, withoutFencedCode, RAW_HTML_RE, 'html');
  pushWholeMatches(tokens, withoutFencedCode, TASK_LIST_RE, 'task_list');
  tokens.push(...extractTableBlocks(withoutFencedCode));

  return tokens;
}

export function findProtectedMarkdownLoss(before: string, after: string): ProtectedMarkdownLoss | null {
  const beforeNormalized = normalizeMarkdown(before);
  const afterNormalized = normalizeMarkdown(after);
  const tokens = extractProtectedMarkdownTokens(beforeNormalized);
  const missing: ProtectedMarkdownLoss['missing'] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const beforeCount = countOccurrences(beforeNormalized, token.value);
    const afterCount = countOccurrences(afterNormalized, token.value);
    if (afterCount >= beforeCount) continue;

    const key = `${token.kind}:${token.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    missing.push(token);
  }

  return missing.length > 0 ? { missing } : null;
}

export function protectMarkdownSave(
  baselineContent: string,
  nextContent: string,
): ProtectedMarkdownSaveDecision {
  const baselineNormalized = normalizeMarkdown(baselineContent);
  const nextNormalized = normalizeMarkdown(nextContent);
  const loss = findProtectedMarkdownLoss(baselineNormalized, nextNormalized);

  if (loss) {
    return {
      safe: false,
      content: baselineNormalized,
      loss,
    };
  }

  return {
    safe: true,
    content: nextNormalized,
  };
}
