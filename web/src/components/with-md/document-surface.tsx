'use client';

import { useCallback, useRef, useState } from 'react';

import CollabEditor from '@/components/with-md/collab-editor';
import ReadRenderer from '@/components/with-md/read-renderer';
import SourceEditor from '@/components/with-md/source-editor';
import { useIdleTimeout } from '@/hooks/with-md/use-idle-timeout';
import type { AnchorMatch, CommentRecord, CommentSelectionDraft, CursorHint, UserMode } from '@/lib/with-md/types';

const IDLE_TIMEOUT = 5000;

interface Props {
  mdFileId: string;
  userMode: UserMode;
  editing: boolean;
  readContent: string;
  comments: CommentRecord[];
  focusedCommentId: string | null;
  focusedComment: CommentRecord | null;
  focusedAnchorMatch: AnchorMatch | null;
  focusRequestId: number;
  sourceValue: string;
  sourceDirty: boolean;
  sourceSaving: boolean;
  canApplySource: boolean;
  onSourceChange(next: string): void;
  onApplySource(): void;
  onSaveSource(): void;
  onDiscardSource(): void;
  onEditorContentChange(next: string): void;
  onSelectionDraftChange(next: CommentSelectionDraft | null): void;
  markRequest: { requestId: number; commentMarkId: string; from: number; to: number } | null;
  onMarkRequestApplied(requestId: number): void;
  onActivateEditing(): void;
  onDeactivateEditing(): void;
}

export default function DocumentSurface({
  mdFileId,
  userMode,
  editing,
  readContent,
  comments,
  focusedCommentId,
  focusedComment,
  focusedAnchorMatch,
  focusRequestId,
  sourceValue,
  sourceDirty,
  sourceSaving,
  canApplySource,
  onSourceChange,
  onApplySource,
  onSaveSource,
  onDiscardSource,
  onEditorContentChange,
  onSelectionDraftChange,
  markRequest,
  onMarkRequestApplied,
  onActivateEditing,
  onDeactivateEditing,
}: Props) {
  const editContainerRef = useRef<HTMLDivElement>(null);
  const sourceContainerRef = useRef<HTMLDivElement>(null);
  const [cursorHint, setCursorHint] = useState<CursorHint | null>(null);

  useIdleTimeout({
    containerRef: editContainerRef,
    timeout: IDLE_TIMEOUT,
    enabled: editing && userMode === 'document',
    onIdle: onDeactivateEditing,
  });

  useIdleTimeout({
    containerRef: sourceContainerRef,
    timeout: IDLE_TIMEOUT,
    enabled: editing && userMode === 'source' && !sourceDirty,
    onIdle: onDeactivateEditing,
  });

  const handleReadClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;

      let sourceLine: number | undefined;
      let textFragment: string | undefined;
      let offsetInFragment: number | undefined;

      const target = e.target as HTMLElement;
      const lineAttr = target.closest('[data-source-line]')?.getAttribute('data-source-line');
      if (lineAttr) {
        sourceLine = parseInt(lineAttr, 10);
      }

      // Get precise click position within text (cross-browser)
      let caretNode: Node | null = null;
      let clickOffset = 0;
      if (typeof document.caretRangeFromPoint === 'function') {
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range) {
          caretNode = range.startContainer;
          clickOffset = range.startOffset;
        }
      } else if (typeof document.caretPositionFromPoint === 'function') {
        const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) {
          caretNode = pos.offsetNode;
          clickOffset = pos.offset;
        }
      }
      if (caretNode && caretNode.nodeType === Node.TEXT_NODE) {
        const fullText = (caretNode as Text).nodeValue ?? '';

        // Extract a context window around the click point (up to 40 chars each side)
        const ctxStart = Math.max(0, clickOffset - 40);
        const ctxEnd = Math.min(fullText.length, clickOffset + 40);
        const fragment = fullText.slice(ctxStart, ctxEnd).trim();

        if (fragment.length > 2) {
          textFragment = fragment;
          // Offset within the trimmed fragment: account for trim and context window
          const leadingTrimmed = fullText.slice(ctxStart, ctxEnd).length - fullText.slice(ctxStart, ctxEnd).trimStart().length;
          offsetInFragment = clickOffset - ctxStart - leadingTrimmed;
        }
      }

      // Fallback: use the clicked element's text
      if (!textFragment) {
        const textContent = target.textContent?.trim();
        if (textContent && textContent.length > 2 && textContent.length < 200) {
          textFragment = textContent;
        }
      }

      setCursorHint({ sourceLine, textFragment, offsetInFragment });
      onActivateEditing();
    },
    [onActivateEditing],
  );

  const handleSourceReadClick = useCallback(() => {
    onActivateEditing();
  }, [onActivateEditing]);

  if (userMode === 'source') {
    if (!editing) {
      return (
        <div className="withmd-column withmd-fill withmd-gap-3" onClick={handleSourceReadClick}>
          <pre className="withmd-source-editor withmd-source-readonly">{sourceValue}</pre>
        </div>
      );
    }

    return (
      <div ref={sourceContainerRef} className="withmd-column withmd-fill withmd-gap-3">
        <SourceEditor
          value={sourceValue}
          isDirty={sourceDirty}
          isSaving={sourceSaving}
          canApply={canApplySource}
          onChange={onSourceChange}
          onApply={onApplySource}
          onSave={onSaveSource}
          onDiscard={onDiscardSource}
        />
      </div>
    );
  }

  if (editing) {
    return (
      <div ref={editContainerRef} className="withmd-column withmd-fill">
        <CollabEditor
          mdFileId={mdFileId}
          content={readContent}
          authToken="local-dev-token"
          focusedComment={focusedComment}
          focusRequestId={focusRequestId}
          onContentChange={onEditorContentChange}
          onSelectionDraftChange={onSelectionDraftChange}
          markRequest={markRequest}
          onMarkRequestApplied={onMarkRequestApplied}
          initialCursorHint={cursorHint ?? undefined}
        />
      </div>
    );
  }

  return (
    <div className="withmd-fill withmd-doc-scroll" onClick={handleReadClick}>
      <ReadRenderer
        content={readContent}
        comments={comments}
        focusedCommentId={focusedCommentId}
        focusedAnchorMatch={focusedAnchorMatch}
        focusRequestId={focusRequestId}
        onSelectionDraftChange={onSelectionDraftChange}
      />
    </div>
  );
}
