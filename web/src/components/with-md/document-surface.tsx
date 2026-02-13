'use client';

import CollabEditor from '@/components/with-md/collab-editor';
import ReadRenderer from '@/components/with-md/read-renderer';
import SourceEditor from '@/components/with-md/source-editor';
import type { AnchorMatch, CommentRecord, CommentSelectionDraft, DocMode } from '@/lib/with-md/types';

interface Props {
  mdFileId: string;
  mode: DocMode;
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
}

export default function DocumentSurface({
  mdFileId,
  mode,
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
}: Props) {
  if (mode === 'source') {
    return (
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
    );
  }

  if (mode === 'edit') {
    return (
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
      />
    );
  }

  return (
    <div className="withmd-fill withmd-doc-scroll">
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
