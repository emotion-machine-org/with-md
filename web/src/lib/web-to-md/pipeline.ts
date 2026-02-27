import { safeFetchHtml } from './safe-fetch';
import { extractFromHtml } from './extract';
import { evaluateQuality } from './quality';
import { tryBrowserFetch } from './browser-fetch';

export interface PipelineResult {
  title: string;
  markdown: string;
  sourceEngine: string;
  /** Estimated token count (rough: chars / 4) */
  tokenEstimate: number;
}

const JINA_BASE = 'https://r.jina.ai/';
const JINA_TIMEOUT_MS = 30_000;
const LOCAL_TIMEOUT_MS = 15_000;
const NATIVE_TIMEOUT_MS = 15_000;

/** Stage 1: Native markdown negotiation — some sites serve markdown directly. */
async function tryNativeMarkdown(url: string): Promise<{ markdown: string; title: string } | null> {
  try {
    const result = await safeFetchHtml(url, NATIVE_TIMEOUT_MS, {
      Accept: 'text/markdown, text/plain;q=0.9, text/html;q=0.5',
    });

    const ct = result.contentType.toLowerCase();
    // Only treat as native markdown if the server actually sent markdown or plain text
    const isMarkdownContent =
      ct.includes('text/markdown') ||
      ct.includes('text/x-markdown') ||
      (ct.includes('text/plain') && looksLikeMarkdown(result.html));

    if (!isMarkdownContent) return null;
    if (!result.html || result.html.length < 50) return null;

    const titleMatch = result.html.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim() ?? new URL(url).hostname;
    return { markdown: result.html, title };
  } catch {
    return null;
  }
}

/** Heuristic: does a plain-text response look like markdown rather than prose? */
function looksLikeMarkdown(text: string): boolean {
  const sample = text.slice(0, 2000);
  let signals = 0;
  if (/^#{1,6}\s+\S/m.test(sample)) signals++; // headings
  if (/\*\*[^*]+\*\*/.test(sample)) signals++; // bold
  if (/```/.test(sample)) signals++; // code fences
  if (/^\s*[-*+] \S/m.test(sample)) signals++; // list items
  if (/\[.+\]\(https?:/.test(sample)) signals++; // links
  return signals >= 2;
}

/** Stage 2: Local HTML extraction — SSRF-safe, no external dependency. */
async function tryLocalExtract(url: string): Promise<{ markdown: string; title: string } | null> {
  try {
    const { html, finalUrl } = await safeFetchHtml(url, LOCAL_TIMEOUT_MS);
    const { title, markdown } = extractFromHtml(html, finalUrl);
    return { markdown, title };
  } catch {
    return null;
  }
}

/** Stage 4: Jina Reader — external service, broad real-world coverage. */
async function tryJina(url: string): Promise<{ markdown: string; title: string } | null> {
  const jinaUrl = JINA_BASE + url;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(jinaUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'text/markdown, text/plain;q=0.9',
          'X-Return-Format': 'markdown',
          'X-Timeout': '25',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) return null;

    const text = await resp.text();
    if (!text || text.length < 50) return null;

    // Extract title from first H1 or markdown title line
    const titleMatch = text.match(/^#\s+(.+)$/m) ?? text.match(/^Title:\s*(.+)$/m);
    const title = titleMatch?.[1]?.trim() ?? '';

    return { markdown: text, title };
  } catch {
    return null;
  }
}

function cleanMarkdown(md: string): string {
  // Collapse 3+ newlines, trim trailing spaces per line
  let out = md.replace(/\n{3,}/g, '\n\n');
  out = out
    .split('\n')
    .map(l => l.trimEnd())
    .join('\n');
  return out.trim() + '\n';
}

function makeResult(
  data: { markdown: string; title: string },
  engine: string,
  url: string,
): PipelineResult {
  const cleaned = cleanMarkdown(data.markdown);
  return {
    title: data.title || new URL(url).hostname,
    markdown: cleaned,
    sourceEngine: engine,
    tokenEstimate: Math.ceil(cleaned.length / 4),
  };
}

export async function runPipeline(url: string): Promise<PipelineResult> {
  // Stage 1: Native markdown negotiation (fastest, zero extraction overhead)
  const native = await tryNativeMarkdown(url);
  if (native) {
    const quality = evaluateQuality(native.markdown);
    if (quality.passed) {
      return makeResult(native, 'native_markdown', url);
    }
  }

  // Stage 2: Local HTML extraction (SSRF-safe, no external deps)
  const local = await tryLocalExtract(url);
  if (local) {
    const quality = evaluateQuality(local.markdown);
    if (quality.passed) {
      return makeResult(local, 'local_extract', url);
    }
  }

  // Stage 3: Browser-rendered fallback (handles JS-heavy SPAs)
  // Gracefully skips if playwright is not installed; see browser-fetch.ts
  const browser = await tryBrowserFetch(url);
  if (browser) {
    const quality = evaluateQuality(browser.markdown);
    if (quality.passed) {
      return makeResult(browser, 'browser', url);
    }
  }

  // Stage 4: Jina Reader (external service, broadest coverage)
  const jina = await tryJina(url);
  if (jina) {
    const quality = evaluateQuality(jina.markdown);
    if (quality.passed) {
      return makeResult(jina, 'jina', url);
    }
  }

  // Fallback: return best available even if quality gate failed
  // Priority: jina > browser > local > native (external tends to be highest quality)
  const candidates: Array<[{ markdown: string; title: string } | null, string]> = [
    [jina, 'jina_low_quality'],
    [browser, 'browser_low_quality'],
    [local, 'local_extract_low_quality'],
    [native, 'native_markdown_low_quality'],
  ];

  for (const [candidate, engine] of candidates) {
    if (candidate && candidate.markdown.trim().length > 0) {
      return makeResult(candidate, engine, url);
    }
  }

  throw new Error('All extraction strategies failed or returned empty content');
}
