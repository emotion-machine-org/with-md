'use client';

import CollabEditor from '@/components/with-md/collab-editor';
import SourceEditor from '@/components/with-md/source-editor';
import type { AnchorMatch, CommentRecord, CommentSelectionDraft, UserMode } from '@/lib/with-md/types';

interface Props {
  mdFileId: string;
  contentHash: string;
  realtimeEnabled: boolean;
  userMode: UserMode;
  content: string;
  comments: CommentRecord[];
  anchorByCommentId: Map<string, AnchorMatch | null>;
  activeCommentId: string | null;
  focusedComment: CommentRecord | null;
  focusRequestId: number;
  sourceValue: string;
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
  collabUser?: { name: string; color: string };
  onPeerCountChange?(count: number): void;
  formatBarOpen?: boolean;
  commentsOpen?: boolean;
}

export default function DocumentSurface({
  mdFileId,
  contentHash,
  realtimeEnabled,
  userMode,
  content,
  comments,
  anchorByCommentId,
  activeCommentId,
  focusedComment,
  focusRequestId,
  sourceValue,
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
  collabUser,
  onPeerCountChange,
  formatBarOpen,
  commentsOpen,
}: Props) {
  if (userMode === 'source') {
    return (
      <div className="withmd-column withmd-fill withmd-gap-3">
        <SourceEditor
          value={sourceValue}
          onChange={onSourceChange}
        />
      </div>
    );
  }

  return (
    <div className="withmd-column withmd-fill">
      <CollabEditor
        mdFileId={mdFileId}
        contentHash={contentHash}
        realtimeEnabled={realtimeEnabled}
        content={content}
        authToken="local-dev-token"
        collabUser={collabUser}
        comments={comments}
        anchorByCommentId={anchorByCommentId}
        activeCommentId={activeCommentId}
        focusedComment={focusedComment}
        focusRequestId={focusRequestId}
        pendingSelection={pendingSelection}
        onContentChange={onEditorContentChange}
        onSelectionDraftChange={onSelectionDraftChange}
        onSelectComment={onSelectComment}
        onReplyComment={onReplyComment}
        onCreateDraftComment={onCreateDraftComment}
        onResolveThread={onResolveThread}
        markRequest={markRequest}
        onMarkRequestApplied={onMarkRequestApplied}
        onPeerCountChange={onPeerCountChange}
        formatBarOpen={formatBarOpen}
        commentsOpen={commentsOpen}
      />
    </div>
  );
}
