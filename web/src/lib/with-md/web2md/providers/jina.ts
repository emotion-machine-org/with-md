import { safeFetchText } from '@/lib/with-md/web2md/fetch-safe';

export interface JinaResult {
  markdown: string;
  finalUrl: string;
  warnings: string[];
}

const DEFAULT_TIMEOUT_MS = 35_000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function isRetriableJinaStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function buildJinaReaderUrl(targetUrl: string): string {
  if (targetUrl.startsWith('https://')) {
    return `https://r.jina.ai/https://${targetUrl.slice('https://'.length)}`;
  }
  if (targetUrl.startsWith('http://')) {
    return `https://r.jina.ai/http://${targetUrl.slice('http://'.length)}`;
  }
  return `https://r.jina.ai/http://${targetUrl}`;
}

function normalizeLines(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeJinaMarkdown(raw: string): { markdown: string; warnings: string[] } {
  const normalized = normalizeLines(raw);
  if (!normalized) {
    return { markdown: '', warnings: [] };
  }

  const warnings: string[] = [];
  for (const match of normalized.matchAll(/^\s*warning:\s*(.+)$/gim)) {
    const warning = (match[1] ?? '').trim();
    if (warning) warnings.push(warning);
  }

  let body = normalized;
  const marker = /(?:^|\n)\s*markdown content:\s*/i;
  if (marker.test(body)) {
    const split = body.split(marker);
    body = split[split.length - 1] ?? body;
  }

  const cleaned = body
    .split('\n')
    .filter((line) => !/^\s*(url source|warning)\s*:/i.test(line))
    .join('\n');

  const markdown = normalizeLines(cleaned);
  return {
    markdown: markdown ? `${markdown}\n` : '',
    warnings,
  };
}

export async function fetchWithJina(targetUrl: string): Promise<JinaResult> {
  const url = buildJinaReaderUrl(targetUrl);
  const headers: Record<string, string> = {
    Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.8',
  };

  const key = process.env.WITHMD_WEB2MD_JINA_API_KEY?.trim();
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  const baseTimeoutMs = parsePositiveInt(process.env.WITHMD_WEB2MD_JINA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const timeoutPlan = [baseTimeoutMs, Math.min(baseTimeoutMs * 2, 60_000)];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < timeoutPlan.length; attempt += 1) {
    try {
      const response = await safeFetchText(url, {
        timeoutMs: timeoutPlan[attempt],
        maxBytes: 2 * 1024 * 1024,
        maxRedirects: 2,
        headers: {
          ...headers,
        },
      });

      if (response.status >= 400) {
        if (attempt < timeoutPlan.length - 1 && isRetriableJinaStatus(response.status)) {
          continue;
        }
        throw new Error(`Jina request failed with ${response.status}`);
      }

      const parsed = sanitizeJinaMarkdown(response.body);
      if (!parsed.markdown.trim()) {
        if (attempt < timeoutPlan.length - 1) {
          continue;
        }
        throw new Error('Jina returned empty markdown.');
      }

      return {
        markdown: parsed.markdown,
        finalUrl: response.finalUrl || url,
        warnings: parsed.warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const retryable = /aborted|timeout|timed out/i.test(message);
      if (attempt < timeoutPlan.length - 1 && retryable) {
        lastError = error instanceof Error ? error : new Error(message);
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('Jina request failed.');
}
