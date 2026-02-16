import Collaboration from '@tiptap/extension-collaboration';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import * as Y from 'yjs';

import { CommentMark } from '@/components/with-md/tiptap/comment-mark';
import { TableBlock } from '@/components/with-md/tiptap/table-block';

export function buildEditorExtensions(params: {
  ydoc: Y.Doc;
  provider: { awareness: unknown } | null;
  user: { name: string; color: string };
  enableRealtime: boolean;
}) {
  // TipTap collaboration requires disabling StarterKit history plugin.
  const starterKit = StarterKit.configure({
    undoRedo: params.enableRealtime ? false : {},
  });

  const baseCore = [
    starterKit,
    Underline,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    CommentMark,
    TableBlock,
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
  ];
}
