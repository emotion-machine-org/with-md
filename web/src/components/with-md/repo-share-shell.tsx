'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import CollabEditor from '@/components/with-md/collab-editor';
import { cursorColorForUser } from '@/lib/with-md/cursor-colors';

interface SharePayload {
  mdFileId: string;
  repoId: string;
  path: string;
  title: string;
  content: string;
  contentHash: string;
  syntaxSupportStatus: string;
  syntaxSupportReasons: string[];
  expiresAt: number | null;
  viewUrl: string;
  editUrl: string;
  realtimeAuthToken?: string;
}

interface Props {
  token: string;
}

function stripLeadingFrontmatter(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return markdown;
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return markdown;
  const stripped = normalized.slice(end + 5).replace(/^\n+/, '');
  return stripped || markdown;
}

function readAnonName(): string {
  if (typeof window === 'undefined') return 'guest';
  const existing = window.localStorage.getItem('withmd-repo-share-name');
  if (existing) return existing;
  const generated = `guest-${Math.random().toString(36).slice(2, 6)}`;
  window.localStorage.setItem('withmd-repo-share-name', generated);
  return generated;
}

export default function RepoShareShell({ token }: Props) {
  const searchParams = useSearchParams();
  const editSecret = searchParams.get('edit')?.trim() ?? '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<SharePayload | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [content, setContent] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [collabName, setCollabName] = useState('guest');
  const shareMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCollabName(readAnonName());
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setStatusMessage(null);

    async function load() {
      try {
        const suffix = editSecret ? `?edit=${encodeURIComponent(editSecret)}` : '';
        const response = await fetch(`/api/repo-share/${encodeURIComponent(token)}${suffix}`);
        const data = (await response.json().catch(() => null)) as
          | {
            error?: string;
            canEdit?: boolean;
            editRejected?: boolean;
            share?: SharePayload;
          }
          | null;

        if (!active) return;
        if (!response.ok || !data?.share) {
          setError(data?.error ?? 'Share not found.');
          setShare(null);
          setContent('');
          setCanEdit(false);
          return;
        }

        setShare(data.share);
        setCanEdit(Boolean(data.canEdit));
        setContent(data.share.content);

        if (data.editRejected) {
          setStatusMessage('Edit key is invalid for this share. Opened in read-only mode.');
        }

        if (data.canEdit && data.share.syntaxSupportStatus === 'unsupported') {
          const reasons = (data.share.syntaxSupportReasons ?? []).join(', ');
          setStatusMessage(
            reasons
              ? `This markdown uses unsupported syntax for realtime rich editing (${reasons}). Opened in read mode.`
              : 'This markdown uses unsupported syntax for realtime rich editing. Opened in read mode.',
          );
        }
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load shared markdown.');
        setShare(null);
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [editSecret, token]);

  const canRealtimeEdit = canEdit && share?.syntaxSupportStatus !== 'unsupported';
  const showEditor = Boolean(canRealtimeEdit);
  const renderedReadContent = useMemo(() => stripLeadingFrontmatter(content), [content]);

  const onCopyViewLink = useCallback(async () => {
    if (!share?.viewUrl) return;
    await navigator.clipboard.writeText(share.viewUrl);
    setStatusMessage('View link copied.');
    setShareMenuOpen(false);
  }, [share?.viewUrl]);

  const onCopyEditLink = useCallback(async () => {
    if (!share?.editUrl) return;
    await navigator.clipboard.writeText(share.editUrl);
    setStatusMessage('Edit link copied.');
    setShareMenuOpen(false);
  }, [share?.editUrl]);

  const collabUser = useMemo(
    () => ({ name: collabName, color: cursorColorForUser(collabName) }),
    [collabName],
  );

  useEffect(() => {
    if (!shareMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!shareMenuRef.current?.contains(target)) {
        setShareMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShareMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [shareMenuOpen]);

  if (loading) {
    return (
      <main className="withmd-bg withmd-page withmd-stage">
        <section className="withmd-doc-shell">
          <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill withmd-anon-share-panel">
            <div className="withmd-doc-scroll">
              <div className="withmd-landing-inner">
                <p className="withmd-muted-sm">Loading shared markdown...</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (error || !share) {
    return (
      <main className="withmd-bg withmd-page withmd-stage">
        <section className="withmd-doc-shell">
          <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill withmd-anon-share-panel">
            <div className="withmd-doc-scroll">
              <div className="withmd-landing-inner">
                <h1 className="withmd-landing-title">Share unavailable</h1>
                <p className="withmd-landing-body">{error ?? 'This shared markdown does not exist.'}</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="withmd-bg withmd-page withmd-stage">
      <section className="withmd-doc-shell">
        <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill withmd-anon-share-panel">
          <header className="withmd-dock-wrap withmd-anon-share-toolbar">
            <div className="withmd-dock">
              <div className="withmd-share-menu-wrap withmd-dock-share-wrap" ref={shareMenuRef}>
                <button
                  type="button"
                  className={`withmd-dock-btn ${shareMenuOpen ? 'withmd-dock-btn-active' : ''}`}
                  aria-label="Share links"
                  aria-haspopup="menu"
                  aria-expanded={shareMenuOpen}
                  onClick={() => setShareMenuOpen((prev) => !prev)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18 16.08a2.92 2.92 0 0 0-1.96.77l-6.12-3.56a3.18 3.18 0 0 0 0-2.58l6.12-3.56A3 3 0 1 0 15 5a2.89 2.89 0 0 0 .04.49L8.9 9.05a3 3 0 1 0 0 5.9l6.14 3.56a2.89 2.89 0 0 0-.04.49 3 3 0 1 0 3-2.92Z" />
                  </svg>
                  <span className="withmd-dock-tooltip">Share</span>
                </button>
                {shareMenuOpen ? (
                  <div className="withmd-share-menu withmd-dock-share-menu" role="menu" aria-label="Copy share links">
                    <button type="button" className="withmd-share-menu-item" role="menuitem" onClick={() => void onCopyViewLink()}>
                      Copy View Link
                    </button>
                    <button
                      type="button"
                      className="withmd-share-menu-item"
                      role="menuitem"
                      onClick={() => void onCopyEditLink()}
                      disabled={!share.editUrl}
                    >
                      {share.editUrl ? 'Copy Edit Link' : 'Edit Link Unavailable'}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            {statusMessage ? (
              <div className="withmd-row withmd-gap-2 withmd-mt-2 withmd-dock-meta withmd-anon-share-status-wrap">
                <span className="withmd-muted-xs withmd-dock-status withmd-anon-share-status">{statusMessage}</span>
              </div>
            ) : null}
          </header>

          <div className="withmd-doc-stage withmd-fill">
            {showEditor ? (
              <div className="withmd-anon-editor-wrap withmd-fill">
                <CollabEditor
                  mdFileId={share.mdFileId}
                  contentHash={share.contentHash}
                  realtimeEnabled
                  content={content}
                  authToken={share.realtimeAuthToken ?? ''}
                  collabUser={collabUser}
                  comments={[]}
                  anchorByCommentId={new Map()}
                  activeCommentId={null}
                  focusedComment={null}
                  focusRequestId={0}
                  pendingSelection={null}
                  onContentChange={setContent}
                  onSelectionDraftChange={() => {}}
                  onSelectComment={() => {}}
                  onReplyComment={async () => {}}
                  onCreateDraftComment={async () => {}}
                  onResolveThread={async () => {}}
                  markRequest={null}
                  onMarkRequestApplied={() => {}}
                  formatBarOpen={false}
                  commentsOpen={false}
                />
              </div>
            ) : (
              <div className="withmd-column withmd-fill withmd-gap-2">
                <div className="withmd-editor-shell withmd-column withmd-fill">
                  <div className="withmd-prosemirror-wrap withmd-editor-scroll withmd-fill">
                    <article className="withmd-prose withmd-markdown withmd-anon-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderedReadContent}</ReactMarkdown>
                    </article>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
