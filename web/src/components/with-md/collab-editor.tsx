'use client';

import { useEffect } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';

import { buildEditorExtensions } from '@/components/with-md/tiptap/editor-extensions';
import { useCollabDoc } from '@/hooks/with-md/use-collab-doc';

interface Props {
  mdFileId: string;
  content: string;
  authToken: string;
  onContentChange(next: string): void;
}

export default function CollabEditor({ mdFileId, content, authToken, onContentChange }: Props) {
  const enableRealtime = process.env.NEXT_PUBLIC_WITHMD_ENABLE_REALTIME === '1';

  const { ydoc, provider, connected, reason } = useCollabDoc({
    mdFileId,
    token: authToken,
    enabled: enableRealtime,
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: buildEditorExtensions({
      ydoc,
      provider,
      user: { name: 'withmd-user', color: '#c7d2fe' },
      enableRealtime,
    }),
    contentType: 'markdown',
    content,
    onUpdate({ editor: nextEditor }) {
      if (!provider) {
        const markdown =
          (nextEditor as unknown as { getMarkdown?: () => string }).getMarkdown?.() ??
          (nextEditor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ??
          nextEditor.getText();
        onContentChange(markdown);
      }
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current =
      (editor as unknown as { getMarkdown?: () => string }).getMarkdown?.() ??
      (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ??
      editor.getText();
    if (current === content) return;

    // Keep local editor in sync when switching modes or files.
    (editor.commands as unknown as { setContent: (value: string, options?: { contentType?: string }) => boolean })
      .setContent(content, { contentType: 'markdown' });
  }, [content, editor]);

  if (!editor) {
    return <p className="withmd-muted-sm">Loading editor...</p>;
  }

  const showStatus = enableRealtime && !connected && reason;

  return (
    <div className="withmd-column withmd-fill withmd-gap-2">
      {showStatus && <div className="withmd-muted-xs">{reason}</div>}
      <div className="withmd-prosemirror-wrap withmd-scroll withmd-fill">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
