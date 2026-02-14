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
  anchorByCommentId: Map<string, AnchorMatch | null>;
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
  pendingSelection: CommentSelectionDraft | null;
  onSelectComment(comment: CommentRecord): void;
  onReplyComment(parentComment: CommentRecord, body: string): Promise<void>;
  onCreateDraftComment(body: string, selection: CommentSelectionDraft): Promise<void>;
  onResolveThread(commentIds: string[]): Promise<void>;
  markRequest: { requestId: number; commentMarkId: string; from: number; to: number } | null;
  onMarkRequestApplied(requestId: number): void;
}

export default function DocumentSurface({
  mdFileId,
  mode,
  readContent,
  comments,
  anchorByCommentId,
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
  pendingSelection,
  onSelectComment,
  onReplyComment,
  onCreateDraftComment,
  onResolveThread,
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
  );
}
