import { Node } from '@tiptap/core';
import { marked } from 'marked';

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

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'withmd-table-block';
      dom.contentEditable = 'false';

      const renderTable = (raw: string) => {
        const html = marked.parse(raw || '', { gfm: true, async: false });
        dom.innerHTML = typeof html === 'string' ? html : '';
      };

      renderTable(node.attrs.rawMarkdown as string);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'tableBlock') return false;
          renderTable(updatedNode.attrs.rawMarkdown as string);
          return true;
        },
      };
    };
  },
});
