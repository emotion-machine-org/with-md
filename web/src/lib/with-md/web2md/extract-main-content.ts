import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export interface ContentStructureStats {
  linkCount: number;
  listItemCount: number;
  codeBlockCount: number;
  tableCount: number;
}

export interface ExtractedMainContent {
  title: string;
  html: string;
  text: string;
  excerpt?: string;
  structure: ContentStructureStats;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function removeBoilerplate(document: Document): void {
  const selectors = [
    'script',
    'style',
    'noscript',
    'template',
    'iframe',
    'svg',
    'canvas',
    'nav',
    'aside',
    'form',
    'button',
    'input',
    'select',
  ];

  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      node.remove();
    }
  }
}

function collectStructureStats(document: Document): ContentStructureStats {
  return {
    linkCount: document.querySelectorAll('a[href]').length,
    listItemCount: document.querySelectorAll('li').length,
    codeBlockCount: document.querySelectorAll('pre, code').length,
    tableCount: document.querySelectorAll('table').length,
  };
}

function fallbackContent(document: Document, structure: ContentStructureStats): ExtractedMainContent {
  const title = collapseWhitespace(document.title || '') || 'Untitled';
  const body = document.body;
  const html = body?.innerHTML || '';
  const text = collapseWhitespace(body?.textContent || '');

  return {
    title,
    html,
    text,
    structure,
  };
}

export function extractMainContent(html: string, sourceUrl: string): ExtractedMainContent {
  const dom = new JSDOM(html, { url: sourceUrl });

  try {
    const document = dom.window.document;
    removeBoilerplate(document);
    const structure = collectStructureStats(document);

    const readability = new Readability(document, {
      charThreshold: 80,
      keepClasses: false,
    });
    const article = readability.parse();

    if (!article || !article.content || !article.textContent) {
      return fallbackContent(document, structure);
    }

    const title = collapseWhitespace(article.title || document.title || '') || 'Untitled';
    const text = collapseWhitespace(article.textContent);

    return {
      title,
      html: article.content,
      text,
      excerpt: article.excerpt ? collapseWhitespace(article.excerpt) : undefined,
      structure,
    };
  } finally {
    dom.window.close();
  }
}
