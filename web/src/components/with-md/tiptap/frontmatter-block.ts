import { Node } from '@tiptap/core';

/**
 * FrontmatterBlock isolates a leading YAML frontmatter block (`---\n…\n---`) into
 * its own atom node so the rest of the document stays fully rich-editable.  It
 * mirrors the TableBlock/MermaidBlock pattern: the raw markdown is stored verbatim
 * in an attribute and round-trips unchanged, while a NodeView renders it as a
 * read-only metadata box that swaps to a textarea on double-click.
 *
 * Frontmatter is not a native marked token, so we also register a custom
 * block-level tokenizer (via `markdownTokenizer`) that only claims a `---` fenced
 * block at the very start of the document.
 */
export const FrontmatterBlock = Node.create({
  name: 'frontmatterBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  markdownTokenName: 'frontmatter',

  // Register a custom marked tokenizer for the non-standard frontmatter syntax.
  // The `tokens.length > 0` guard ensures only a true leading frontmatter block is
  // claimed — a mid-document `---\n…\n---` (an hr + content) is left untouched.
  markdownTokenizer: {
    name: 'frontmatter',
    level: 'block',
    start: (src: string) => (src.startsWith('---\n') || src.startsWith('---\r\n') ? 0 : -1),
    tokenize(src: string, tokens: unknown[]) {
      if (Array.isArray(tokens) && tokens.length > 0) return undefined;
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(src);
      if (!match) return undefined;
      return { type: 'frontmatter', raw: match[0], text: match[1] };
    },
  },

  addAttributes() {
    return {
      rawMarkdown: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-frontmatter-block]' }];
  },

  renderHTML({ node }) {
    return ['div', { 'data-frontmatter-block': '', 'data-raw-markdown': node.attrs.rawMarkdown }];
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode('frontmatterBlock', { rawMarkdown: token.raw || '' }, []);
  },

  renderMarkdown(node) {
    return ((node.attrs?.rawMarkdown as string) || '').replace(/\n+$/, '');
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'withmd-frontmatter-block';
      dom.contentEditable = 'false';

      let editing = false;
      let currentRaw = node.attrs.rawMarkdown as string;
      let textarea: HTMLTextAreaElement | null = null;

      const renderRead = (raw: string) => {
        currentRaw = raw;
        dom.innerHTML = '';

        const label = document.createElement('div');
        label.className = 'withmd-frontmatter-block-label';
        label.textContent = 'Frontmatter';
        dom.appendChild(label);

        const pre = document.createElement('pre');
        pre.className = 'withmd-frontmatter-block-body';
        pre.textContent = (raw || '').replace(/^---\r?\n/, '').replace(/\r?\n---\s*$/, '');
        dom.appendChild(pre);
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
            renderRead(newRaw);
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

        renderRead(newRaw);
      };

      const cancelEdit = () => {
        if (!editing) return;
        editing = false;
        textarea = null;
        dom.classList.remove('is-editing');
        renderRead(currentRaw);
      };

      const enterEdit = () => {
        if (editing) return;
        editing = true;
        dom.innerHTML = '';
        dom.classList.add('is-editing');

        const label = document.createElement('div');
        label.className = 'withmd-frontmatter-block-label';
        label.textContent = 'Frontmatter';
        dom.appendChild(label);

        textarea = document.createElement('textarea');
        textarea.className = 'withmd-frontmatter-block-editor';
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

      renderRead(currentRaw);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'frontmatterBlock') return false;
          if (!editing) {
            renderRead(updatedNode.attrs.rawMarkdown as string);
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
