import { NodeHtmlMarkdown } from 'node-html-markdown';

const converter = new NodeHtmlMarkdown({
  bulletMarker: '-',
  codeFence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  textReplace: [
    [/\u00a0/g, ' '],
  ],
});

function cleanupMarkdown(markdown: string): string {
  const normalized = markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized ? `${normalized}\n` : '';
}

function hasHeading(markdown: string): boolean {
  return /^#{1,6}\s+/m.test(markdown);
}

export function htmlToMarkdown(html: string, title?: string): string {
  const raw = converter.translate(html);
  const cleaned = cleanupMarkdown(raw);

  if (!cleaned) {
    return title ? `# ${title}\n` : '';
  }

  if (title && !hasHeading(cleaned)) {
    return cleanupMarkdown(`# ${title}\n\n${cleaned}`);
  }

  return cleaned;
}

export function stripMarkdownSyntax(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/[>*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
