import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import * as Y from 'yjs';

import { CommentMark } from '@/components/with-md/tiptap/comment-mark';

export function buildEditorExtensions(params: {
  ydoc: Y.Doc;
  provider: { awareness: unknown } | null;
  user: { name: string; color: string };
  enableRealtime: boolean;
}) {
  const base = [
    StarterKit,
    Markdown,
    CommentMark,
  ];

  if (!params.enableRealtime || !params.provider) return base;

  return [
    ...base,
    Collaboration.configure({ document: params.ydoc }),
    CollaborationCursor.configure({
      provider: params.provider as never,
      user: params.user,
    }),
  ];
}
