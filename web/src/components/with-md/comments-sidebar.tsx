'use client';

import { useMemo, useState } from 'react';

import type { AnchorMatch, CommentRecord } from '@/lib/with-md/types';

interface Props {
  comments: CommentRecord[];
  anchorByCommentId: Map<string, AnchorMatch | null>;
  onCreate(input: { body: string; textQuote: string; fallbackLine: number }): Promise<void>;
}

export default function CommentsSidebar({ comments, anchorByCommentId, onCreate }: Props) {
  const [body, setBody] = useState('');
  const [quote, setQuote] = useState('');
  const [line, setLine] = useState(1);
  const [saving, setSaving] = useState(false);

  const ordered = useMemo(() => [...comments].sort((a, b) => b.createdAt - a.createdAt), [comments]);

  async function submit() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await onCreate({
        body: body.trim(),
        textQuote: quote.trim(),
        fallbackLine: line,
      });
      setBody('');
      setQuote('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="withmd-drawer-section withmd-column withmd-fill withmd-pad-3">
      <h2 className="withmd-sidebar-title">Comments</h2>

      <div className="withmd-card withmd-mt-2">
        <textarea
          className="withmd-comment-input"
          placeholder="Add a comment"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <input
          className="withmd-inline-input withmd-mt-2"
          placeholder="Quoted text (optional)"
          value={quote}
          onChange={(event) => setQuote(event.target.value)}
        />
        <div className="withmd-row withmd-gap-2 withmd-mt-2">
          <label className="withmd-muted-xs" htmlFor="fallback-line">
            Line
          </label>
          <input
            id="fallback-line"
            type="number"
            min={1}
            className="withmd-inline-input withmd-w-20"
            value={line}
            onChange={(event) => setLine(Math.max(1, Number(event.target.value) || 1))}
          />
          <button type="button" className="withmd-btn withmd-btn-primary withmd-ml-auto" onClick={submit}>
            {saving ? 'Saving...' : 'Comment'}
          </button>
        </div>
      </div>

      <div className="withmd-scroll withmd-fill withmd-vstack-2 withmd-mt-3">
        {ordered.length === 0 && (
          <p className="withmd-muted-sm">No comments yet.</p>
        )}
        {ordered.map((comment) => {
          const anchor = anchorByCommentId.get(comment.id);
          return (
            <article key={comment.id} className="withmd-card">
              <p className="withmd-body-sm">{comment.body}</p>
              <p className="withmd-muted-xs withmd-mt-1">
                {anchor
                  ? `Anchor ${anchor.start}-${anchor.end}`
                  : `Approx. line ${comment.anchor.fallbackLine}`}
              </p>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
