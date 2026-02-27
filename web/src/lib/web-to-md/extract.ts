import { parse, HTMLElement, Node, NodeType } from 'node-html-parser';

// Tags to remove entirely (no content extraction)
const REMOVE_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'canvas',
  'iframe', 'object', 'embed', 'applet', 'link', 'meta',
  'head', 'nav', 'header', 'footer', 'aside', 'form',
  'button', 'input', 'select', 'textarea', 'label',
  'dialog', 'menu', 'menuitem',
]);

// Semantic content containers, in priority order
const CONTENT_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '.post-content', '.entry-content', '.article-body', '.content',
  '#content', '#main', '#article',
];

function cleanNode(root: HTMLElement): void {
  // Remove unwanted tags
  for (const tag of REMOVE_TAGS) {
    root.querySelectorAll(tag).forEach(el => el.remove());
  }
  // Remove hidden elements
  root.querySelectorAll('[style*="display:none"],[style*="display: none"],[hidden]').forEach(el => el.remove());
  // Remove comments (node-html-parser doesn't expose them directly, skip)
}

function findContentRoot(root: HTMLElement): HTMLElement {
  for (const sel of CONTENT_SELECTORS) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      // Some selectors may not be supported
    }
  }
  return root.querySelector('body') ?? root;
}

function nodeText(node: Node): string {
  return (node as HTMLElement).text ?? '';
}

function escapeMarkdown(text: string): string {
  // Escape only the most critical markdown characters in plain text contexts
  return text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/`/g, '\\`');
}

function htmlToMarkdown(node: Node, listDepth = 0, orderedListCounters: number[] = []): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const text = node.rawText ?? '';
    // Collapse whitespace but preserve some structure
    const collapsed = text.replace(/[\r\n\t]+/g, ' ').replace(/  +/g, ' ');
    return collapsed;
  }

  if (node.nodeType !== NodeType.ELEMENT_NODE) return '';

  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase() ?? '';

  // Skip removed tags that might still be in tree
  if (REMOVE_TAGS.has(tag)) return '';

  // Get children markdown
  const childrenMd = (): string =>
    el.childNodes.map(c => htmlToMarkdown(c, listDepth, orderedListCounters)).join('');

  switch (tag) {
    case 'h1': return `\n\n# ${el.text.trim()}\n\n`;
    case 'h2': return `\n\n## ${el.text.trim()}\n\n`;
    case 'h3': return `\n\n### ${el.text.trim()}\n\n`;
    case 'h4': return `\n\n#### ${el.text.trim()}\n\n`;
    case 'h5': return `\n\n##### ${el.text.trim()}\n\n`;
    case 'h6': return `\n\n###### ${el.text.trim()}\n\n`;

    case 'p': {
      const inner = childrenMd().trim();
      return inner ? `\n\n${inner}\n\n` : '';
    }

    case 'br': return '  \n';
    case 'hr': return '\n\n---\n\n';

    case 'strong':
    case 'b': {
      const inner = childrenMd().trim();
      return inner ? `**${inner}**` : '';
    }

    case 'em':
    case 'i': {
      const inner = childrenMd().trim();
      return inner ? `*${inner}*` : '';
    }

    case 'del':
    case 's': {
      const inner = childrenMd().trim();
      return inner ? `~~${inner}~~` : '';
    }

    case 'code': {
      // Inline code (pre > code handled below)
      const parent = el.parentNode as HTMLElement;
      if (parent?.tagName?.toLowerCase() === 'pre') return el.text;
      return `\`${el.text}\``;
    }

    case 'pre': {
      const codeEl = el.querySelector('code');
      const body = (codeEl ?? el).text;
      // Detect language from class
      const classes = codeEl?.getAttribute('class') ?? '';
      const langMatch = classes.match(/language-(\S+)/);
      const lang = langMatch?.[1] ?? '';
      return `\n\n\`\`\`${lang}\n${body.trim()}\n\`\`\`\n\n`;
    }

    case 'blockquote': {
      const inner = childrenMd().trim();
      const lines = inner.split('\n').map(l => `> ${l}`).join('\n');
      return `\n\n${lines}\n\n`;
    }

    case 'a': {
      const href = el.getAttribute('href') ?? '';
      const inner = childrenMd().trim();
      if (!href || href.startsWith('javascript:')) return inner;
      if (!inner) return '';
      return `[${inner}](${href})`;
    }

    case 'img': {
      const src = el.getAttribute('src') ?? '';
      const alt = el.getAttribute('alt') ?? '';
      if (!src || src.startsWith('data:')) return alt;
      return `![${alt}](${src})`;
    }

    case 'ul': {
      const items = el.querySelectorAll(':scope > li, > li');
      if (items.length === 0) {
        return el.childNodes
          .map(c => htmlToMarkdown(c, listDepth + 1, orderedListCounters))
          .join('');
      }
      const indent = '  '.repeat(listDepth);
      return (
        '\n\n' +
        items
          .map(li => {
            const inner = li.childNodes
              .map(c => htmlToMarkdown(c, listDepth + 1, orderedListCounters))
              .join('')
              .trim();
            return `${indent}- ${inner}`;
          })
          .join('\n') +
        '\n\n'
      );
    }

    case 'ol': {
      const items = el.querySelectorAll(':scope > li, > li');
      if (items.length === 0) return childrenMd();
      const indent = '  '.repeat(listDepth);
      return (
        '\n\n' +
        items
          .map((li, i) => {
            const inner = li.childNodes
              .map(c => htmlToMarkdown(c, listDepth + 1, orderedListCounters))
              .join('')
              .trim();
            return `${indent}${i + 1}. ${inner}`;
          })
          .join('\n') +
        '\n\n'
      );
    }

    case 'li': {
      // Handled by parent ul/ol, but if orphan:
      return `- ${childrenMd().trim()}\n`;
    }

    case 'table': {
      return convertTable(el);
    }

    case 'figure': {
      const img = el.querySelector('img');
      const caption = el.querySelector('figcaption')?.text.trim() ?? '';
      if (img) {
        const src = img.getAttribute('src') ?? '';
        const alt = caption || (img.getAttribute('alt') ?? '');
        if (src && !src.startsWith('data:')) {
          return `\n\n![${alt}](${src})\n\n`;
        }
      }
      return childrenMd();
    }

    case 'details': {
      const summary = el.querySelector('summary')?.text.trim() ?? 'Details';
      const inner = el.childNodes
        .filter(c => (c as HTMLElement).tagName?.toLowerCase() !== 'summary')
        .map(c => htmlToMarkdown(c, listDepth, orderedListCounters))
        .join('')
        .trim();
      return `\n\n**${summary}**\n\n${inner}\n\n`;
    }

    // Block-level containers — recurse transparently
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'aside':
    case 'span':
    case 'header':
    case 'footer':
    case 'nav':
    default:
      return childrenMd();
  }
}

function convertTable(tableEl: HTMLElement): string {
  const rows: string[][] = [];
  let header: string[] | null = null;

  const thead = tableEl.querySelector('thead');
  if (thead) {
    const tr = thead.querySelector('tr');
    if (tr) {
      header = tr.querySelectorAll('th,td').map(td => td.text.trim());
    }
  }

  const tbodyRows = tableEl.querySelectorAll('tbody tr, tr');
  for (const tr of tbodyRows) {
    if (tr.closest('thead')) continue;
    const cells = tr.querySelectorAll('th,td').map(td => td.text.trim());
    rows.push(cells);
  }

  if (!header && rows.length > 0) {
    header = rows.shift()!;
  }

  if (!header || header.length === 0) return '';

  const n = header.length;
  const sep = Array(n).fill('---');
  const fmt = (cells: string[]) =>
    '| ' + cells.map(c => c.replace(/\|/g, '\\|')).join(' | ') + ' |';

  const lines = [
    '',
    fmt(header),
    fmt(sep),
    ...rows.map(r => fmt(r.length < n ? [...r, ...Array(n - r.length).fill('')] : r.slice(0, n))),
    '',
  ];
  return lines.join('\n');
}

function postProcess(md: string): string {
  // Collapse 3+ consecutive newlines to 2
  let out = md.replace(/\n{3,}/g, '\n\n');
  // Trim trailing spaces per line
  out = out
    .split('\n')
    .map(l => l.trimEnd())
    .join('\n');
  return out.trim() + '\n';
}

export interface ExtractResult {
  title: string;
  markdown: string;
}

export function extractFromHtml(rawHtml: string, sourceUrl: string): ExtractResult {
  const root = parse(rawHtml, {
    lowerCaseTagName: true,
    comment: false,
    fixNestedATags: true,
    parseNoneClosedTags: true,
  });

  // Extract title
  const titleEl = root.querySelector('title');
  const h1El = root.querySelector('h1');
  const title = (titleEl?.text ?? h1El?.text ?? new URL(sourceUrl).hostname).trim();

  cleanNode(root);
  const contentRoot = findContentRoot(root);
  const rawMd = htmlToMarkdown(contentRoot);
  const markdown = postProcess(rawMd);

  return { title, markdown };
}
