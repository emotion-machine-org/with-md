'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

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
  anchorByCommentId: Map<string, AnchorMatch | null>;
  focusedCommentId: string | null;
  focusedComment: CommentRecord | null;
  focusedAnchorMatch: AnchorMatch | null;
  focusRequestId: number;
  sourceValue: string;
  sourceDirty: boolean;
  onSourceChange(next: string): void;
  onEditorContentChange(next: string): void;
  onSelectionDraftChange(next: CommentSelectionDraft | null): void;
  pendingSelection: CommentSelectionDraft | null;
  onSelectComment(comment: CommentRecord): void;
  onReplyComment(parentComment: CommentRecord, body: string): Promise<void>;
  onCreateDraftComment(body: string, selection: CommentSelectionDraft): Promise<void>;
  onResolveThread(commentIds: string[]): Promise<void>;
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
  anchorByCommentId,
  focusedCommentId,
  focusedComment,
  focusedAnchorMatch,
  focusRequestId,
  sourceValue,
  sourceDirty,
  onSourceChange,
  onEditorContentChange,
  onSelectionDraftChange,
  pendingSelection,
  onSelectComment,
  onReplyComment,
  onCreateDraftComment,
  onResolveThread,
  markRequest,
  onMarkRequestApplied,
  onActivateEditing,
  onDeactivateEditing,
}: Props) {
  const editContainerRef = useRef<HTMLDivElement>(null);
  const readLayerRef = useRef<HTMLDivElement>(null);
  const sourceContainerRef = useRef<HTMLDivElement>(null);
  const skipNextClickRef = useRef(false);
  const [cursorHint, setCursorHint] = useState<CursorHint | null>(null);
  const [cursorHintKey, setCursorHintKey] = useState(0);

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

  // Sync scroll position between read and edit layers before paint
  useLayoutEffect(() => {
    if (userMode !== 'document') return;
    const readEl = readLayerRef.current;
    const editEl = editContainerRef.current?.querySelector('.withmd-editor-scroll');
    if (!readEl || !editEl) return;

    if (editing) {
      // Read → Edit: transfer read scroll position to editor
      const maxRead = readEl.scrollHeight - readEl.clientHeight;
      if (maxRead > 0) {
        const ratio = readEl.scrollTop / maxRead;
        const maxEdit = editEl.scrollHeight - editEl.clientHeight;
        editEl.scrollTop = ratio * maxEdit;
      }
    } else {
      // Edit → Read: transfer editor scroll position to read
      const maxEdit = editEl.scrollHeight - editEl.clientHeight;
      if (maxEdit > 0) {
        const ratio = editEl.scrollTop / maxEdit;
        const maxRead = readEl.scrollHeight - readEl.clientHeight;
        readEl.scrollTop = ratio * maxRead;
      }
    }
  }, [editing, userMode]);

  // mousedown fires BEFORE the browser clears the native selection.
  // If there was an active selection (from highlighting for a comment),
  // set a flag to prevent the subsequent click from activating edit mode.
  const handleReadMouseDown = useCallback(() => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      skipNextClickRef.current = true;
    }
  }, []);

  const handleReadClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (skipNextClickRef.current) {
        skipNextClickRef.current = false;
        return;
      }
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
      setCursorHintKey((k) => k + 1);
      onActivateEditing();
    },
    [onActivateEditing],
  );

  const handleSourceReadClick = useCallback(() => {
    onActivateEditing();
  }, [onActivateEditing]);

  // --- Source mode: component swap (textarea is cheap to mount) ---
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
          onChange={onSourceChange}
        />
      </div>
    );
  }

  // --- Document mode: both layers always mounted, toggle visibility ---
  return (
    <div className="withmd-surface-stack">
      <div
        ref={editContainerRef}
        className={`withmd-surface-layer withmd-column ${editing ? '' : 'withmd-surface-hidden'}`}
      >
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
          cursorHint={cursorHint ?? undefined}
          cursorHintKey={cursorHintKey}
        />
      </div>

      <div
        ref={readLayerRef}
        className={`withmd-surface-layer withmd-doc-scroll ${editing ? 'withmd-surface-hidden' : ''}`}
        onMouseDown={handleReadMouseDown}
        onClick={handleReadClick}
      >
        <ReadRenderer
          content={readContent}
          comments={comments}
          anchorByCommentId={anchorByCommentId}
          activeCommentId={focusedCommentId}
          focusedCommentId={focusedCommentId}
          focusedAnchorMatch={focusedAnchorMatch}
          focusRequestId={focusRequestId}
          onSelectionDraftChange={onSelectionDraftChange}
          pendingSelection={pendingSelection}
          onSelectComment={onSelectComment}
          onReplyComment={onReplyComment}
          onCreateDraftComment={onCreateDraftComment}
          onResolveThread={onResolveThread}
        />
      </div>
    </div>
  );
}
