import { Extension } from '@tiptap/core';
import Code from '@tiptap/extension-code';
import Collaboration from '@tiptap/extension-collaboration';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

/**
 * Override Code mark to allow coexistence with bold/italic.  The default Code
 * mark sets `excludes: '_'` (exclude ALL marks), which crashes on paste when
 * markdown contains patterns like **`code`**.  Standard markdown renderers
 * allow bold+code, so we match that behavior.
 */
const PermissiveCode = Code.extend({
  excludes: '',
});
import { defaultSelectionBuilder, yCursorPlugin } from '@tiptap/y-tiptap';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { CommentMark } from '@/components/with-md/tiptap/comment-mark';
import { InlineImage } from '@/components/with-md/tiptap/inline-image';
import { MermaidBlock } from '@/components/with-md/tiptap/mermaid-block';
import { TableBlock } from '@/components/with-md/tiptap/table-block';

/**
 * Custom CollaborationCursor extension that uses the yCursorPlugin from
 * @tiptap/y-tiptap instead of y-prosemirror.  The Collaboration extension
 * (v3.19+) registers its sync plugin via @tiptap/y-tiptap, creating a new
 * PluginKey instance.  The stock @tiptap/extension-collaboration-cursor (v3.0)
 * still imports the key from y-prosemirror, causing a key mismatch and
 * "ystate is undefined" crash.  This extension wires the cursor plugin through
 * the same package so the PluginKey references match.
 */
const CollaborationCursor = Extension.create<{
  provider: { awareness: Awareness } | null;
  user: { name: string; color: string };
}>({
  name: 'collaborationCursor',

  addOptions() {
    return {
      provider: null,
      user: { name: 'Anonymous', color: '#aaaaaa' },
    };
  },

  addProseMirrorPlugins() {
    const awareness = this.options.provider?.awareness;
    if (!awareness) return [];

    awareness.setLocalStateField('user', this.options.user);

    return [
      yCursorPlugin(awareness, {
        cursorBuilder: (user: { name: string; color: string }) => {
          const cursor = document.createElement('span');
          cursor.classList.add('collaboration-cursor__caret');
          cursor.setAttribute('style', `border-color: ${user.color}`);
          const label = document.createElement('div');
          label.classList.add('collaboration-cursor__label');
          label.setAttribute('style', `background-color: ${user.color}`);
          label.insertBefore(document.createTextNode(user.name), null);
          cursor.insertBefore(label, null);
          return cursor;
        },
        selectionBuilder: defaultSelectionBuilder,
      }),
    ];
  },
});

export function buildEditorExtensions(params: {
  ydoc: Y.Doc;
  provider: { awareness: unknown } | null;
  user: { name: string; color: string };
  enableRealtime: boolean;
}) {
  // TipTap collaboration requires disabling StarterKit history plugin.
  // Disable built-in Code mark so we can use PermissiveCode instead.
  const starterKit = StarterKit.configure({
    undoRedo: params.enableRealtime ? false : {},
    code: false,
  });

  const baseCore = [
    // MermaidBlock must register before StarterKit so its parseMarkdown for the
    // shared `code` token runs first and claims ```mermaid fences.
    MermaidBlock,
    starterKit,
    PermissiveCode,
    Underline,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    InlineImage,
    CommentMark,
    TableBlock,
    TaskList,
    TaskItem,
  ];

  if (!params.enableRealtime || !params.provider) {
    return [
      ...baseCore,
      Markdown,
    ];
  }

  // Keep Markdown extension enabled in realtime too, so editor updates can still
  // serialize to markdown (`getMarkdown`) for dirty-state and source sync logic.
  return [
    ...baseCore,
    Markdown,
    Collaboration.configure({ document: params.ydoc }),
    CollaborationCursor.configure({
      provider: params.provider as { awareness: Awareness },
      user: { name: params.user.name, color: params.user.color },
    }),
  ];
}
