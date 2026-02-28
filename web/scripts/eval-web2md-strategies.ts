import fs from 'node:fs';
import path from 'node:path';

import { stripMarkdownSyntax } from '@/lib/with-md/web2md/html-to-markdown';
import { runWeb2MdPipeline, type Web2MdEngine } from '@/lib/with-md/web2md/pipeline';

type EngineLabel = Web2MdEngine | 'auto_pipeline';

type EngineResult = {
  engine: EngineLabel;
  ok: boolean;
  error?: string;
  title?: string;
  markdown?: string;
  pipelineQuality?: number;
  pipelinePassed?: boolean;
  pipelineReasons?: string[];
  overlapScore?: number;
  tokenRecallVsJina?: number;
  headingRecallVsJina?: number;
  linkRecallVsJina?: number;
  lengthRatioVsJina?: number;
  words?: number;
  links?: number;
  headings?: number;
};

type UrlResult = {
  url: string;
  baselineEngine: Web2MdEngine;
  baselineWords: number;
  engines: EngineResult[];
};

const DEFAULT_URLS = [
  'https://web4.ai',
  'https://huggingface.co/spaces/lm-provers/qed-nano-blogpost#introducing-qed-nano-a-4b-model-for-olympiad-level-proofs',
  'https://bwarburg.substack.com/p/the-new-primitives',
];

const ALL_ENGINES: Web2MdEngine[] = [
  'local_heuristic',
  'openrouter_gpt_oss_20b',
  'jina_reader',
  'firecrawl_scrape',
];

interface CliArgs {
  urls: string[];
  engines: Web2MdEngine[];
  includeAuto: boolean;
  jsonOut?: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
}

interface ParsedMarkdown {
  text: string;
  words: number;
  headings: Set<string>;
  links: Set<string>;
  tokens: Set<string>;
}

function parseArgs(argv: string[]): CliArgs {
  const urls: string[] = [];
  let engines = [...ALL_ENGINES];
  let includeAuto = true;
  let jsonOut: string | undefined;
  let openRouterApiKey: string | undefined;
  let openRouterModel: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url' && argv[i + 1]) {
      urls.push(normalizeUrlInput(argv[i + 1]));
      i += 1;
      continue;
    }
    if (arg === '--engines' && argv[i + 1]) {
      const requested = argv[i + 1].split(',').map((v) => v.trim()).filter(Boolean);
      const filtered = requested.filter((value): value is Web2MdEngine => ALL_ENGINES.includes(value as Web2MdEngine));
      if (filtered.length > 0) {
        engines = filtered;
      }
      i += 1;
      continue;
    }
    if (arg === '--json' && argv[i + 1]) {
      jsonOut = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--no-auto') {
      includeAuto = false;
      continue;
    }
    if (arg === '--openrouter-key' && argv[i + 1]) {
      openRouterApiKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--openrouter-model' && argv[i + 1]) {
      openRouterModel = argv[i + 1];
      i += 1;
      continue;
    }
  }

  return {
    urls: urls.length > 0 ? urls : [...DEFAULT_URLS],
    engines,
    includeAuto,
    jsonOut,
    openRouterApiKey,
    openRouterModel,
  };
}

function normalizeUrlInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('https:/') && !trimmed.startsWith('https://')) {
    return trimmed.replace(/^https:\//, 'https://');
  }
  if (trimmed.startsWith('http:/') && !trimmed.startsWith('http://')) {
    return trimmed.replace(/^http:\//, 'http://');
  }
  return trimmed;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectHeadingSet(markdown: string): Set<string> {
  const headings = new Set<string>();
  const matches = markdown.matchAll(/^#{1,6}\s+(.+)$/gm);
  for (const match of matches) {
    const raw = (match[1] ?? '').trim();
    if (!raw) continue;
    const normalized = normalizeToken(raw);
    if (normalized) headings.add(normalized);
  }
  return headings;
}

function collectLinks(markdown: string): Set<string> {
  const links = new Set<string>();
  const matches = markdown.matchAll(/\[[^\]]*]\((https?:\/\/[^)\s]+)[^)]*\)/gim);
  for (const match of matches) {
    const link = (match[1] ?? '').trim();
    if (link) links.add(link);
  }
  return links;
}

function collectTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  return new Set(tokens);
}

function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

function parseMarkdown(markdown: string): ParsedMarkdown {
  const text = stripMarkdownSyntax(markdown);
  return {
    text,
    words: countWords(text),
    headings: collectHeadingSet(markdown),
    links: collectLinks(markdown),
    tokens: collectTokens(text),
  };
}

function recall(source: Set<string>, against: Set<string>): number {
  if (against.size === 0) return source.size === 0 ? 1 : 0;
  let overlap = 0;
  for (const item of against) {
    if (source.has(item)) overlap += 1;
  }
  return overlap / Math.max(1, against.size);
}

function tokenRecall(a: Set<string>, b: Set<string>): number {
  if (b.size === 0) return a.size === 0 ? 1 : 0;
  let overlap = 0;
  for (const token of b) {
    if (a.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, b.size);
}

function lengthSimilarity(words: number, baselineWords: number): number {
  if (baselineWords <= 0) return words > 0 ? 1 : 0;
  if (words <= 0) return 0;
  const ratio = words / baselineWords;
  if (ratio <= 1) return clamp01(ratio);
  return clamp01(1 / ratio);
}

function computeOverlapScore(input: {
  tokenRecallVsJina: number;
  headingRecallVsJina: number;
  linkRecallVsJina: number;
  lengthRatioVsJina: number;
}): number {
  const score = (input.tokenRecallVsJina * 0.58)
    + (input.headingRecallVsJina * 0.18)
    + (input.linkRecallVsJina * 0.12)
    + (input.lengthRatioVsJina * 0.12);
  return Number(score.toFixed(3));
}

async function runEngineForUrl(
  url: string,
  engine: EngineLabel,
  options: { openRouterApiKey?: string; openRouterModel?: string },
): Promise<EngineResult> {
  const previousForce = process.env.WITHMD_WEB2MD_FORCE_ENGINE;
  if (engine === 'auto_pipeline') {
    delete process.env.WITHMD_WEB2MD_FORCE_ENGINE;
  } else {
    process.env.WITHMD_WEB2MD_FORCE_ENGINE = engine;
  }
  try {
    const result = await runWeb2MdPipeline({
      targetUrl: url,
      openRouterApiKey: options.openRouterApiKey,
      openRouterModel: options.openRouterModel,
    });
    const parsed = parseMarkdown(result.markdown);
    return {
      engine,
      ok: true,
      title: result.title,
      markdown: result.markdown,
      pipelineQuality: result.quality.score,
      pipelinePassed: result.quality.passed,
      pipelineReasons: result.quality.reasons,
      words: parsed.words,
      links: parsed.links.size,
      headings: parsed.headings.size,
    };
  } catch (error) {
    return {
      engine,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    if (previousForce === undefined) {
      delete process.env.WITHMD_WEB2MD_FORCE_ENGINE;
    } else {
      process.env.WITHMD_WEB2MD_FORCE_ENGINE = previousForce;
    }
  }
}

function addBaselineComparisons(
  engineResult: EngineResult,
  baselineParsed: ParsedMarkdown,
): EngineResult {
  if (!engineResult.ok || !engineResult.markdown) {
    return engineResult;
  }
  const parsed = parseMarkdown(engineResult.markdown);
  const tokenRecallVsJina = Number(tokenRecall(parsed.tokens, baselineParsed.tokens).toFixed(3));
  const headingRecallVsJina = Number(recall(parsed.headings, baselineParsed.headings).toFixed(3));
  const linkRecallVsJina = Number(recall(parsed.links, baselineParsed.links).toFixed(3));
  const lengthRatioVsJina = Number(lengthSimilarity(parsed.words, baselineParsed.words).toFixed(3));
  const overlapScore = computeOverlapScore({
    tokenRecallVsJina,
    headingRecallVsJina,
    linkRecallVsJina,
    lengthRatioVsJina,
  });
  return {
    ...engineResult,
    tokenRecallVsJina,
    headingRecallVsJina,
    linkRecallVsJina,
    lengthRatioVsJina,
    overlapScore,
  };
}

function printUrlSummary(result: UrlResult): void {
  console.log(`\n=== ${result.url} ===`);
  console.log(`baseline=${result.baselineEngine} words=${result.baselineWords}`);
  const rows = result.engines.map((engineResult) => ({
    engine: engineResult.engine,
    ok: engineResult.ok,
    q: engineResult.pipelineQuality ?? null,
    pass: engineResult.pipelinePassed ?? null,
    overlap: engineResult.overlapScore ?? null,
    tokenRecall: engineResult.tokenRecallVsJina ?? null,
    headingRecall: engineResult.headingRecallVsJina ?? null,
    linkRecall: engineResult.linkRecallVsJina ?? null,
    lenSim: engineResult.lengthRatioVsJina ?? null,
    words: engineResult.words ?? null,
    err: engineResult.error ?? null,
  }));
  console.table(rows);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const openRouterApiKey = args.openRouterApiKey || process.env.OPENROUTER_API_KEY || undefined;

  console.log('web2md strategy evaluation');
  const engineList = args.includeAuto ? ['auto_pipeline', ...args.engines] : [...args.engines];
  console.log(`urls=${args.urls.length} engines=${engineList.join(',')}`);
  if (!openRouterApiKey) {
    console.log('note: OPENROUTER key not provided; openrouter engine may fail.');
  }

  const report: UrlResult[] = [];

  for (const url of args.urls) {
    const baselineEngine: Web2MdEngine = 'jina_reader';
    const baselineResult = await runEngineForUrl(url, baselineEngine, {
      openRouterApiKey,
      openRouterModel: args.openRouterModel,
    });

    if (!baselineResult.ok || !baselineResult.markdown) {
      const fallbackEngines: EngineResult[] = [];
      if (args.includeAuto) {
        const autoResult = await runEngineForUrl(url, 'auto_pipeline', {
          openRouterApiKey,
          openRouterModel: args.openRouterModel,
        });
        fallbackEngines.push(autoResult);
      }
      for (const engine of args.engines) {
        if (engine === baselineEngine) {
          fallbackEngines.push(baselineResult);
          continue;
        }
        const result = await runEngineForUrl(url, engine, {
          openRouterApiKey,
          openRouterModel: args.openRouterModel,
        });
        fallbackEngines.push(result);
      }
      const baselineWords = 0;
      const urlResult: UrlResult = {
        url,
        baselineEngine,
        baselineWords,
        engines: fallbackEngines,
      };
      report.push(urlResult);
      printUrlSummary(urlResult);
      continue;
    }

    const baselineParsed = parseMarkdown(baselineResult.markdown);
    const engineResults: EngineResult[] = [];

    if (args.includeAuto) {
      const autoResult = await runEngineForUrl(url, 'auto_pipeline', {
        openRouterApiKey,
        openRouterModel: args.openRouterModel,
      });
      engineResults.push(addBaselineComparisons(autoResult, baselineParsed));
    }

    for (const engine of args.engines) {
      if (engine === baselineEngine) {
        engineResults.push(addBaselineComparisons(baselineResult, baselineParsed));
        continue;
      }
      const result = await runEngineForUrl(url, engine, {
        openRouterApiKey,
        openRouterModel: args.openRouterModel,
      });
      engineResults.push(addBaselineComparisons(result, baselineParsed));
    }

    const urlResult: UrlResult = {
      url,
      baselineEngine,
      baselineWords: baselineParsed.words,
      engines: engineResults,
    };
    report.push(urlResult);
    printUrlSummary(urlResult);
  }

  if (args.jsonOut) {
    const jsonPath = path.resolve(process.cwd(), args.jsonOut);
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nSaved JSON report to ${jsonPath}`);
  }
}

void main();
