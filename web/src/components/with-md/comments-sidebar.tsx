'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import type { AnchorMatch, CommentRecord, CommentSelectionDraft } from '@/lib/with-md/types';

interface Props {
  comments: CommentRecord[];
  pendingSelection: CommentSelectionDraft | null;
  activeCommentId: string | null;
  anchorByCommentId: Map<string, AnchorMatch | null>;
  onCreate(input: { body: string; selection: CommentSelectionDraft | null }): Promise<void>;
  onDeleteComment(comment: CommentRecord): Promise<void>;
  onReplyComment(parentComment: CommentRecord, body: string): Promise<void>;
  onResolveThread(commentIds: string[]): Promise<void>;
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

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

interface ThreadGroup {
  root: CommentRecord;
  replies: CommentRecord[];
  allIds: string[];
}

function rootCommentId(byId: Map<string, CommentRecord>, comment: CommentRecord): string {
  let current = comment;
  while (current.parentCommentId) {
    const parent = byId.get(current.parentCommentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

export default function CommentsSidebar({
  comments,
  pendingSelection,
  activeCommentId,
  anchorByCommentId,
  onCreate,
  onDeleteComment,
  onReplyComment,
  onResolveThread,
  onSelectComment,
  onClearSelection,
}: Props) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [replyDraftByThread, setReplyDraftByThread] = useState<Record<string, string>>({});
  const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null);

  const threads = useMemo(() => {
    const byId = new Map(comments.map((c) => [c.id, c]));
    const grouped = new Map<string, CommentRecord[]>();

    for (const comment of comments) {
      const threadId = rootCommentId(byId, comment);
      const existing = grouped.get(threadId);
      if (existing) {
        existing.push(comment);
      } else {
        grouped.set(threadId, [comment]);
      }
    }

    const result: ThreadGroup[] = [];
    for (const [threadId, members] of grouped) {
      const root = byId.get(threadId) ?? members[0];
      const sorted = [...members].sort((a, b) => a.createdAt - b.createdAt);
      const replies = sorted.filter((c) => c.id !== root.id);
      result.push({
        root,
        replies,
        allIds: sorted.map((c) => c.id),
      });
    }

    result.sort((a, b) => b.root.createdAt - a.root.createdAt);
    return result;
  }, [comments]);

  const submit = useCallback(async () => {
    if (!body.trim() || !pendingSelection) return;
    setSaving(true);
    try {
      await onCreate({
        body: body.trim(),
        selection: pendingSelection,
      });
      setBody('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } finally {
      setSaving(false);
    }
  }, [body, pendingSelection, onCreate]);

  return (
    <aside className="withmd-drawer-section withmd-column withmd-fill withmd-pad-3">
      <h2 className="withmd-sidebar-title">Comments</h2>

      <div className="withmd-comment-form withmd-mt-2">
        <textarea
          ref={textareaRef}
          className="withmd-comment-input"
          placeholder="Add a comment..."
          rows={1}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            autoGrow(event.target);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
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
        {threads.length === 0 && (
          <p className="withmd-muted-xs">No comments yet.</p>
        )}
        {threads.map((thread) => {
          const isThreadActive = thread.allIds.includes(activeCommentId ?? '');
          return (
            <div
              key={thread.root.id}
              className={`withmd-sidebar-thread ${isThreadActive ? 'is-active' : ''}`}
            >
              <div className="withmd-sidebar-thread-header">
                <button
                  type="button"
                  className="withmd-sidebar-thread-root"
                  onClick={() => onSelectComment(thread.root)}
                >
                  <span className="withmd-sidebar-thread-author">{thread.root.authorId}</span>
                  <p className="withmd-comment-body">{thread.root.body}</p>
                  <p className="withmd-comment-meta">{anchorLabel(thread.root)}</p>
                  {thread.root.anchor.textQuote && (
                    <p className="withmd-comment-quote">{truncateQuote(thread.root.anchor.textQuote)}</p>
                  )}
                </button>
                <button
                  type="button"
                  className="withmd-sidebar-thread-resolve"
                  aria-label="Resolve thread"
                  onClick={() => void onResolveThread(thread.allIds)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                  </svg>
                </button>
              </div>

              {thread.replies.length > 0 && (
                <div className="withmd-sidebar-thread-replies">
                  {thread.replies.map((reply) => (
                    <div key={reply.id} className="withmd-sidebar-thread-reply">
                      <span className="withmd-sidebar-thread-author">{reply.authorId}</span>
                      <p className="withmd-comment-body">{reply.body}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="withmd-sidebar-thread-reply-box">
                <textarea
                  className="withmd-comment-input withmd-sidebar-reply-input"
                  placeholder="Reply..."
                  rows={1}
                  value={replyDraftByThread[thread.root.id] ?? ''}
                  onChange={(event) => {
                    const next = event.target.value;
                    setReplyDraftByThread((prev) => ({ ...prev, [thread.root.id]: next }));
                    autoGrow(event.target);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.shiftKey) return;
                    event.preventDefault();
                    const replyBody = (replyDraftByThread[thread.root.id] ?? '').trim();
                    if (!replyBody || replyingThreadId === thread.root.id) return;
                    setReplyingThreadId(thread.root.id);
                    const target = event.target as HTMLTextAreaElement;
                    void onReplyComment(thread.root, replyBody)
                      .then(() => {
                        setReplyDraftByThread((prev) => ({ ...prev, [thread.root.id]: '' }));
                        target.style.height = 'auto';
                      })
                      .finally(() => {
                        setReplyingThreadId((prev) => (prev === thread.root.id ? null : prev));
                      });
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
