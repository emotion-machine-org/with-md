import type { ContentStructureStats } from '@/lib/with-md/web2md/extract-main-content';
import { stripMarkdownSyntax } from '@/lib/with-md/web2md/html-to-markdown';

export interface QualityGateInput {
  markdown: string;
  sourceText?: string;
  sourceTitle?: string;
  structure?: ContentStructureStats;
}

export interface QualityGateResult {
  passed: boolean;
  score: number;
  coverage: number;
  reasons: string[];
}

const NOISE_PHRASES = [
  'enable javascript',
  'cookies',
  'accept all',
  'sign in',
  'subscribe',
  'advertisement',
];

const HARD_BLOCK_PATTERNS = [
  /captcha/i,
  /verify(?:ing)?\s+(?:that\s+)?you(?:\s+are)?\s+human/i,
  /access denied/i,
  /too many requests/i,
  /rate limit(?:ed)?(?:\s+your\s+ip)?/i,
  /we had to rate limit your ip/i,
  /temporarily blocked/i,
  /attention required/i,
  /authorized to access this page/i,
  /this page maybe not yet fully loaded/i,
];

function wordCount(value: string): number {
  if (!value.trim()) return 0;
  return value.trim().split(/\s+/).length;
}

function tokenSet(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
  return new Set(tokens);
}

function titleOverlapScore(sourceTitle: string, markdown: string): number {
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  if (!headingMatch || !headingMatch[1]) return 0;

  const a = tokenSet(sourceTitle);
  const b = tokenSet(headingMatch[1]);
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }

  return overlap / Math.max(1, Math.min(a.size, b.size));
}

function countMarkdownListItems(markdown: string): number {
  const bullets = (markdown.match(/^\s*[-*+]\s+/gm) ?? []).length;
  const ordered = (markdown.match(/^\s*\d+\.\s+/gm) ?? []).length;
  return bullets + ordered;
}

function hasMarkdownTable(markdown: string): boolean {
  return /\|[^\n]+\|/.test(markdown) && /\n\|?\s*[-:]{3,}/.test(markdown);
}

function hasMarkdownCode(markdown: string): boolean {
  return markdown.includes('```') || markdown.includes('`');
}

function noiseScore(markdown: string): number {
  const lower = markdown.toLowerCase();
  let hits = 0;
  for (const phrase of NOISE_PHRASES) {
    if (lower.includes(phrase)) hits += 1;
  }
  return hits;
}

export function evaluateMarkdownQuality(input: QualityGateInput): QualityGateResult {
  const markdown = input.markdown.trim();
  const plain = stripMarkdownSyntax(markdown);
  const sourceText = (input.sourceText ?? '').trim();

  const markdownWords = wordCount(plain);
  const sourceLength = sourceText.length;
  const coverage = sourceLength > 0
    ? Math.min(2, plain.length / Math.max(1, sourceLength))
    : markdownWords > 40
      ? 1
      : 0;

  const titleScore = input.sourceTitle ? titleOverlapScore(input.sourceTitle, markdown) : 1;
  const listItemsInSource = input.structure?.listItemCount ?? 0;
  const listItemsInMarkdown = countMarkdownListItems(markdown);
  const listsOk = listItemsInSource < 6 || listItemsInMarkdown >= Math.max(2, Math.floor(listItemsInSource * 0.25));

  const wantsCode = (input.structure?.codeBlockCount ?? 0) > 0;
  const wantsTable = (input.structure?.tableCount ?? 0) > 0;
  const codeOk = !wantsCode || hasMarkdownCode(markdown);
  const tableOk = !wantsTable || hasMarkdownTable(markdown);

  const nonEmpty = markdownWords >= 45 || plain.length >= 260;
  const coverageOk = sourceLength === 0 ? markdownWords >= 45 : coverage >= 0.28;
  const titleOk = titleScore >= 0.3;

  const noiseHits = noiseScore(markdown);
  const lowSignalNoise = noiseHits >= 2 && markdownWords < 200;
  const blockedPage = HARD_BLOCK_PATTERNS.some((pattern) => pattern.test(markdown));
  const d3SelectHits = (markdown.match(/d3\.select\(/gi) ?? []).length;
  const d3AttrHits = (markdown.match(/\.attr\(/gi) ?? []).length;
  const embedScriptNoise = markdownWords > 8000 && d3SelectHits >= 5 && d3AttrHits >= 15;

  let score = 0;
  if (nonEmpty) score += 0.28;
  if (coverageOk) score += 0.24;
  if (titleOk) score += 0.16;
  if (listsOk) score += 0.11;
  if (codeOk) score += 0.1;
  if (tableOk) score += 0.08;
  if (!lowSignalNoise) score += 0.03;
  if (blockedPage) score = Math.min(score, 0.2);
  if (embedScriptNoise) score = Math.min(score, 0.2);

  const reasons: string[] = [];
  if (!nonEmpty) reasons.push('markdown_too_short');
  if (!coverageOk) reasons.push('coverage_too_low');
  if (!titleOk) reasons.push('title_mismatch');
  if (!listsOk) reasons.push('list_loss');
  if (!codeOk) reasons.push('code_loss');
  if (!tableOk) reasons.push('table_loss');
  if (lowSignalNoise) reasons.push('boilerplate_noise');
  if (blockedPage) reasons.push('blocked_or_captcha_page');
  if (embedScriptNoise) reasons.push('embed_script_noise');

  const passed = nonEmpty && coverageOk && !blockedPage && !embedScriptNoise && score >= 0.62;

  return {
    passed,
    score: Number(score.toFixed(3)),
    coverage: Number(coverage.toFixed(3)),
    reasons,
  };
}
