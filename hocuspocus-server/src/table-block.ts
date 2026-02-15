import { Node } from '@tiptap/core';

export const TableBlock = Node.create({
  name: 'tableBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  markdownTokenName: 'table',

  addAttributes() {
    return {
      rawMarkdown: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-table-block]' }];
  },

  renderHTML({ node }) {
    return ['div', { 'data-table-block': '', 'data-raw-markdown': node.attrs.rawMarkdown }];
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode('tableBlock', { rawMarkdown: token.raw || '' }, []);
  },

  renderMarkdown(node) {
    return ((node.attrs?.rawMarkdown as string) || '').replace(/\n+$/, '');
  },
});
