/**
 * Browser-rendered fallback using Playwright Chromium.
 * Gracefully skips if playwright is not installed or browser binary is unavailable.
 * Install once: npx playwright install chromium
 */

import { extractFromHtml } from './extract';

const BROWSER_TIMEOUT_MS = 30_000;

export async function tryBrowserFetch(
  url: string,
): Promise<{ markdown: string; title: string } | null> {
  // Dynamic import — returns null if playwright is not installed
  let chromium: { launch(opts: object): Promise<import('playwright').Browser> };
  try {
    const pw = await import('playwright');
    chromium = pw.chromium;
  } catch {
    return null;
  }

  let browser: import('playwright').Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Block heavy resources to speed up rendering
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,eot}', route =>
      route.abort(),
    );

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: BROWSER_TIMEOUT_MS,
    });

    const html = await page.content();
    const pageTitle = await page.title();
    await browser.close();
    browser = undefined;

    const { title: extractedTitle, markdown } = extractFromHtml(html, url);
    const title = extractedTitle || pageTitle || new URL(url).hostname;
    return { markdown, title };
  } catch {
    try {
      await browser?.close();
    } catch {
      /* noop */
    }
    return null;
  }
}
