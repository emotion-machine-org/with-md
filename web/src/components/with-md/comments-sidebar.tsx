'use client';

import { useMemo, useState } from 'react';

import type { AnchorMatch, CommentRecord, CommentSelectionDraft } from '@/lib/with-md/types';

interface Props {
  comments: CommentRecord[];
  pendingSelection: CommentSelectionDraft | null;
  activeCommentId: string | null;
  anchorByCommentId: Map<string, AnchorMatch | null>;
  onCreate(input: { body: string; selection: CommentSelectionDraft | null }): Promise<void>;
  onDeleteComment(comment: CommentRecord): Promise<void>;
  onSelectComment(comment: CommentRecord): void;
  onClearSelection(): void;
}

function anchorLabel(comment: CommentRecord): string {
  const path = comment.anchor.anchorHeadingPath;
  if (path.length > 0) {
    const last = path[path.length - 1];
    return path.length > 1 ? `${path[0]} / ... / ${last}` : last;
  }
  return `Line ${comment.anchor.fallbackLine}`;
}

function truncateQuote(quote: string, max = 80): string {
  if (quote.length <= max) return quote;
  return quote.slice(0, max).trimEnd() + '...';
}

export default function CommentsSidebar({
  comments,
  pendingSelection,
  activeCommentId,
  anchorByCommentId,
  onCreate,
  onDeleteComment,
  onSelectComment,
  onClearSelection,
}: Props) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const ordered = useMemo(() => [...comments].sort((a, b) => b.createdAt - a.createdAt), [comments]);

  async function submit() {
    if (!body.trim() || !pendingSelection) return;
    setSaving(true);
    try {
      await onCreate({
        body: body.trim(),
        selection: pendingSelection,
      });
      setBody('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="withmd-drawer-section withmd-column withmd-fill withmd-pad-3">
      <h2 className="withmd-sidebar-title">Comments</h2>

      <div className="withmd-comment-form withmd-mt-2">
        <textarea
          className="withmd-comment-input"
          placeholder="Add a comment..."
          rows={1}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        {pendingSelection && (
          <div className="withmd-selection-pill withmd-mt-2">
            <span className="withmd-comment-quote">{truncateQuote(pendingSelection.textQuote)}</span>
            <button type="button" className="withmd-comment-clear" onClick={onClearSelection}>
              Clear
            </button>
          </div>
        )}
        {!pendingSelection && (
          <p className="withmd-muted-xs withmd-mt-2">Select text to anchor.</p>
        )}
        <button
          type="button"
          className="withmd-comment-submit withmd-mt-2"
          onClick={submit}
          disabled={saving || !body.trim() || !pendingSelection}
        >
          {saving ? 'Saving...' : 'Comment'}
        </button>
      </div>

      <div className="withmd-scroll withmd-fill withmd-mt-3">
        {ordered.length === 0 && (
          <p className="withmd-muted-xs">No comments yet.</p>
        )}
        {ordered.map((comment) => {
          const isActive = comment.id === activeCommentId;
          return (
            <button
              key={comment.id}
              type="button"
              className={`withmd-comment-card ${isActive ? 'is-active' : ''}`}
              onClick={() => onSelectComment(comment)}
            >
              <p className="withmd-comment-body">{comment.body}</p>
              <p className="withmd-comment-meta">{anchorLabel(comment)}</p>
              {comment.anchor.textQuote && (
                <p className="withmd-comment-quote">{truncateQuote(comment.anchor.textQuote)}</p>
              )}
              <span
                className="withmd-comment-delete"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  void onDeleteComment(comment);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.stopPropagation();
                    void onDeleteComment(comment);
                  }
                }}
              >
                Delete
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
