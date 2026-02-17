'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import CollabEditor from '@/components/with-md/collab-editor';
import { cursorColorForUser } from '@/lib/with-md/cursor-colors';

interface SharePayload {
  shortId: string;
  title: string;
  content: string;
  contentHash: string;
  sizeBytes: number;
  syntaxSupportStatus: string;
  syntaxSupportReasons: string[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

interface Props {
  shareId: string;
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
  if (typeof window === 'undefined') return 'anon-user';
  const existing = window.localStorage.getItem('withmd-anon-name');
  if (existing) return existing;
  const generated = `anon-${Math.random().toString(36).slice(2, 6)}`;
  window.localStorage.setItem('withmd-anon-name', generated);
  return generated;
}

export default function AnonShareShell({ shareId }: Props) {
  const searchParams = useSearchParams();
  const editSecret = (searchParams.get('edit') ?? '').trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<SharePayload | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [content, setContent] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [anonName, setAnonName] = useState('anon-user');
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAnonName(readAnonName());
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setStatusMessage(null);

    async function load() {
      try {
        const suffix = editSecret ? `?edit=${encodeURIComponent(editSecret)}` : '';
        const response = await fetch(`/api/anon-share/${encodeURIComponent(shareId)}${suffix}`);
        const data = (await response.json().catch(() => null)) as
          | {
            error?: string;
            share?: SharePayload;
            canEdit?: boolean;
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
        setContent(data.share.content);
        const editable = Boolean(data.canEdit);
        setCanEdit(editable);

        if (!editable && editSecret) {
          setStatusMessage('Edit key is invalid for this share. Opened in read-only mode.');
          return;
        }

        if (editable && data.share.syntaxSupportStatus === 'unsupported') {
          const reasons = (data.share.syntaxSupportReasons ?? []).join(', ');
          setStatusMessage(
            reasons
              ? `This markdown uses unsupported syntax for realtime rich editing (${reasons}). Opened in read mode.`
              : 'This markdown uses unsupported syntax for realtime rich editing. Opened in read mode.',
          );
        }
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load share.');
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
  }, [shareId, editSecret]);

  const viewUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/s/${encodeURIComponent(shareId)}`;
  }, [shareId]);

  const editUrl = useMemo(() => {
    if (!editSecret || !viewUrl) return '';
    return `${viewUrl}?edit=${encodeURIComponent(editSecret)}`;
  }, [editSecret, viewUrl]);
  const markdownUrl = useMemo(() => {
    if (!viewUrl) return '';
    return `${viewUrl.replace(/\/+$/, '')}/raw`;
  }, [viewUrl]);
  const canRealtimeEdit = canEdit && share?.syntaxSupportStatus !== 'unsupported';
  const showEditor = Boolean(canRealtimeEdit);
  const renderedReadContent = useMemo(() => stripLeadingFrontmatter(content), [content]);

  const onCopyViewLink = useCallback(async () => {
    if (!viewUrl) return;
    try {
      await navigator.clipboard.writeText(viewUrl);
      setStatusMessage('View link copied.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not copy view link.');
    } finally {
      setShareMenuOpen(false);
    }
  }, [viewUrl]);

  const onCopyEditLink = useCallback(async () => {
    if (!editUrl) return;
    try {
      await navigator.clipboard.writeText(editUrl);
      setStatusMessage('Edit link copied.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not copy edit link.');
    } finally {
      setShareMenuOpen(false);
    }
  }, [editUrl]);

  const onCopyMarkdownUrl = useCallback(async () => {
    if (!markdownUrl) return;
    try {
      await navigator.clipboard.writeText(markdownUrl);
      setStatusMessage('Markdown URL copied.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not copy markdown URL.');
    } finally {
      setShareMenuOpen(false);
    }
  }, [markdownUrl]);

  const onCopyMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setStatusMessage('Markdown copied.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not copy markdown.');
    }
  }, [content]);

  const collabUser = useMemo(
    () => ({ name: anonName, color: cursorColorForUser(anonName) }),
    [anonName],
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
              <button
                type="button"
                className="withmd-dock-btn"
                aria-label="Copy markdown text"
                onClick={() => void onCopyMarkdown()}
              >
                <CopyIcon />
                <span className="withmd-dock-tooltip">Copy Markdown</span>
              </button>
              <div className="withmd-share-menu-wrap withmd-dock-share-wrap" ref={shareMenuRef}>
                <button
                  type="button"
                  className={`withmd-dock-btn ${shareMenuOpen ? 'withmd-dock-btn-active' : ''}`}
                  aria-label="Share links"
                  aria-haspopup="menu"
                  aria-expanded={shareMenuOpen}
                  onClick={() => setShareMenuOpen((prev) => !prev)}
                >
                  <ShareIcon />
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
                      disabled={!editUrl}
                    >
                      {editUrl ? 'Copy Edit Link' : 'Edit Link Unavailable'}
                    </button>
                    <button
                      type="button"
                      className="withmd-share-menu-item"
                      role="menuitem"
                      onClick={() => void onCopyMarkdownUrl()}
                    >
                      Copy Markdown URL
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
                  mdFileId={`share:${share.shortId}`}
                  contentHash={share.contentHash}
                  realtimeEnabled
                  content={content}
                  authToken={editSecret}
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

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 16.08a2.92 2.92 0 0 0-1.96.77l-6.12-3.56a3.18 3.18 0 0 0 0-2.58l6.12-3.56A3 3 0 1 0 15 5a2.89 2.89 0 0 0 .04.49L8.9 9.05a3 3 0 1 0 0 5.9l6.14 3.56a2.89 2.89 0 0 0-.04.49 3 3 0 1 0 3-2.92Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 1a2 2 0 0 1 2 2v2h1a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h11Zm-8 18v2h11V7H8v12Zm8-16H5v14h1V7a2 2 0 0 1 2-2h8V3Z" />
    </svg>
  );
}
