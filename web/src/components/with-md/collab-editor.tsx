'use client';

import { useEffect, useRef } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';

import { buildEditorExtensions } from '@/components/with-md/tiptap/editor-extensions';
import { useCollabDoc } from '@/hooks/with-md/use-collab-doc';
import { normalizeAsciiDiagramBlocks } from '@/lib/with-md/ascii-diagram';

interface Props {
  mdFileId: string;
  content: string;
  authToken: string;
  onContentChange(next: string): void;
}

function getEditorMarkdown(editor: unknown): string | null {
  const fromMethod = (editor as { getMarkdown?: () => string }).getMarkdown?.();
  if (typeof fromMethod === 'string') return fromMethod;

  const fromStorage = (editor as { storage?: { markdown?: { getMarkdown?: () => string } } }).storage?.markdown?.getMarkdown?.();
  if (typeof fromStorage === 'string') return fromStorage;

  return null;
}

export default function CollabEditor({ mdFileId, content, authToken, onContentChange }: Props) {
  const realtimeRequested = process.env.NEXT_PUBLIC_WITHMD_ENABLE_REALTIME === '1';
  const realtimeExperimental = process.env.NEXT_PUBLIC_WITHMD_ENABLE_REALTIME_EXPERIMENTAL === '1';
  const enableRealtime = realtimeRequested && realtimeExperimental;

  const { ydoc, provider, connected, reason } = useCollabDoc({
    mdFileId,
    token: authToken,
    enabled: enableRealtime,
  });
  const lastLocalMarkdownRef = useRef<string | null>(null);

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
      const markdown = getEditorMarkdown(nextEditor);
      if (markdown == null) return;
      lastLocalMarkdownRef.current = markdown;
      onContentChange(markdown);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = getEditorMarkdown(editor);
    if (current == null) return;
    if (current === content) return;

    // Avoid resetting history when the update originated from this editor instance.
    if (lastLocalMarkdownRef.current === content) {
      return;
    }

    // Keep local editor in sync when switching modes or files.
    (editor.commands as unknown as { setContent: (value: string, options?: { contentType?: string }) => boolean })
      .setContent(content, { contentType: 'markdown' });
  }, [content, editor]);

  useEffect(() => {
    if (!editor) return;

    const onPaste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const markdownText = clipboard.getData('text/markdown');
      const plainText = clipboard.getData('text/plain');
      const text = (markdownText || plainText).replace(/\r\n/g, '\n');
      if (!text) return;

      const looksLikeMarkdown =
        /(^#{1,6}\s)|(^\s*[-*+]\s)|(^\s*\d+\.\s)|```|(\|.*\|)|(^>\s)/m.test(text) ||
        text.includes('\n\n');
      const shouldTreatAsMarkdown = Boolean(markdownText) || looksLikeMarkdown;
      const normalized = shouldTreatAsMarkdown ? text : normalizeAsciiDiagramBlocks(text);

      if (!shouldTreatAsMarkdown && normalized === text) return;

      event.preventDefault();
      (
        editor.chain() as unknown as {
          focus: () => {
            insertContent: (value: string, options?: { contentType?: string }) => { run: () => boolean };
          };
        }
      )
        .focus()
        .insertContent(normalized, { contentType: 'markdown' })
        .run();
    };

    editor.view.dom.addEventListener('paste', onPaste);
    return () => {
      editor.view.dom.removeEventListener('paste', onPaste);
    };
  }, [editor]);

  if (!editor) {
    return <p className="withmd-muted-sm">Loading editor...</p>;
  }

  if (realtimeRequested && !realtimeExperimental) {
    return (
      <div className="withmd-column withmd-fill withmd-gap-2">
        <div className="withmd-muted-xs">
          Realtime collaboration is currently in safe fallback mode. Set
          {' '}
          <code>NEXT_PUBLIC_WITHMD_ENABLE_REALTIME_EXPERIMENTAL=1</code>
          {' '}
          to enable the experimental realtime path.
        </div>
        <div className="withmd-prosemirror-wrap withmd-editor-scroll withmd-fill">
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  }

  const showStatus = enableRealtime && !connected && reason;

  return (
    <div className="withmd-column withmd-fill withmd-gap-2">
      {showStatus && <div className="withmd-muted-xs">{reason}</div>}
      <div className="withmd-prosemirror-wrap withmd-editor-scroll withmd-fill">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
