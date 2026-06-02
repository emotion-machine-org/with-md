import { Node } from '@tiptap/core';

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function titleSuffix(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  return ` "${value.replace(/"/g, '\\"')}"`;
}

function rawImageMatchesAttrs(raw: unknown, src: unknown): raw is string {
  if (typeof raw !== 'string' || typeof src !== 'string') return false;
  return raw.trim().startsWith('![') && raw.includes(`](${src}`);
}

export const InlineImage = Node.create({
  name: 'inlineImage',

  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  markdownTokenName: 'image',

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      title: { default: null },
      rawMarkdown: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ node }) {
    return [
      'img',
      {
        src: typeof node.attrs.src === 'string' ? node.attrs.src : '',
        alt: typeof node.attrs.alt === 'string' ? node.attrs.alt : '',
        title: typeof node.attrs.title === 'string' ? node.attrs.title : undefined,
      },
    ];
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode('inlineImage', {
      src: token.href || '',
      alt: token.text || '',
      title: token.title || null,
      rawMarkdown: token.raw || '',
    });
  },

  renderMarkdown(node) {
    if (rawImageMatchesAttrs(node.attrs?.rawMarkdown, node.attrs?.src)) {
      return node.attrs.rawMarkdown.trim();
    }

    const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
    return `![${escapeLabel(alt)}](${src}${titleSuffix(node.attrs?.title)})`;
  },
});
