'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import CommentsSidebar from '@/components/with-md/comments-sidebar';
import DocumentSurface from '@/components/with-md/document-surface';
import DocumentToolbar from '@/components/with-md/document-toolbar';
import FileTree from '@/components/with-md/file-tree';
import { useAuth } from '@/hooks/with-md/use-auth';
import { useCommentAnchors } from '@/hooks/with-md/use-comment-anchors';
import { useDocMode } from '@/hooks/with-md/use-doc-mode';
import { getWithMdApi } from '@/lib/with-md/api';
import { INLINE_REALTIME_MAX_BYTES, markdownByteLength } from '@/lib/with-md/collab-policy';
import { hasMeaningfulDiff } from '@/lib/with-md/markdown-diff';
import { detectUnsupportedSyntax } from '@/lib/with-md/syntax';
import type { ActivityItem, CommentRecord, CommentSelectionDraft, MdFile, RepoSummary } from '@/lib/with-md/types';

interface Props {
  repoId?: string;
  filePath?: string;
}

const api = getWithMdApi();

export default function WithMdShell({ repoId, filePath }: Props) {
  const { user } = useAuth();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [activeRepoId, setActiveRepoId] = useState('');
  const [files, setFiles] = useState<MdFile[]>([]);
  const [currentFile, setCurrentFile] = useState<MdFile | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [sourceValue, setSourceValue] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<CommentSelectionDraft | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [markRequest, setMarkRequest] = useState<{ requestId: number; commentMarkId: string; from: number; to: number } | null>(null);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const loadedRepos = await api.listRepos();
        if (!active) return;
        setRepos(loadedRepos);

        const selectedRepo = loadedRepos.find((repo) => repo.repoId === repoId) ?? loadedRepos[0];
        const nextRepoId = selectedRepo?.repoId;
        if (!nextRepoId) {
          setActiveRepoId('');
          setFiles([]);
          setCurrentFile(null);
          return;
        }
        setActiveRepoId(nextRepoId);

        const loadedFiles = await api.listFilesByRepo(nextRepoId);
        if (!active) return;
        setFiles(loadedFiles);

        let targetFile: MdFile | null = null;
        if (filePath) {
          targetFile =
            loadedFiles.find((file) => file.path === filePath) ??
            (await api.resolveByPath(nextRepoId, filePath));
          if (!active) return;
          if (!targetFile) {
            setStatusMessage(
              loadedFiles[0]
                ? `Requested path "${filePath}" not found. Showing "${loadedFiles[0].path}".`
                : `Requested path "${filePath}" not found.`,
            );
          }
        }
        if (!targetFile) {
          targetFile = loadedFiles[0] ?? null;
        }
        setCurrentFile(targetFile);

        if (targetFile) {
          setSourceValue(targetFile.content);
          setSavedContent(targetFile.content);
          const [loadedComments, loadedActivity] = await Promise.all([
            api.listCommentsByFile(targetFile.mdFileId),
            api.listActivity(nextRepoId),
          ]);
          if (!active) return;
          setComments(loadedComments);
          setActivity(loadedActivity);
        }
      } catch (error) {
        if (!active) return;
        setStatusMessage(error instanceof Error ? error.message : 'Failed to load workspace.');
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [filePath, repoId]);

  useEffect(() => {
    if (!currentFile) return;
    setSourceValue(currentFile.content);
    setSavedContent(currentFile.content);
    setPendingSelection(null);
    setActiveCommentId(null);
    setFocusRequestId(0);
    setMarkRequest(null);
  }, [currentFile?.mdFileId]);

  const localSyntax = useMemo(
    () => (currentFile ? detectUnsupportedSyntax(currentFile.content) : { supported: true, reasons: [] as string[] }),
    [currentFile?.content],
  );
  const syntaxReasons = useMemo(() => {
    const persisted = currentFile?.syntaxSupportReasons ?? [];
    return Array.from(new Set([...persisted, ...localSyntax.reasons]));
  }, [currentFile?.syntaxSupportReasons, localSyntax.reasons]);
  const syntaxSupported = currentFile
    ? currentFile.syntaxSupportStatus !== 'unsupported' && localSyntax.supported
    : true;
  const { userMode, setUserMode, canUseRichEdit } = useDocMode(syntaxSupported);
  const sourceDirty = Boolean(currentFile && hasMeaningfulDiff(sourceValue, currentFile.content));
  const realtimeRequested = process.env.NEXT_PUBLIC_WITHMD_ENABLE_REALTIME === '1';
  const currentMarkdownBytes = currentFile ? markdownByteLength(currentFile.content) : 0;
  const localInlineRealtimeOversized = currentMarkdownBytes > INLINE_REALTIME_MAX_BYTES;
  const inlineRealtimeOversized = Boolean(currentFile && (currentFile.isOversized || localInlineRealtimeOversized));
  const realtimeEnabled = realtimeRequested && !inlineRealtimeOversized;
  const realtimeSafeModeMessage =
    realtimeRequested && inlineRealtimeOversized
      ? 'File too large for inline realtime persistence; using safe mode. Live collaboration stays in-session until size drops.'
      : null;

  useEffect(() => {
    if (userMode === 'source') {
      setPendingSelection(null);
    }
  }, [userMode]);

  useEffect(() => {
    if (!pendingSelection) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.withmd-rail-thread')) return;
      if (target.closest('.withmd-comment-form')) return;
      setPendingSelection(null);
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [pendingSelection]);

  const anchorMap = useCommentAnchors(currentFile?.content ?? '', comments);

  const reloadActivity = useCallback(async () => {
    if (!activeRepoId) return;
    const loaded = await api.listActivity(activeRepoId);
    setActivity(loaded);
  }, [activeRepoId]);

  const reloadCurrentFileData = useCallback(async () => {
    if (!currentFile) return;

    const [freshFile, freshComments] = await Promise.all([
      api.getFile(currentFile.mdFileId),
      api.listCommentsByFile(currentFile.mdFileId),
    ]);

    if (freshFile) {
      setCurrentFile(freshFile);
    }
    setComments(freshComments);
  }, [currentFile]);

  useEffect(() => {
    if (!currentFile || userMode !== 'document') return;
    if (realtimeEnabled) return;
    if (currentFile.content === savedContent) return;
    let active = true;

    const timeout = window.setTimeout(async () => {
      try {
        const result = await api.saveSource({
          mdFileId: currentFile.mdFileId,
          sourceContent: currentFile.content,
        });
        if (!active) return;
        if (result.changed) {
          setSavedContent(currentFile.content);
          await reloadActivity();
        }
      } catch (error) {
        if (!active) return;
        setStatusMessage(error instanceof Error ? error.message : 'Auto-save failed.');
      }
    }, 1200);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [currentFile, userMode, reloadActivity, savedContent, realtimeEnabled]);

  // Auto-save for source mode (mirrors document-mode auto-save)
  useEffect(() => {
    if (!currentFile || userMode !== 'source') return;
    if (!sourceDirty) return;
    let active = true;

    const timeout = window.setTimeout(async () => {
      try {
        const result = await api.saveSource({
          mdFileId: currentFile.mdFileId,
          sourceContent: sourceValue,
        });
        if (!active) return;
        if (result.changed) {
          await reloadCurrentFileData();
          await reloadActivity();
        }
      } catch (error) {
        if (!active) return;
        setStatusMessage(error instanceof Error ? error.message : 'Auto-save failed.');
      }
    }, 1200);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [currentFile, userMode, sourceDirty, sourceValue, reloadActivity, reloadCurrentFileData]);

  const onCreateComment = useCallback(
    async (input: { body: string; selection: CommentSelectionDraft | null; parentComment?: CommentRecord | null }) => {
      if (!currentFile) return;
      const selection = input.selection;
      const parentComment = input.parentComment ?? null;
      const parentAnchor = parentComment?.anchor;
      const commentMarkId = selection?.source === 'edit'
        ? `cmark_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        : parentAnchor?.commentMarkId;

      const created = await api.createComment({
        mdFileId: currentFile.mdFileId,
        authorId: user?.githubLogin ?? 'local-user',
        body: input.body,
        parentCommentId: parentComment?.id,
        commentMarkId,
        textQuote: selection?.textQuote ?? parentAnchor?.textQuote ?? '',
        fallbackLine: selection?.fallbackLine ?? parentAnchor?.fallbackLine ?? 1,
        anchorPrefix: selection?.anchorPrefix ?? parentAnchor?.anchorPrefix,
        anchorSuffix: selection?.anchorSuffix ?? parentAnchor?.anchorSuffix,
        anchorHeadingPath: selection?.anchorHeadingPath ?? parentAnchor?.anchorHeadingPath,
        rangeStart: selection?.rangeStart ?? parentAnchor?.rangeStart,
        rangeEnd: selection?.rangeEnd ?? parentAnchor?.rangeEnd,
      });

      if (
        commentMarkId &&
        typeof selection?.selectionFrom === 'number' &&
        typeof selection?.selectionTo === 'number' &&
        selection.selectionFrom < selection.selectionTo
      ) {
        setMarkRequest({
          requestId: Date.now(),
          commentMarkId,
          from: selection.selectionFrom,
          to: selection.selectionTo,
        });
      }

      if (selection) {
        setPendingSelection(null);
      }
      setActiveCommentId(created.id);
      setFocusRequestId((prev) => prev + 1);
      await reloadCurrentFileData();
      await reloadActivity();
    },
    [currentFile, reloadActivity, reloadCurrentFileData, user?.githubLogin],
  );

  const onSelectComment = useCallback(
    (comment: CommentRecord) => {
      setActiveCommentId(comment.id);
      setFocusRequestId((prev) => prev + 1);
      if (userMode === 'source') {
        setUserMode('document');
      }
      if (!commentsOpen) {
        setCommentsOpen(true);
        setFilesOpen(false);
      }
    },
    [commentsOpen, userMode, setUserMode],
  );

  const onPush = useCallback(async () => {
    if (!activeRepoId) return;
    setStatusMessage('Pushing to GitHub...');
    try {
      const res = await fetch('/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: activeRepoId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Push failed');
      }
      const data = (await res.json()) as { pushed: number; commitSha: string | null };
      setStatusMessage(data.pushed > 0 ? `Pushed ${data.pushed} file(s) to GitHub.` : 'Nothing to push.');
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Push failed.');
    }
    await reloadActivity();
  }, [activeRepoId, reloadActivity]);

  const onResync = useCallback(async () => {
    if (!activeRepoId) return;
    setStatusMessage('Re-syncing from GitHub...');

    // Find the active repo to get installation details
    const repo = repos.find((r) => r.repoId === activeRepoId);
    if (!repo || !repo.githubInstallationId || !repo.githubRepoId || !repo.defaultBranch) {
      // Fallback to old Convex resync
      await api.resync(activeRepoId);
      setStatusMessage('Re-sync complete.');
      await reloadActivity();
      return;
    }

    try {
      const res = await fetch('/api/github/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: repo.githubInstallationId,
          owner: repo.owner,
          repo: repo.name,
          defaultBranch: repo.defaultBranch,
          githubRepoId: repo.githubRepoId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Sync failed');
      }
      const data = (await res.json()) as { filesCount: number };
      setStatusMessage(`Re-synced ${data.filesCount} file(s) from GitHub.`);

      // Reload files
      const loadedFiles = await api.listFilesByRepo(activeRepoId);
      setFiles(loadedFiles);
      if (currentFile) {
        const refreshed = loadedFiles.find((f) => f.mdFileId === currentFile.mdFileId);
        if (refreshed) {
          setCurrentFile(refreshed);
          setSourceValue(refreshed.content);
          setSavedContent(refreshed.content);
        }
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Re-sync failed.');
    }
    await reloadActivity();
  }, [activeRepoId, repos, currentFile, reloadActivity]);

  const onToggleFiles = useCallback(() => {
    setFilesOpen((prev) => {
      const next = !prev;
      if (next) setCommentsOpen(false);
      return next;
    });
  }, []);

  const onToggleComments = useCallback(() => {
    setCommentsOpen((prev) => {
      const next = !prev;
      if (next) setFilesOpen(false);
      return next;
    });
  }, []);

  const activeComment = comments.find((comment) => comment.id === activeCommentId) ?? null;

  if (!currentFile) {
    return (
      <main className="withmd-bg withmd-page withmd-loading">
        <div className="withmd-loading-inner">
          <h1 className="withmd-loading-title">with.md</h1>
          <p className="withmd-loading-sub">Loading...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="withmd-bg withmd-page withmd-stage">
      <div className={`withmd-stage-layout ${filesOpen ? 'files-open' : ''} ${commentsOpen ? 'comments-open' : ''}`}>
        <aside className={`withmd-side withmd-side-left ${filesOpen ? 'is-open' : ''}`}>
          <div className="withmd-drawer withmd-drawer-left">
            <div className="withmd-drawer-inner">
              <FileTree repoId={activeRepoId || currentFile.repoId} files={files} activePath={currentFile.path} />
            </div>
          </div>
          <button
            type="button"
            className={`withmd-side-toggle withmd-side-toggle-left ${filesOpen ? 'is-open' : ''}`}
            onClick={onToggleFiles}
          >
            {filesOpen ? 'Close Files' : 'Files'}
          </button>
        </aside>

        <section className="withmd-center">
          <section className="withmd-doc-shell">
            <DocumentToolbar
              userMode={userMode}
              canUseRichEdit={canUseRichEdit}
              syntaxReasons={syntaxReasons}
              statusMessage={statusMessage}
              realtimeSafeModeMessage={realtimeSafeModeMessage}
              user={user ?? undefined}
              onUserModeChange={setUserMode}
              onPush={onPush}
              onResync={onResync}
              onDownload={() => {
                if (!currentFile) return;
                const blob = new Blob([currentFile.content], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = currentFile.path.split('/').pop() ?? 'document.md';
                a.click();
                URL.revokeObjectURL(url);
              }}
              onLogout={user ? async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/';
              } : undefined}
            />

            <div className="withmd-doc-stage">
              <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill">
                <DocumentSurface
                  mdFileId={currentFile.mdFileId}
                  contentHash={currentFile.contentHash}
                  realtimeEnabled={realtimeEnabled}
                  userMode={userMode}
                  content={currentFile.content}
                  comments={comments}
                  anchorByCommentId={anchorMap}
                  activeCommentId={activeComment?.id ?? null}
                  focusedComment={activeComment}
                  focusRequestId={focusRequestId}
                  sourceValue={sourceValue}
                  onSourceChange={setSourceValue}
                  onEditorContentChange={(next) => {
                    setCurrentFile((prev) => (prev ? { ...prev, content: next } : prev));
                    setSourceValue(next);
                  }}
                  onSelectionDraftChange={setPendingSelection}
                  pendingSelection={pendingSelection}
                  onSelectComment={onSelectComment}
                  onReplyComment={async (parentComment, body) => {
                    await onCreateComment({
                      body,
                      selection: null,
                      parentComment,
                    });
                  }}
                  onCreateDraftComment={async (body, selection) => {
                    await onCreateComment({
                      body,
                      selection,
                    });
                  }}
                  onResolveThread={async (commentIds) => {
                    for (const id of commentIds) {
                      await api.deleteComment(id);
                    }
                    if (activeCommentId && commentIds.includes(activeCommentId)) {
                      setActiveCommentId(null);
                    }
                    await reloadCurrentFileData();
                    await reloadActivity();
                  }}
                  markRequest={markRequest}
                  onMarkRequestApplied={(requestId) => {
                    setMarkRequest((prev) => (prev?.requestId === requestId ? null : prev));
                  }}
                />
              </div>
            </div>
          </section>
        </section>

        <aside className={`withmd-side withmd-side-right ${commentsOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className={`withmd-side-toggle withmd-side-toggle-right ${commentsOpen ? 'is-open' : ''}`}
            onClick={onToggleComments}
          >
            {commentsOpen ? 'Close Comments' : 'Comments'}
          </button>
          <div className="withmd-drawer withmd-drawer-right">
            <div className="withmd-drawer-inner withmd-column withmd-gap-3">
              <CommentsSidebar
                comments={comments}
                pendingSelection={pendingSelection}
                activeCommentId={activeCommentId}
                anchorByCommentId={anchorMap}
                onCreate={onCreateComment}
                onDeleteComment={async (comment) => {
                  await api.deleteComment(comment.id);
                  if (activeCommentId === comment.id) {
                    setActiveCommentId(null);
                  }
                  await reloadCurrentFileData();
                  await reloadActivity();
                }}
                onSelectComment={onSelectComment}
                onClearSelection={() => setPendingSelection(null)}
              />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
