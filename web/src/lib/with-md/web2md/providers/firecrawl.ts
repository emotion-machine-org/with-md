import {
  buildWeb2MdSourceHeaders,
  DEFAULT_WEB2MD_ACCEPT_LANGUAGE,
  DEFAULT_WEB2MD_USER_AGENT,
} from '@/lib/with-md/web2md/request-headers';

export interface FirecrawlMarkdownResult {
  markdown: string;
  finalUrl: string;
  status: number;
  contentType: string;
  detail?: string;
}

interface FetchViaFirecrawlOptions {
  apiKey?: string;
}

interface FirecrawlResponseBody {
  success?: boolean;
  error?: string;
  message?: string;
  data?: {
    markdown?: string;
    warning?: string | null;
    metadata?: {
      url?: string;
      sourceURL?: string;
      statusCode?: number;
      error?: string | null;
    };
  };
}

const DEFAULT_API_BASE = 'https://api.firecrawl.dev/v2';
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_WAIT_FOR_MS = 0;
const DEFAULT_MAX_AGE_MS = 0;

type FirecrawlProxy = 'basic' | 'enhanced' | 'auto';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function readFirecrawlProxy(raw: string | undefined): FirecrawlProxy {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'basic' || value === 'enhanced' || value === 'auto') {
    return value;
  }
  return 'auto';
}

function extractErrorMessage(data: FirecrawlResponseBody | null, status: number): string {
  const message = data?.error || data?.message || data?.data?.metadata?.error || 'Unknown error';
  return `Firecrawl scrape failed with HTTP ${status}: ${message}`;
}

export async function fetchViaFirecrawlMarkdown(
  targetUrl: string,
  options: FetchViaFirecrawlOptions = {},
): Promise<FirecrawlMarkdownResult> {
  const apiKey = options.apiKey?.trim() || process.env.WITHMD_WEB2MD_FIRECRAWL_API_KEY?.trim() || '';
  if (!apiKey) {
    throw new Error('Missing Firecrawl API key.');
  }

  const apiBase = (process.env.WITHMD_WEB2MD_FIRECRAWL_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '');
  const timeout = Math.min(
    Math.max(1, parsePositiveInt(process.env.WITHMD_WEB2MD_FIRECRAWL_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
    300_000,
  );
  const waitFor = parsePositiveInt(process.env.WITHMD_WEB2MD_FIRECRAWL_WAIT_FOR_MS, DEFAULT_WAIT_FOR_MS);
  const maxAge = parsePositiveInt(process.env.WITHMD_WEB2MD_FIRECRAWL_MAX_AGE_MS, DEFAULT_MAX_AGE_MS);
  const proxy = readFirecrawlProxy(process.env.WITHMD_WEB2MD_FIRECRAWL_PROXY);
  const sourceHeaders = buildWeb2MdSourceHeaders(targetUrl, {
    defaultUserAgent: DEFAULT_WEB2MD_USER_AGENT,
    defaultAcceptLanguage: DEFAULT_WEB2MD_ACCEPT_LANGUAGE,
  });
  const requestTimeoutMs = Math.min(timeout + 15_000, 300_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  let response: Response;
  try {
    response = await fetch(`${apiBase}/scrape`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: targetUrl,
        formats: ['markdown'],
        onlyMainContent: true,
        removeBase64Images: true,
        blockAds: true,
        timeout,
        waitFor,
        maxAge,
        proxy,
        ...(Object.keys(sourceHeaders).length > 0 ? { headers: sourceHeaders } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/aborted|timeout/i.test(message)) {
      throw new Error(`Firecrawl request timed out after ${requestTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  const data = await response.json().catch(() => null) as FirecrawlResponseBody | null;

  if (data?.success === false) {
    throw new Error(extractErrorMessage(data, response.status));
  }

  if (!response.ok) {
    throw new Error(extractErrorMessage(data, response.status));
  }

  const markdown = data?.data?.markdown?.trim() || '';
  if (!markdown) {
    throw new Error('Firecrawl response did not include markdown.');
  }

  const finalUrl = data?.data?.metadata?.url || data?.data?.metadata?.sourceURL || targetUrl;
  const detailParts = ['firecrawl:v2/scrape', `proxy=${proxy}`, 'onlyMainContent=1'];
  if (data?.data?.warning) {
    detailParts.push('warning=present');
  }

  return {
    markdown: `${markdown}\n`,
    finalUrl,
    status: data?.data?.metadata?.statusCode ?? response.status,
    contentType,
    detail: detailParts.join(';'),
  };
}
