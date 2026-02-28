import { extractMainContent, type ExtractedMainContent } from '@/lib/with-md/web2md/extract-main-content';
import {
  assertPublicHttpTarget,
  safeFetchText,
  looksLikeHtml,
  looksLikeMarkdown,
} from '@/lib/with-md/web2md/fetch-safe';
import { htmlToMarkdown, stripMarkdownSyntax } from '@/lib/with-md/web2md/html-to-markdown';
import { fetchViaFirecrawlMarkdown } from '@/lib/with-md/web2md/providers/firecrawl';
import { fetchWithJina } from '@/lib/with-md/web2md/providers/jina';
import { distillWithOpenRouter } from '@/lib/with-md/web2md/providers/openrouter-distill';
import { evaluateMarkdownQuality, type QualityGateResult } from '@/lib/with-md/web2md/quality-gate';
import {
  buildWeb2MdSourceHeaders,
  DEFAULT_WEB2MD_ACCEPT_LANGUAGE,
  DEFAULT_WEB2MD_USER_AGENT,
} from '@/lib/with-md/web2md/request-headers';

export type Web2MdEngine =
  | 'local_heuristic'
  | 'openrouter_gpt_oss_20b'
  | 'jina_reader'
  | 'firecrawl_scrape';

export interface Web2MdAttempt {
  engine: Web2MdEngine;
  passed: boolean;
  score?: number;
  coverage?: number;
  reason?: string;
  error?: string;
}

export interface Web2MdPipelineResult {
  title: string;
  markdown: string;
  engine: Web2MdEngine;
  sourceDetail?: string;
  httpStatus?: number;
  contentType?: string;
  tokenEstimate?: number;
  quality: QualityGateResult;
  attempts: Web2MdAttempt[];
}

export interface RunWeb2MdPipelineOptions {
  targetUrl: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
}

interface Candidate {
  engine: Web2MdEngine;
  markdown: string;
  title: string;
  sourceDetail?: string;
  httpStatus?: number;
  contentType?: string;
  tokenEstimate?: number;
  quality: QualityGateResult;
}

interface PipelineEnvControls {
  disableLocal: boolean;
  disableOpenRouter: boolean;
  disableJina: boolean;
  disableFirecrawl: boolean;
  forceEngine: Web2MdEngine | null;
}

const JINA_BLOCKING_WARNING_PATTERNS = [
  /captcha/i,
  /authorized to access this page/i,
  /too many requests/i,
  /rate limit/i,
  /not yet fully loaded/i,
];

const BEST_EFFORT_HARD_REASONS = new Set([
  'blocked_or_captcha_page',
  'coverage_too_low',
  'markdown_too_short',
]);

const BEST_EFFORT_SOFT_REASONS = new Set([
  'title_mismatch',
  'list_loss',
  'code_loss',
  'table_loss',
  'boilerplate_noise',
]);

function normalizeMarkdown(markdown: string): string {
  const normalized = markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized ? `${normalized}\n` : '';
}

function normalizeTitleKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveTitleFromMarkdown(markdown: string): string | null {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading?.[1]) {
      const value = heading[1].trim();
      return value ? value : null;
    }

    const plain = line.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').trim();
    if (plain && plain.length >= 8) {
      return plain.slice(0, 180);
    }
  }

  return null;
}

function ensureLeadingTitleHeading(markdown: string, title: string | undefined): string {
  const cleanTitle = (title ?? '').trim();
  if (!cleanTitle || cleanTitle.toLowerCase() === 'untitled') {
    return markdown;
  }

  const normalized = normalizeMarkdown(markdown);
  if (!normalized) {
    return `# ${cleanTitle}\n`;
  }

  const lines = normalized.replace(/\r\n/g, '\n').split('\n');
  let firstTextIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim()) {
      firstTextIndex = i;
      break;
    }
  }
  if (firstTextIndex < 0) {
    return `# ${cleanTitle}\n`;
  }

  const firstLine = lines[firstTextIndex].trim();
  const firstHeading = firstLine.match(/^#{1,6}\s+(.+)$/);
  const titleKey = normalizeTitleKey(cleanTitle);

  if (firstHeading?.[1]) {
    const firstHeadingKey = normalizeTitleKey(firstHeading[1]);
    if (firstHeadingKey === titleKey || firstHeadingKey.includes(titleKey) || titleKey.includes(firstHeadingKey)) {
      return normalized;
    }
  }

  if (!firstHeading) {
    const firstLineKey = normalizeTitleKey(firstLine);
    if (firstLineKey === titleKey || firstLineKey.includes(titleKey) || titleKey.includes(firstLineKey)) {
      lines[firstTextIndex] = `# ${cleanTitle}`;
      return normalizeMarkdown(lines.join('\n'));
    }
  }

  return normalizeMarkdown(`# ${cleanTitle}\n\n${normalized}`);
}

function evaluateCandidate(markdown: string, extraction: ExtractedMainContent | null): QualityGateResult {
  return evaluateMarkdownQuality({
    markdown,
    sourceText: extraction?.text,
    sourceTitle: extraction?.title,
    structure: extraction?.structure,
  });
}

function isLikelyHuggingFaceSpace(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host.endsWith('huggingface.co') && parsed.pathname.startsWith('/spaces/');
  } catch {
    return false;
  }
}

function extractIframeSrc(html: string, baseUrl: string): string | null {
  const match = html.match(/<iframe[^>]+src=(['"])([^'"]+)\1/i);
  if (!match || !match[2]) return null;
  try {
    return new URL(match[2], baseUrl).toString();
  } catch {
    return null;
  }
}

function extractIframeUrlFromSourceDetail(sourceDetail: string | undefined): string | null {
  if (!sourceDetail) return null;
  const match = sourceDetail.match(/(?:^|;)iframe=([^;]+)/i);
  if (!match || !match[1]) return null;
  const value = match[1].trim();
  return value || null;
}

function stripHfSpaceBoilerplate(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<div[^>]*class=(['"])[^'"]*\bbox-text\b[^'"]*\1[^>]*>[\s\S]*?<\/div>/gi, ' ');
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function chooseBest(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.quality.score - a.quality.score)[0] ?? null;
}

function hasBlockingJinaWarning(warnings: string[]): boolean {
  return warnings.some((warning) => JINA_BLOCKING_WARNING_PATTERNS.some((pattern) => pattern.test(warning)));
}

function canAcceptBestEffort(quality: QualityGateResult): boolean {
  if (quality.passed) return true;
  if (quality.score < 0.72) return false;
  if (quality.reasons.some((reason) => BEST_EFFORT_HARD_REASONS.has(reason))) return false;
  return quality.reasons.every((reason) => BEST_EFFORT_SOFT_REASONS.has(reason));
}

function envEnabled(name: string): boolean {
  return (process.env[name] ?? '').trim() === '1';
}

function parseForceEngine(raw: string | undefined): Web2MdEngine | null {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'local' || value === 'local_heuristic') return 'local_heuristic';
  if (value === 'openrouter' || value === 'openrouter_gpt_oss_20b' || value === 'gpt-oss-20b') return 'openrouter_gpt_oss_20b';
  if (value === 'jina' || value === 'jina_reader') return 'jina_reader';
  if (value === 'firecrawl' || value === 'firecrawl_scrape') return 'firecrawl_scrape';
  return null;
}

function readPipelineEnvControls(): PipelineEnvControls {
  return {
    disableLocal: envEnabled('WITHMD_WEB2MD_DISABLE_LOCAL'),
    disableOpenRouter: envEnabled('WITHMD_WEB2MD_DISABLE_OPENROUTER'),
    disableJina: envEnabled('WITHMD_WEB2MD_DISABLE_JINA'),
    disableFirecrawl: envEnabled('WITHMD_WEB2MD_DISABLE_FIRECRAWL'),
    forceEngine: parseForceEngine(process.env.WITHMD_WEB2MD_FORCE_ENGINE),
  };
}

function stageAllowed(engine: Web2MdEngine, controls: PipelineEnvControls): { allowed: boolean; reason?: string } {
  if (controls.forceEngine && controls.forceEngine !== engine) {
    return { allowed: false, reason: `forced_to_${controls.forceEngine}` };
  }
  if (engine === 'local_heuristic' && controls.disableLocal) return { allowed: false, reason: 'disabled_by_env' };
  if (engine === 'openrouter_gpt_oss_20b' && controls.disableOpenRouter) return { allowed: false, reason: 'disabled_by_env' };
  if (engine === 'jina_reader' && controls.disableJina) return { allowed: false, reason: 'disabled_by_env' };
  if (engine === 'firecrawl_scrape' && controls.disableFirecrawl) return { allowed: false, reason: 'disabled_by_env' };
  return { allowed: true };
}

function buildHeuristicHeaders(targetUrl: string): Record<string, string> {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    ...buildWeb2MdSourceHeaders(targetUrl, {
      defaultUserAgent: DEFAULT_WEB2MD_USER_AGENT,
      defaultAcceptLanguage: DEFAULT_WEB2MD_ACCEPT_LANGUAGE,
    }),
  };
}

function toAttempt(candidate: Candidate): Web2MdAttempt {
  return {
    engine: candidate.engine,
    passed: candidate.quality.passed,
    score: candidate.quality.score,
    coverage: candidate.quality.coverage,
    reason: candidate.quality.reasons.join(',') || undefined,
  };
}

function toPipelineResult(candidate: Candidate, attempts: Web2MdAttempt[]): Web2MdPipelineResult {
  return {
    title: candidate.title,
    markdown: candidate.markdown,
    engine: candidate.engine,
    sourceDetail: candidate.sourceDetail,
    httpStatus: candidate.httpStatus,
    contentType: candidate.contentType,
    tokenEstimate: candidate.tokenEstimate,
    quality: candidate.quality,
    attempts,
  };
}

function shouldReturnCandidate(candidate: Candidate, controls: PipelineEnvControls): boolean {
  if (controls.forceEngine === candidate.engine) return true;
  return !controls.forceEngine && candidate.quality.passed;
}

function recordCandidate(
  candidate: Candidate,
  candidates: Candidate[],
  attempts: Web2MdAttempt[],
): void {
  candidates.push(candidate);
  attempts.push(toAttempt(candidate));
}

async function runLocalHeuristic(targetUrl: string): Promise<{
  candidate: Candidate;
  extraction: ExtractedMainContent | null;
}> {
  const headers = buildHeuristicHeaders(targetUrl);
  const response = await safeFetchText(targetUrl, {
    timeoutMs: 18000,
    maxBytes: 3 * 1024 * 1024,
    headers,
  });

  if (response.status >= 400) {
    throw new Error(`Origin returned HTTP ${response.status}`);
  }

  if (looksLikeMarkdown(response.contentType)) {
    const baseMarkdown = normalizeMarkdown(response.body);
    const derivedTitle = deriveTitleFromMarkdown(baseMarkdown) || 'Untitled';
    const markdown = ensureLeadingTitleHeading(baseMarkdown, derivedTitle);
    const fallbackText = stripMarkdownSyntax(markdown);
    const quality = evaluateMarkdownQuality({
      markdown,
      sourceText: fallbackText,
      sourceTitle: undefined,
      structure: undefined,
    });

    return {
      candidate: {
        engine: 'local_heuristic',
        markdown,
        title: derivedTitle,
        sourceDetail: 'native_markdown_response',
        httpStatus: response.status,
        contentType: response.contentType,
        quality,
      },
      extraction: null,
    };
  }

  if (!looksLikeHtml(response.contentType, response.body)) {
    throw new Error(`Unsupported content type from origin: ${response.contentType || 'unknown'}`);
  }

  const extraction = extractMainContent(response.body, response.finalUrl);
  const markdown = ensureLeadingTitleHeading(
    normalizeMarkdown(htmlToMarkdown(extraction.html, extraction.title)),
    extraction.title,
  );
  let candidate: Candidate = {
    engine: 'local_heuristic',
    markdown,
    title: extraction.title,
    sourceDetail: 'readability+node-html-markdown',
    httpStatus: response.status,
    contentType: response.contentType,
    quality: evaluateCandidate(markdown, extraction),
  };
  let chosenExtraction: ExtractedMainContent | null = extraction;

  if (isLikelyHuggingFaceSpace(response.finalUrl) && !candidate.quality.passed) {
    const iframeUrl = extractIframeSrc(response.body, response.finalUrl);
    if (iframeUrl) {
      try {
        const iframeResponse = await safeFetchText(iframeUrl, {
          timeoutMs: 26000,
          maxBytes: 4 * 1024 * 1024,
          headers: buildHeuristicHeaders(iframeUrl),
        });
        if (iframeResponse.status < 400 && looksLikeHtml(iframeResponse.contentType, iframeResponse.body)) {
          const iframeHtml = stripHfSpaceBoilerplate(iframeResponse.body);
          const iframeExtraction = extractMainContent(iframeHtml, iframeResponse.finalUrl);
          const iframeMarkdown = ensureLeadingTitleHeading(
            normalizeMarkdown(htmlToMarkdown(iframeExtraction.html, iframeExtraction.title)),
            iframeExtraction.title,
          );
          const iframeQuality = evaluateCandidate(iframeMarkdown, iframeExtraction);
          if (iframeQuality.score > candidate.quality.score || iframeQuality.passed) {
            candidate = {
              engine: 'local_heuristic',
              markdown: iframeMarkdown,
              title: iframeExtraction.title,
              sourceDetail: `readability+node-html-markdown;iframe=${iframeResponse.finalUrl}`,
              httpStatus: iframeResponse.status,
              contentType: iframeResponse.contentType,
              quality: iframeQuality,
            };
            chosenExtraction = iframeExtraction;
          }
        }
      } catch {
        // Ignore iframe fallback errors; keep primary extraction result.
      }
    }
  }

  return {
    candidate,
    extraction: chosenExtraction,
  };
}

export async function runWeb2MdPipeline(options: RunWeb2MdPipelineOptions): Promise<Web2MdPipelineResult> {
  await assertPublicHttpTarget(options.targetUrl);
  const controls = readPipelineEnvControls();

  const attempts: Web2MdAttempt[] = [];
  const candidates: Candidate[] = [];

  let extraction: ExtractedMainContent | null = null;
  let localCandidate: Candidate | null = null;

  const localStage = stageAllowed('local_heuristic', controls);
  const runLocalAsOpenRouterInput = controls.forceEngine === 'openrouter_gpt_oss_20b' && !controls.disableLocal;
  const localAllowed = localStage.allowed || runLocalAsOpenRouterInput;

  if (!localAllowed) {
    attempts.push({
      engine: 'local_heuristic',
      passed: false,
      reason: localStage.reason,
    });
  } else {
    try {
      const local = await runLocalHeuristic(options.targetUrl);
      localCandidate = local.candidate;
      extraction = local.extraction;
      recordCandidate(local.candidate, candidates, attempts);
      if (shouldReturnCandidate(local.candidate, controls)) {
        return toPipelineResult(local.candidate, attempts);
      }
    } catch (error) {
      attempts.push({
        engine: 'local_heuristic',
        passed: false,
        error: asErrorMessage(error),
      });
      if (controls.forceEngine === 'local_heuristic') {
        throw new Error(`Forced engine local_heuristic failed: ${asErrorMessage(error)}`);
      }
    }
  }

  const openRouterStage = stageAllowed('openrouter_gpt_oss_20b', controls);
  const openRouterApiKey = options.openRouterApiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim() || '';
  if (!openRouterStage.allowed) {
    attempts.push({
      engine: 'openrouter_gpt_oss_20b',
      passed: false,
      reason: openRouterStage.reason,
    });
  } else if (!openRouterApiKey) {
    attempts.push({
      engine: 'openrouter_gpt_oss_20b',
      passed: false,
      reason: 'missing_openrouter_api_key',
    });
    if (controls.forceEngine === 'openrouter_gpt_oss_20b') {
      throw new Error('Forced engine openrouter_gpt_oss_20b requires OPENROUTER_API_KEY.');
    }
  } else if (!extraction && !localCandidate?.markdown) {
    attempts.push({
      engine: 'openrouter_gpt_oss_20b',
      passed: false,
      reason: 'missing_source_material',
    });
    if (controls.forceEngine === 'openrouter_gpt_oss_20b') {
      throw new Error('Forced engine openrouter_gpt_oss_20b is missing source material.');
    }
  } else {
    try {
      const draftMarkdown = localCandidate?.markdown || '';
      const sourceText = extraction?.text || stripMarkdownSyntax(draftMarkdown);
      const title = extraction?.title || localCandidate?.title || 'Untitled';

      const distilled = await distillWithOpenRouter({
        targetUrl: options.targetUrl,
        sourceTitle: title,
        sourceText,
        draftMarkdown,
        apiKey: openRouterApiKey,
        model: options.openRouterModel,
      });

      const markdown = ensureLeadingTitleHeading(normalizeMarkdown(distilled.markdown), title);
      const quality = evaluateCandidate(markdown, extraction);
      const candidate: Candidate = {
        engine: 'openrouter_gpt_oss_20b',
        markdown,
        title,
        sourceDetail: 'openrouter:model=openai/gpt-oss-20b,provider=groq',
        tokenEstimate: distilled.tokenEstimate,
        quality,
      };
      recordCandidate(candidate, candidates, attempts);
      if (shouldReturnCandidate(candidate, controls)) {
        return toPipelineResult(candidate, attempts);
      }
    } catch (error) {
      attempts.push({
        engine: 'openrouter_gpt_oss_20b',
        passed: false,
        error: asErrorMessage(error),
      });
      if (controls.forceEngine === 'openrouter_gpt_oss_20b') {
        throw new Error(`Forced engine openrouter_gpt_oss_20b failed: ${asErrorMessage(error)}`);
      }
    }
  }

  const jinaStage = stageAllowed('jina_reader', controls);
  if (!jinaStage.allowed) {
    attempts.push({
      engine: 'jina_reader',
      passed: false,
      reason: jinaStage.reason,
    });
  } else {
    try {
      const jina = await fetchWithJina(options.targetUrl);
      if (hasBlockingJinaWarning(jina.warnings)) {
        const iframeUrl = extractIframeUrlFromSourceDetail(localCandidate?.sourceDetail);
        if (iframeUrl) {
          const iframeJina = await fetchWithJina(iframeUrl);
          if (hasBlockingJinaWarning(iframeJina.warnings)) {
            attempts.push({
              engine: 'jina_reader',
              passed: false,
              reason: 'jina_reported_blocked_or_unloaded_page',
            });
            if (controls.forceEngine === 'jina_reader') {
              throw new Error('Forced engine jina_reader returned blocked/unloaded warning.');
            }
          } else {
            const roughTitle = extraction?.title || localCandidate?.title || deriveTitleFromMarkdown(iframeJina.markdown) || 'Untitled';
            const markdown = ensureLeadingTitleHeading(normalizeMarkdown(iframeJina.markdown), roughTitle);
            const quality = evaluateCandidate(markdown, extraction);
            const candidate: Candidate = {
              engine: 'jina_reader',
              markdown,
              title: roughTitle,
              sourceDetail: `https://r.jina.ai;via_iframe=${iframeUrl}`,
              quality,
            };
            recordCandidate(candidate, candidates, attempts);
            if (shouldReturnCandidate(candidate, controls)) {
              return toPipelineResult(candidate, attempts);
            }
          }
        } else {
          attempts.push({
            engine: 'jina_reader',
            passed: false,
            reason: 'jina_reported_blocked_or_unloaded_page',
          });
          if (controls.forceEngine === 'jina_reader') {
            throw new Error('Forced engine jina_reader returned blocked/unloaded warning.');
          }
        }
      } else {
        const roughTitle = extraction?.title || localCandidate?.title || deriveTitleFromMarkdown(jina.markdown) || 'Untitled';
        const markdown = ensureLeadingTitleHeading(normalizeMarkdown(jina.markdown), roughTitle);
        const quality = evaluateCandidate(markdown, extraction);
        const candidate: Candidate = {
          engine: 'jina_reader',
          markdown,
          title: roughTitle,
          sourceDetail: jina.warnings.length > 0 ? `https://r.jina.ai;warnings=${jina.warnings.length}` : 'https://r.jina.ai',
          quality,
        };
        recordCandidate(candidate, candidates, attempts);
        if (shouldReturnCandidate(candidate, controls)) {
          return toPipelineResult(candidate, attempts);
        }
      }
    } catch (error) {
      attempts.push({
        engine: 'jina_reader',
        passed: false,
        error: asErrorMessage(error),
      });
      if (controls.forceEngine === 'jina_reader') {
        throw new Error(`Forced engine jina_reader failed: ${asErrorMessage(error)}`);
      }
    }
  }

  const firecrawlStage = stageAllowed('firecrawl_scrape', controls);
  const firecrawlApiKey = process.env.WITHMD_WEB2MD_FIRECRAWL_API_KEY?.trim() || '';
  if (!firecrawlStage.allowed) {
    attempts.push({
      engine: 'firecrawl_scrape',
      passed: false,
      reason: firecrawlStage.reason,
    });
  } else if (!firecrawlApiKey) {
    attempts.push({
      engine: 'firecrawl_scrape',
      passed: false,
      reason: 'missing_firecrawl_api_key',
    });
    if (controls.forceEngine === 'firecrawl_scrape') {
      throw new Error('Forced engine firecrawl_scrape requires WITHMD_WEB2MD_FIRECRAWL_API_KEY.');
    }
  } else {
    try {
      const firecrawl = await fetchViaFirecrawlMarkdown(options.targetUrl, { apiKey: firecrawlApiKey });
      const roughTitle = extraction?.title || localCandidate?.title || deriveTitleFromMarkdown(firecrawl.markdown) || 'Untitled';
      const markdown = ensureLeadingTitleHeading(normalizeMarkdown(firecrawl.markdown), roughTitle);
      const quality = evaluateCandidate(markdown, extraction);
      const candidate: Candidate = {
        engine: 'firecrawl_scrape',
        markdown,
        title: roughTitle,
        sourceDetail: firecrawl.detail,
        httpStatus: firecrawl.status,
        contentType: firecrawl.contentType,
        quality,
      };
      recordCandidate(candidate, candidates, attempts);
      if (shouldReturnCandidate(candidate, controls)) {
        return toPipelineResult(candidate, attempts);
      }
    } catch (error) {
      attempts.push({
        engine: 'firecrawl_scrape',
        passed: false,
        error: asErrorMessage(error),
      });
      if (controls.forceEngine === 'firecrawl_scrape') {
        throw new Error(`Forced engine firecrawl_scrape failed: ${asErrorMessage(error)}`);
      }
    }
  }

  if (controls.forceEngine) {
    throw new Error(`Forced engine ${controls.forceEngine} did not produce an accepted markdown result.`);
  }

  const best = chooseBest(candidates);
  if (best && canAcceptBestEffort(best.quality)) {
    return toPipelineResult(best, attempts);
  }

  const error = attempts
    .map((attempt) => `${attempt.engine}:${attempt.error || attempt.reason || 'failed'}`)
    .join(' | ');
  throw new Error(`All conversion stages failed quality checks. ${error}`);
}
