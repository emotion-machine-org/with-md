export const DEFAULT_WEB2MD_USER_AGENT = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/131.0.0.0',
  'Safari/537.36',
].join(' ');

export const DEFAULT_WEB2MD_ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

interface BuildSourceHeadersOptions {
  defaultUserAgent?: string;
  defaultAcceptLanguage?: string;
}

export function buildWeb2MdSourceHeaders(
  targetUrl: string,
  options: BuildSourceHeadersOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = {};

  const userAgent = process.env.WITHMD_WEB2MD_USER_AGENT?.trim() || options.defaultUserAgent;
  if (userAgent) {
    headers['User-Agent'] = userAgent;
  }

  const acceptLanguage = process.env.WITHMD_WEB2MD_ACCEPT_LANGUAGE?.trim() || options.defaultAcceptLanguage;
  if (acceptLanguage) {
    headers['Accept-Language'] = acceptLanguage;
  }

  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    if (host.endsWith('huggingface.co')) {
      const hfToken = process.env.WITHMD_WEB2MD_HF_TOKEN?.trim();
      if (hfToken) {
        headers.Authorization = `Bearer ${hfToken}`;
      }
    }
  } catch {
    // URL validity is validated before requests are made.
  }

  return headers;
}
