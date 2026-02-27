/**
 * Quality gate: lightweight heuristics ported from webtomd/evaluate/heuristics.py
 */

const MD_SYNTAX_RE = /[#*_`~>\-\[\]()|]/g;

function stripMdSyntax(md: string): string {
  return md.replace(MD_SYNTAX_RE, '').replace(/\s+/g, ' ').trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function hasTables(md: string): boolean {
  return md.includes('|') && md.includes('---');
}

function hasCodeBlocks(md: string): boolean {
  return md.includes('```');
}

function countListItems(md: string): number {
  return (md.match(/^\s*[-*+] /gm) ?? []).length + (md.match(/^\s*\d+\. /gm) ?? []).length;
}

export interface QualityReport {
  passed: boolean;
  score: number;
  reason?: string;
}

export interface QualityOptions {
  /** Minimum word count in stripped markdown */
  minWords?: number;
  /** Minimum word count relative to source text (0–1) */
  minCoverage?: number;
  /** Whether source had tables */
  sourceTables?: boolean;
  /** Whether source had code blocks */
  sourceCode?: boolean;
  /** Approximate source list item count */
  sourceListItems?: number;
}

/**
 * Evaluate markdown quality.
 * @param md Markdown string to evaluate
 * @param opts Optional source metadata for cross-checks
 */
export function evaluateQuality(md: string, opts: QualityOptions = {}): QualityReport {
  const {
    minWords = 30,
    minCoverage = 0.25,
    sourceTables,
    sourceCode,
    sourceListItems,
  } = opts;

  const strippedMd = stripMdSyntax(md);
  const words = wordCount(strippedMd);

  // Minimum length floor
  if (words < minWords) {
    return { passed: false, score: 0, reason: `too_short: ${words} words` };
  }

  let score = 1.0;

  // Coverage check (if source text provided)
  if (opts.minCoverage !== undefined && strippedMd.length < 50) {
    score = Math.min(score, strippedMd.length / 200);
  }

  // Table parity
  if (sourceTables && !hasTables(md)) {
    score *= 0.6;
  }

  // Code parity
  if (sourceCode && !hasCodeBlocks(md)) {
    score *= 0.8;
  }

  // List parity
  if (sourceListItems && sourceListItems >= 5) {
    const mdListItems = countListItems(md);
    if (mdListItems < Math.max(1, Math.floor(0.7 * sourceListItems))) {
      score *= 0.7;
    }
  }

  if (score < minCoverage) {
    return { passed: false, score, reason: `low_score: ${score.toFixed(2)}` };
  }

  return { passed: true, score };
}
