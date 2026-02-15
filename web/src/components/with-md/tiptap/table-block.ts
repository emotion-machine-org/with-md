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
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'withmd-table-block';
      dom.contentEditable = 'false';

      let editing = false;
      let currentRaw = node.attrs.rawMarkdown as string;
      let textarea: HTMLTextAreaElement | null = null;

      const renderTable = (raw: string) => {
        currentRaw = raw;
        const html = marked.parse(raw || '', { gfm: true, async: false });
        dom.innerHTML = typeof html === 'string' ? html : '';
      };

      const commitEdit = () => {
        if (!editing || !textarea) return;
        const newRaw = textarea.value;
        editing = false;
        textarea = null;
        dom.classList.remove('is-editing');

        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos != null && newRaw !== currentRaw) {
          const state = (editor as { state?: { doc?: { nodeAt: (pos: number) => unknown }; tr?: unknown } }).state;
          if (!state?.doc || !state.tr) {
            renderTable(newRaw);
            return;
          }
          const nodeAtPos = state.doc.nodeAt(pos) as { attrs?: Record<string, unknown> } | null;
          if (nodeAtPos) {
            const tr = (state.tr as {
              setNodeMarkup: (pos: number, type: undefined, attrs: Record<string, unknown>) => unknown;
            }).setNodeMarkup(pos, undefined, {
              ...(nodeAtPos.attrs ?? {}),
              rawMarkdown: newRaw,
            });
            editor.view.dispatch(tr as never);
          }
        }

        renderTable(newRaw);
      };

      const cancelEdit = () => {
        if (!editing) return;
        editing = false;
        textarea = null;
        dom.classList.remove('is-editing');
        renderTable(currentRaw);
      };

      const enterEdit = () => {
        if (editing) return;
        editing = true;
        dom.innerHTML = '';
        dom.classList.add('is-editing');

        textarea = document.createElement('textarea');
        textarea.className = 'withmd-table-block-editor';
        textarea.value = currentRaw.replace(/\n+$/, '');
        textarea.spellcheck = false;

        textarea.addEventListener('blur', commitEdit);
        textarea.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
            editor.commands.focus();
          }
        });

        dom.appendChild(textarea);
        textarea.focus();

        // Auto-size to fit content
        textarea.style.height = textarea.scrollHeight + 'px';
      };

      dom.addEventListener('dblclick', (e) => {
        if (editing) return;
        e.preventDefault();
        enterEdit();
      });

      renderTable(currentRaw);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'tableBlock') return false;
          if (!editing) {
            renderTable(updatedNode.attrs.rawMarkdown as string);
          } else {
            currentRaw = updatedNode.attrs.rawMarkdown as string;
          }
          return true;
        },
        stopEvent(event: Event) {
          if (editing && dom.contains(event.target as HTMLElement)) return true;
          return false;
        },
        destroy() {
          if (editing) commitEdit();
        },
      };
    };
  },
});
