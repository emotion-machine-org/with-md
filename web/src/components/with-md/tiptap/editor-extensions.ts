import Collaboration from '@tiptap/extension-collaboration';
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
    CommentMark,
    TableBlock,
  ];

  if (!params.enableRealtime || !params.provider) {
    return [
      ...baseCore,
      Markdown,
    ];
  }

  // Realtime profile keeps table node schema parity with server-side markdown parsing.
  return [
    ...baseCore,
    Collaboration.configure({ document: params.ydoc }),
  ];
}
