'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import CollabEditor from '@/components/with-md/collab-editor';
import NoticeStack from '@/components/with-md/notice-stack';
import { proseMarkdownComponents } from '@/components/with-md/prose-markdown-components';
import SourceEditor from '@/components/with-md/source-editor';
import { useScrollbarWidth } from '@/hooks/with-md/use-scrollbar-width';
import { cursorColorForUser } from '@/lib/with-md/cursor-colors';
import { protectMarkdownSave, type ProtectedMarkdownLoss } from '@/lib/with-md/markdown-format-guard';
import { hasMeaningfulDiff } from '@/lib/with-md/markdown-diff';
import {
  savePublicShareContent,
  ShareVersionConflictError,
  type PublicShareSnapshot,
} from '@/lib/with-md/public-share-save';
import { captureShareEvent } from '@/lib/with-md/share-analytics-client';
import { SHARE_EVENTS, sourceChannelFromPath } from '@/lib/with-md/share-events';
import { detectUnsupportedSyntax } from '@/lib/with-md/syntax';

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

function titleFromContent(content: string): string {
  const plain = stripLeadingFrontmatter(content)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>\[\]()!]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  if (!plain) return 'with.md';
  const words = plain.split(/\s+/).slice(0, 6);
  const snippet = words.join(' ');
  const suffix = plain.split(/\s+/).length > 6 ? '...' : '';
  return `${snippet}${suffix} - with.md`;
}

function readAnonName(): string {
  if (typeof window === 'undefined') return 'anon-user';
  const existing = window.localStorage.getItem('withmd-anon-name');
  if (existing) return existing;
  const generated = `anon-${Math.random().toString(36).slice(2, 6)}`;
  window.localStorage.setItem('withmd-anon-name', generated);
  return generated;
}

function modeClass(active: boolean): string {
  return active ? 'withmd-dock-btn withmd-dock-btn-active' : 'withmd-dock-btn';
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  try {
    localStorage.setItem('withmd-theme', next);
  } catch {
    /* noop */
  }
}

function blockedFormatLossMessage(loss: ProtectedMarkdownLoss) {
  const kinds = new Set(loss.missing.map((item) => item.kind));
  const names = [
    kinds.has('image') ? 'images' : null,
    kinds.has('link') || kinds.has('reference') ? 'links' : null,
    kinds.has('table') ? 'tables' : null,
    kinds.has('code') ? 'code' : null,
    kinds.has('html') ? 'HTML' : null,
    kinds.has('task_list') ? 'task lists' : null,
    kinds.has('frontmatter') ? 'frontmatter' : null,
  ].filter(Boolean);
  const suffix = names.length > 0 ? ` (${names.join(', ')})` : '';
  return `Rich edit was stopped because this markdown has syntax the fallback editor cannot safely save${suffix}. Source mode kept the original markdown intact.`;
}

export default function AnonShareShell({ shareId }: Props) {
  const searchParams = useSearchParams();
  const editSecret = (searchParams.get('edit') ?? '').trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<SharePayload | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [content, setContent] = useState('');
  const [sourceDraft, setSourceDraft] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusNoticeClosed, setStatusNoticeClosed] = useState(false);
  const [anonName, setAnonName] = useState('anon-user');
  const [userMode, setUserMode] = useState<'document' | 'source'>('document');
  const [formatBarOpen, setFormatBarOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [editorHydrated, setEditorHydrated] = useState(false);
  const [editorHydrationSlow, setEditorHydrationSlow] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement | null>(null);
  const shareRef = useRef<SharePayload | null>(null);
  const viewTrackedRef = useRef<string | null>(null);
  const lastSourceSaveRef = useRef('');
  const { ref: sourceScrollRef, scrollbarWidth: sourceScrollbarWidth } = useScrollbarWidth<HTMLPreElement>();
  const { ref: markdownScrollRef, scrollbarWidth: markdownScrollbarWidth } = useScrollbarWidth<HTMLDivElement>();

  useEffect(() => {
    setAnonName(readAnonName());
  }, []);

  useEffect(() => {
    if (!statusMessage) return;
    setStatusNoticeClosed(false);
    const timer = window.setTimeout(() => {
      setStatusMessage((cur) => (cur === statusMessage ? null : cur));
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

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
          setSourceDraft('');
          setCanEdit(false);
          return;
        }

        const syntax = detectUnsupportedSyntax(data.share.content);
        const nextShare = {
          ...data.share,
          syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
          syntaxSupportReasons: syntax.reasons,
        };
        setShare(nextShare);
        setContent(nextShare.content);
        setSourceDraft(nextShare.content);
        lastSourceSaveRef.current = nextShare.content;
        const editable = Boolean(data.canEdit);
        setCanEdit(editable);

        if (!editable && editSecret) {
          setStatusMessage('Edit key is invalid for this share. Opened in read-only mode.');
          return;
        }

        if (editable && nextShare.syntaxSupportStatus === 'unsupported') {
          const reasons = nextShare.syntaxSupportReasons.join(', ');
          setUserMode('source');
          setStatusMessage(
            reasons
              ? `This markdown uses unsupported syntax for realtime rich editing (${reasons}). Opened in Source mode.`
              : 'This markdown uses unsupported syntax for realtime rich editing. Opened in Source mode.',
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

  useEffect(() => {
    document.title = titleFromContent(content);
  }, [content]);

  useEffect(() => {
    shareRef.current = share;
  }, [share]);

  useEffect(() => {
    if (!share || viewTrackedRef.current === share.shortId) return;
    viewTrackedRef.current = share.shortId;
    const sourcePath = window.location.pathname || `/s/${share.shortId}`;
    void captureShareEvent(SHARE_EVENTS.sharedPageViewed, {
      entry_surface: 'shared_page',
      source_path: sourcePath,
      source_channel: sourceChannelFromPath(sourcePath),
      share_id: share.shortId,
      can_edit: canEdit,
    });
  }, [canEdit, share]);

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
  const showSource = userMode === 'source';
  const useLocalEditorFallback = showEditor && !showSource && editorHydrationSlow && !editorHydrated;
  const sourceDirty = canEdit && hasMeaningfulDiff(sourceDraft, content);
  const localEditorDirty = Boolean(
    canEdit &&
    showEditor &&
    editorHydrationSlow &&
    !editorHydrated &&
    share &&
    hasMeaningfulDiff(content, share.content),
  );
  const renderedReadContent = useMemo(() => stripLeadingFrontmatter(content), [content]);
  const downloadFileName = useMemo(() => {
    const fallback = 'shared-markdown.md';
    const rawTitle = (share?.title ?? '').trim();
    if (!rawTitle) return fallback;
    const cleanTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
    if (!cleanTitle) return fallback;
    return cleanTitle.toLowerCase().endsWith('.md') ? cleanTitle : `${cleanTitle}.md`;
  }, [share?.title]);

  useEffect(() => {
    setEditorHydrated(false);
    setEditorHydrationSlow(false);
    if (!showEditor || showSource) return;

    const timer = window.setTimeout(() => {
      setEditorHydrationSlow(true);
    }, 3500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [editSecret, shareId, showEditor, showSource]);

  useEffect(() => {
    if (!editorHydrationSlow || editorHydrated || !showEditor || showSource) return;
    setStatusMessage('Realtime editor is still connecting. You can keep editing here; changes will save without live cursors for now.');
  }, [editorHydrated, editorHydrationSlow, showEditor, showSource]);

  const onCopyViewLink = useCallback(async () => {
    if (!viewUrl) return;
    try {
      await navigator.clipboard.writeText(viewUrl);
      void captureShareEvent(SHARE_EVENTS.shareLinkCopied, {
        entry_surface: 'shared_page',
        source_path: window.location.pathname || `/s/${shareId}`,
        source_channel: 'recipient_loop',
        share_id: shareId,
        link_type: 'view',
        can_edit: canEdit,
      });
      setStatusMessage('View link copied.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not copy view link.');
    } finally {
      setShareMenuOpen(false);
    }
  }, [canEdit, shareId, viewUrl]);

  const onCopyEditLink = useCallback(async () => {
    if (!editUrl) return;
    try {
      await navigator.clipboard.writeText(editUrl);
      void captureShareEvent(SHARE_EVENTS.shareLinkCopied, {
        entry_surface: 'shared_page',
        source_path: window.location.pathname || `/s/${shareId}`,
        source_channel: 'recipient_loop',
        share_id: shareId,
        link_type: 'edit',
        can_edit: canEdit,
      });
      setStatusMessage('Edit link copied.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not copy edit link.');
    } finally {
      setShareMenuOpen(false);
    }
  }, [canEdit, editUrl, shareId]);

  const onCopyMarkdownUrl = useCallback(async () => {
    if (!markdownUrl) return;
    try {
      await navigator.clipboard.writeText(markdownUrl);
      void captureShareEvent(SHARE_EVENTS.shareLinkCopied, {
        entry_surface: 'shared_page',
        source_path: window.location.pathname || `/s/${shareId}`,
        source_channel: 'recipient_loop',
        share_id: shareId,
        link_type: 'raw',
        can_edit: canEdit,
      });
      setStatusMessage('Raw URL copied.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not copy raw URL.');
    } finally {
      setShareMenuOpen(false);
    }
  }, [canEdit, markdownUrl, shareId]);

  const onCopyMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      void captureShareEvent(SHARE_EVENTS.shareLinkCopied, {
        entry_surface: 'shared_page',
        source_path: window.location.pathname || `/s/${shareId}`,
        source_channel: 'recipient_loop',
        share_id: shareId,
        link_type: 'markdown_text',
        can_edit: canEdit,
        size_bytes: share?.sizeBytes,
      });
      setStatusMessage('Markdown copied.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not copy markdown.');
    }
  }, [canEdit, content, share?.sizeBytes, shareId]);

  const onDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadFileName;
    link.click();
    URL.revokeObjectURL(url);
  }, [content, downloadFileName]);

  const collabUser = useMemo(
    () => ({ name: anonName, color: cursorColorForUser(anonName) }),
    [anonName],
  );

  const onEditorContentChange = useCallback((nextContent: string) => {
    setContent(nextContent);
    setSourceDraft(nextContent);
  }, []);

  const applyShareSnapshot = useCallback((
    snapshot: PublicShareSnapshot,
    options?: { syncSourceDraft?: boolean; announceUnsupported?: boolean },
  ) => {
    const syntax = detectUnsupportedSyntax(snapshot.content);
    const syncSourceDraft = options?.syncSourceDraft ?? true;
    const announceUnsupported = options?.announceUnsupported ?? true;
    lastSourceSaveRef.current = snapshot.content;
    setContent(snapshot.content);
    if (syncSourceDraft) {
      setSourceDraft(snapshot.content);
    }
    setShare((prev) => prev
      ? {
        ...prev,
        content: snapshot.content,
        contentHash: snapshot.contentHash,
        sizeBytes: snapshot.sizeBytes ?? prev.sizeBytes,
        syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
        syntaxSupportReasons: syntax.reasons,
        updatedAt: snapshot.updatedAt ?? Date.now(),
      }
      : prev);
    if (!syntax.supported) {
      const reasons = syntax.reasons.join(', ');
      setUserMode('source');
      setFormatBarOpen(false);
      setEditorHydrated(false);
      setEditorHydrationSlow(false);
      if (announceUnsupported) {
        setStatusMessage(
          reasons
            ? `This markdown uses unsupported syntax for realtime rich editing (${reasons}). Opened in Source mode.`
            : 'This markdown uses unsupported syntax for realtime rich editing. Opened in Source mode.',
        );
      }
    }
  }, []);

  const saveShareContent = useCallback(async (
    nextContent: string,
    baselineContent: string,
    successMessage: string | null,
    snapshotOptions?: { syncSourceDraft?: boolean; announceUnsupported?: boolean },
  ) => {
    const currentShare = shareRef.current;
    if (!canEdit || !editSecret || !currentShare) return;

    const result = await savePublicShareContent({
      shareId,
      editSecret,
      nextContent,
      baselineContent,
      currentVersion: currentShare.contentHash,
    });

    applyShareSnapshot({
      content: result.content,
      contentHash: result.version,
      sizeBytes: result.sizeBytes,
      updatedAt: result.updatedAt,
    }, snapshotOptions);
    if (successMessage) {
      setStatusMessage(successMessage);
    }
  }, [applyShareSnapshot, canEdit, editSecret, shareId]);

  const saveSourceDraft = useCallback(async (nextContent: string) => {
    if (!canEdit || !editSecret || !share) return;
    const normalizedContent = nextContent.replace(/\r\n/g, '\n');
    if (!hasMeaningfulDiff(normalizedContent, content)) return;
    if (lastSourceSaveRef.current === normalizedContent) return;

    try {
      await saveShareContent(normalizedContent, content, null, {
        syncSourceDraft: false,
        announceUnsupported: false,
      });
    } catch (saveError) {
      if (saveError instanceof ShareVersionConflictError && saveError.latestShare) {
        applyShareSnapshot(saveError.latestShare);
      }
      setStatusMessage(saveError instanceof Error ? saveError.message : 'Could not save source changes.');
    }
  }, [applyShareSnapshot, canEdit, content, editSecret, saveShareContent, share]);

  useEffect(() => {
    if (!showSource || !sourceDirty) return;
    const timer = window.setTimeout(() => {
      void saveSourceDraft(sourceDraft);
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [saveSourceDraft, showSource, sourceDirty, sourceDraft]);

  useEffect(() => {
    if (!localEditorDirty || !share) return;
    const baselineContent = share.content;
    const saveDecision = protectMarkdownSave(baselineContent, content);
    if (!saveDecision.safe) {
      lastSourceSaveRef.current = saveDecision.content;
      setContent(saveDecision.content);
      setSourceDraft(saveDecision.content);
      setUserMode('source');
      setFormatBarOpen(false);
      setStatusMessage(blockedFormatLossMessage(saveDecision.loss));
      return;
    }

    const timer = window.setTimeout(() => {
      saveShareContent(content, baselineContent, null).catch((saveError) => {
        if (saveError instanceof ShareVersionConflictError && saveError.latestShare) {
          applyShareSnapshot(saveError.latestShare);
        }
        setStatusMessage(saveError instanceof Error ? saveError.message : 'Could not save changes.');
      });
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [applyShareSnapshot, content, localEditorDirty, saveShareContent, share]);

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
              <a href="/" className="withmd-dock-btn" aria-label="with.md home">
                <img src="/with-md-logo-transparent.png" alt="with.md" className="withmd-home-icon" />
                <span className="withmd-dock-tooltip">with.md</span>
              </a>
              {showEditor ? (
                <button
                  type="button"
                  className={modeClass(formatBarOpen && !showSource)}
                  onClick={() => setFormatBarOpen((open) => !open)}
                  aria-label="Toggle formatting"
                  disabled={showSource}
                >
                  <FormatExpandIcon />
                  <span className="withmd-dock-tooltip">Format</span>
                </button>
              ) : null}
              <button
                type="button"
                className={modeClass(showSource)}
                aria-label="Toggle source mode"
                onClick={() => {
                  setUserMode((current) => (current === 'source' ? 'document' : 'source'));
                  setFormatBarOpen(false);
                }}
              >
                <CodeIcon />
                <span className="withmd-dock-tooltip">Source</span>
              </button>
              <button type="button" className="withmd-dock-btn" aria-label="Download markdown" onClick={onDownload}>
                <DownloadIcon />
                <span className="withmd-dock-tooltip">Download</span>
              </button>
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
                      Copy Raw URL (for Agents)
                    </button>
                  </div>
                ) : null}
              </div>
              <button type="button" className="withmd-dock-btn" onClick={toggleTheme} aria-label="Toggle theme">
                <SunIcon />
                <MoonIcon />
                <span className="withmd-dock-tooltip">Theme</span>
              </button>
            </div>
          </header>

          {statusMessage && !statusNoticeClosed ? (
            <NoticeStack
              notices={[{ id: 'status', message: statusMessage, accent: true }]}
              onDismiss={() => setStatusNoticeClosed(true)}
            />
          ) : null}

          <div className="withmd-doc-stage withmd-fill">
            {showEditor && !showSource ? (
              <div className="withmd-anon-editor-wrap withmd-fill withmd-collab-hydration-wrap">
                {useLocalEditorFallback ? (
                  <CollabEditor
                    // Keep fallback mounted across save-version changes; remounting can steal focus and remeasure layout.
                    key={`local-share:${share.shortId}`}
                    mdFileId={`local-share:${share.shortId}`}
                    contentHash={share.contentHash}
                    realtimeEnabled={false}
                    content={content}
                    authToken=""
                    collabUser={collabUser}
                    comments={[]}
                    anchorByCommentId={new Map()}
                    activeCommentId={null}
                    focusedComment={null}
                    focusRequestId={0}
                    pendingSelection={null}
                    onContentChange={onEditorContentChange}
                    onSelectionDraftChange={() => {}}
                    onSelectComment={() => {}}
                    onReplyComment={async () => {}}
                    onCreateDraftComment={async () => {}}
                    onResolveThread={async () => {}}
                    markRequest={null}
                    onMarkRequestApplied={() => {}}
                    formatBarOpen={formatBarOpen}
                    commentsOpen={false}
                  />
                ) : !editorHydrated ? (
                  <div className="withmd-column withmd-fill withmd-gap-2">
                    <div
                      ref={markdownScrollRef}
                      className="withmd-prosemirror-wrap withmd-editor-scroll withmd-fill"
                      style={{ '--withmd-editor-scrollbar-width': `${markdownScrollbarWidth}px` } as CSSProperties}
                    >
                      <article className="withmd-prose withmd-markdown withmd-anon-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={proseMarkdownComponents}>{renderedReadContent}</ReactMarkdown>
                      </article>
                    </div>
                  </div>
                ) : null}
                {!useLocalEditorFallback ? (
                  <div className={editorHydrated ? 'withmd-collab-editor-visible' : 'withmd-collab-editor-hidden'}>
                    <CollabEditor
                      key={`share:${share.shortId}:${share.contentHash}`}
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
                      onContentChange={onEditorContentChange}
                      onSelectionDraftChange={() => {}}
                      onSelectComment={() => {}}
                      onReplyComment={async () => {}}
                      onCreateDraftComment={async () => {}}
                      onResolveThread={async () => {}}
                      markRequest={null}
                      onMarkRequestApplied={() => {}}
                      formatBarOpen={formatBarOpen}
                      commentsOpen={false}
                      onHydratedChange={setEditorHydrated}
                    />
                  </div>
                ) : null}
              </div>
            ) : showSource ? (
              <div className="withmd-column withmd-fill withmd-gap-2">
                <div className="withmd-editor-shell withmd-column withmd-fill">
                  {canEdit ? (
                    <SourceEditor
                      value={sourceDraft}
                      onChange={setSourceDraft}
                    />
                  ) : (
                    <pre
                      ref={sourceScrollRef}
                      className="withmd-source-readonly withmd-editor-scroll withmd-fill"
                      style={{ '--withmd-editor-scrollbar-width': `${sourceScrollbarWidth}px` } as CSSProperties}
                    >
                      {content}
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              <div className="withmd-column withmd-fill withmd-gap-2">
                <div className="withmd-editor-shell withmd-column withmd-fill">
                  <div
                    ref={markdownScrollRef}
                    className="withmd-prosemirror-wrap withmd-editor-scroll withmd-fill"
                    style={{ '--withmd-editor-scrollbar-width': `${markdownScrollbarWidth}px` } as CSSProperties}
                  >
                    <article className="withmd-prose withmd-markdown withmd-anon-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={proseMarkdownComponents}>{renderedReadContent}</ReactMarkdown>
                    </article>
                  </div>
                </div>
              </div>
            )}
          </div>
          <p className="withmd-share-create-own">
            Want your own editable markdown link? <a href="/">Create one on with.md</a>.
          </p>
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

function FormatExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.9 6.858l4.242 4.243L7.242 21H3v-4.243l9.9-9.9zm1.414-1.414l2.121-2.122a1 1 0 0 1 1.414 0l2.829 2.829a1 1 0 0 1 0 1.414l-2.122 2.121-4.242-4.242z" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.7 16.6 4.1 12l4.6-4.6 1.4 1.4L6.9 12l3.2 3.2-1.4 1.4zm6.6 0-1.4-1.4 3.2-3.2-3.2-3.2 1.4-1.4 4.6 4.6-4.6 4.6z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="withmd-icon-sun" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 1h2v3h-2V1zm0 19h2v3h-2v-3zM3.515 4.929l1.414-1.414L7.05 5.636 5.636 7.05 3.515 4.93zM16.95 18.364l1.414-1.414 2.121 2.121-1.414 1.414-2.121-2.121zm2.121-14.85 1.414 1.415-2.121 2.121-1.414-1.414 2.121-2.121zM5.636 16.95l1.414 1.414-2.121 2.121-1.414-1.414 2.121-2.121zM23 11v2h-3v-2h3zM4 11v2H1v-2h3z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="withmd-icon-moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 7a7 7 0 0 0 12 4.9v.1c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2h.1A6.98 6.98 0 0 0 10 7zm-6 5a8 8 0 0 0 15.062 3.762A9 9 0 0 1 8.238 4.938 7.999 7.999 0 0 0 4 12z" />
    </svg>
  );
}
