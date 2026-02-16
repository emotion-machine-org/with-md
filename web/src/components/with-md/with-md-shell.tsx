'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import CommentsSidebar from '@/components/with-md/comments-sidebar';
import DocumentSurface from '@/components/with-md/document-surface';
import DocumentToolbar from '@/components/with-md/document-toolbar';
import FileTree from '@/components/with-md/file-tree';
import ImportDropOverlay from '@/components/with-md/import-drop-overlay';
import ImportReviewSheet from '@/components/with-md/import-review-sheet';
import RepoPicker from '@/components/with-md/repo-picker';
import type { ImportReviewRow } from '@/components/with-md/import-review-sheet';
import { useAuth } from '@/hooks/with-md/use-auth';
import { useCommentAnchors } from '@/hooks/with-md/use-comment-anchors';
import { useDocMode } from '@/hooks/with-md/use-doc-mode';
import { getWithMdApi } from '@/lib/with-md/api';
import { INLINE_REALTIME_MAX_BYTES, markdownByteLength } from '@/lib/with-md/collab-policy';
import { hasMeaningfulDiff } from '@/lib/with-md/markdown-diff';
import { detectUnsupportedSyntax } from '@/lib/with-md/syntax';
import type { ActivityItem, CommentRecord, CommentSelectionDraft, ImportConflictMode, MdFile, RepoSummary } from '@/lib/with-md/types';

interface Props {
  repoId?: string;
  filePath?: string;
}

const api = getWithMdApi();

interface ImportRowState extends ImportReviewRow {
  relativePath: string;
  content: string;
}

const FILES_PANEL_STORAGE_KEY = 'withmd-files-panel-open';
const SIDE_TOGGLE_MIN_WIDTH = 48;
const SIDE_TOGGLE_MAX_WIDTH = 96;
const SIDE_TOGGLE_INTENT_RANGE = 192;

function readFilesPanelOpenPreference(): boolean {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(FILES_PANEL_STORAGE_KEY) === '1';
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildWithMdPath(repo: string, path?: string): string {
  const encodedRepo = encodeURIComponent(repo);
  if (!path) return `/with-md/${encodedRepo}`;
  return `/with-md/${encodedRepo}/${encodePath(path)}`;
}

function parseWithMdLocationPath(pathname: string): { repoId: string; filePath?: string } | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'with-md' || !segments[1]) return null;
  const repo = decodeURIComponent(segments[1]);
  const fileSegments = segments.slice(2).map((segment) => decodeURIComponent(segment));
  return {
    repoId: repo,
    filePath: fileSegments.length > 0 ? fileSegments.join('/') : undefined,
  };
}

function normalizePathInput(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return null;
  const segments = normalized.split('/');
  const cleaned: string[] = [];
  for (const raw of segments) {
    const segment = raw.trim();
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    cleaned.push(segment);
  }
  if (cleaned.length === 0) return null;
  return cleaned.join('/');
}

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function hasPathConflict(path: string, files: MdFile[]): boolean {
  return files.some((file) => file.path === path);
}

function normalizeImportRow(row: ImportRowState, files: MdFile[]): ImportRowState {
  const normalizedTarget = normalizePathInput(row.targetPath);
  const isValid = Boolean(normalizedTarget && isMarkdownPath(normalizedTarget));
  const hasExistingConflict = Boolean(isValid && normalizedTarget && hasPathConflict(normalizedTarget, files));
  return {
    ...row,
    targetPath: normalizedTarget ?? row.targetPath,
    isValid,
    hasExistingConflict,
  };
}

function remapPathAfterRewrite(currentPath: string, fromPath: string, toPath: string): string | null {
  if (currentPath === fromPath) return toPath;
  if (currentPath.startsWith(`${fromPath}/`)) {
    return `${toPath}${currentPath.slice(fromPath.length)}`;
  }
  return null;
}

export default function WithMdShell({ repoId, filePath }: Props) {
  const { user } = useAuth();
  const filesPanelRef = useRef<HTMLElement | null>(null);
  const filesToggleRef = useRef<HTMLButtonElement | null>(null);
  const commentsToggleRef = useRef<HTMLButtonElement | null>(null);
  const toggleIntentRef = useRef({ left: 0, right: 0 });
  const fileSwitchRequestIdRef = useRef(0);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [activeRepoId, setActiveRepoId] = useState('');
  const [files, setFiles] = useState<MdFile[]>([]);
  const [queuedGitHubPaths, setQueuedGitHubPaths] = useState<Set<string>>(new Set());
  const [localEditedPaths, setLocalEditedPaths] = useState<Set<string>>(new Set());
  const [currentFile, setCurrentFile] = useState<MdFile | null>(null);
  const [filesOpen, setFilesOpen] = useState(readFilesPanelOpenPreference);
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
  const [importRows, setImportRows] = useState<ImportRowState[]>([]);
  const [importReviewOpen, setImportReviewOpen] = useState(false);
  const [importOverlayVisible, setImportOverlayVisible] = useState(false);
  const [importProcessing, setImportProcessing] = useState(false);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [formatBarOpen, setFormatBarOpen] = useState(false);
  const pendingGitHubPaths = useMemo(() => {
    const merged = new Set(queuedGitHubPaths);
    for (const path of localEditedPaths) {
      merged.add(path);
    }
    return merged;
  }, [queuedGitHubPaths, localEditedPaths]);

  const setUrlForSelection = useCallback((nextRepoId: string, nextPath?: string, mode: 'push' | 'replace' = 'push') => {
    if (typeof window === 'undefined') return;
    const target = buildWithMdPath(nextRepoId, nextPath);
    if (window.location.pathname === target) return;
    if (mode === 'replace') {
      window.history.replaceState(window.history.state, '', target);
      return;
    }
    window.history.pushState(window.history.state, '', target);
  }, []);

  const setCurrentFileContext = useCallback((nextFile: MdFile | null) => {
    setCurrentFile(nextFile);
    if (nextFile) {
      setSourceValue(nextFile.content);
      setSavedContent(nextFile.content);
      return;
    }
    setSourceValue('');
    setSavedContent('');
  }, []);

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
          setQueuedGitHubPaths(new Set());
          setLocalEditedPaths(new Set());
          setCurrentFileContext(null);
          return;
        }
        setActiveRepoId(nextRepoId);

        const [loadedFiles, queuedPaths] = await Promise.all([
          api.listFilesByRepo(nextRepoId),
          api.listQueuedPaths(nextRepoId),
        ]);
        if (!active) return;
        setFiles(loadedFiles);
        setQueuedGitHubPaths(new Set(queuedPaths));
        setLocalEditedPaths(new Set());

        let targetFile: MdFile | null = null;
        const parsedLocation = typeof window === 'undefined' ? null : parseWithMdLocationPath(window.location.pathname);
        const requestedPathFromLocation =
          parsedLocation?.repoId === nextRepoId
            ? parsedLocation.filePath
            : undefined;
        const requestedPath = filePath ?? requestedPathFromLocation;
        if (requestedPath) {
          targetFile =
            loadedFiles.find((file) => file.path === requestedPath) ??
            (await api.resolveByPath(nextRepoId, requestedPath));
          if (!active) return;
          if (!targetFile) {
            setStatusMessage(
              loadedFiles[0]
                ? `Requested path "${requestedPath}" not found. Showing "${loadedFiles[0].path}".`
                : `Requested path "${requestedPath}" not found.`,
            );
          }
        }
        if (!targetFile) {
          targetFile = loadedFiles[0] ?? null;
        }
        setCurrentFileContext(targetFile);

        if (targetFile) {
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
  }, [filePath, repoId, setCurrentFileContext]);

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
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(FILES_PANEL_STORAGE_KEY, filesOpen ? '1' : '0');
  }, [filesOpen]);

  const applyToggleIntent = useCallback((leftRawIntent: number, rightRawIntent: number) => {
    const clampedLeft = Math.max(0, Math.min(1, leftRawIntent));
    const clampedRight = Math.max(0, Math.min(1, rightRawIntent));
    const leftIntent = filesOpen ? 0 : clampedLeft;
    const rightIntent = commentsOpen ? 0 : clampedRight;
    const widthDelta = SIDE_TOGGLE_MAX_WIDTH - SIDE_TOGGLE_MIN_WIDTH;
    const leftWidth = SIDE_TOGGLE_MIN_WIDTH + widthDelta * leftIntent;
    const rightWidth = SIDE_TOGGLE_MIN_WIDTH + widthDelta * rightIntent;

    const filesToggle = filesToggleRef.current;
    if (filesToggle) {
      filesToggle.style.setProperty('--withmd-toggle-width', `${leftWidth.toFixed(2)}px`);
      filesToggle.style.setProperty('--withmd-toggle-intent', leftIntent.toFixed(3));
    }

    const commentsToggle = commentsToggleRef.current;
    if (commentsToggle) {
      commentsToggle.style.setProperty('--withmd-toggle-width', `${rightWidth.toFixed(2)}px`);
      commentsToggle.style.setProperty('--withmd-toggle-intent', rightIntent.toFixed(3));
    }
  }, [commentsOpen, filesOpen]);

  useEffect(() => {
    const { left, right } = toggleIntentRef.current;
    applyToggleIntent(left, right);
  }, [applyToggleIntent]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!hasFinePointer || prefersReducedMotion) {
      toggleIntentRef.current = { left: 0, right: 0 };
      applyToggleIntent(0, 0);
      return;
    }

    let rafId = 0;

    const toIntent = (distanceFromEdge: number): number => {
      const clampedDistance = Math.max(0, Math.min(SIDE_TOGGLE_INTENT_RANGE, distanceFromEdge));
      const linear = 1 - (clampedDistance / SIDE_TOGGLE_INTENT_RANGE);
      return linear * linear;
    };

    const updateFromX = (x: number) => {
      const viewportWidth = window.innerWidth;
      if (viewportWidth <= 0) return;
      const leftIntent = toIntent(x);
      const rightIntent = toIntent(viewportWidth - x);
      const previous = toggleIntentRef.current;
      if (Math.abs(leftIntent - previous.left) < 0.005 && Math.abs(rightIntent - previous.right) < 0.005) return;
      toggleIntentRef.current = { left: leftIntent, right: rightIntent };
      applyToggleIntent(leftIntent, rightIntent);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const x = event.clientX;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        updateFromX(x);
      });
    };

    const resetIntent = () => {
      toggleIntentRef.current = { left: 0, right: 0 };
      applyToggleIntent(0, 0);
    };

    const onMouseOut = (event: MouseEvent) => {
      if (event.relatedTarget) return;
      resetIntent();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('blur', resetIntent);
    window.addEventListener('mouseout', onMouseOut);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('blur', resetIntent);
      window.removeEventListener('mouseout', onMouseOut);
    };
  }, [applyToggleIntent]);

  useEffect(() => {
    if (!filesOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const targetNode = event.target as Node | null;
      if (!targetNode) return;
      if (filesPanelRef.current?.contains(targetNode)) return;
      const targetElement = targetNode instanceof HTMLElement ? targetNode : targetNode.parentElement;
      if (targetElement?.closest('.withmd-center')) return;
      setFilesOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [filesOpen]);

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

  const reloadFiles = useCallback(async () => {
    if (!activeRepoId) {
      setQueuedGitHubPaths(new Set());
      setLocalEditedPaths(new Set());
      return [] as MdFile[];
    }
    const [loaded, queuedPaths] = await Promise.all([
      api.listFilesByRepo(activeRepoId),
      api.listQueuedPaths(activeRepoId),
    ]);
    setFiles(loaded);
    setQueuedGitHubPaths(new Set(queuedPaths));
    setLocalEditedPaths(new Set());
    return loaded;
  }, [activeRepoId]);

  const setLocalPathDirty = useCallback((path: string, dirty: boolean) => {
    setLocalEditedPaths((prev) => {
      const next = new Set(prev);
      if (dirty) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }, []);

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

  const selectFileByPath = useCallback(async (
    targetPath: string,
    options?: { updateUrl?: boolean; historyMode?: 'push' | 'replace' },
  ) => {
    if (!activeRepoId) return;
    const requestId = ++fileSwitchRequestIdRef.current;
    let targetFile = files.find((file) => file.path === targetPath) ?? null;
    if (!targetFile) {
      targetFile = await api.resolveByPath(activeRepoId, targetPath);
      if (!targetFile) {
        if (fileSwitchRequestIdRef.current !== requestId) return;
        setStatusMessage(`Requested path "${targetPath}" not found.`);
        return;
      }
    }
    if (fileSwitchRequestIdRef.current !== requestId) return;
    setCurrentFileContext(targetFile);
    const loadedComments = await api.listCommentsByFile(targetFile.mdFileId);
    if (fileSwitchRequestIdRef.current !== requestId) return;
    setComments(loadedComments);
    if (options?.updateUrl !== false) {
      setUrlForSelection(activeRepoId, targetFile.path, options?.historyMode ?? 'push');
    }
  }, [activeRepoId, files, setCurrentFileContext, setUrlForSelection]);

  useEffect(() => {
    if (!activeRepoId) return;
    const onPopState = () => {
      const parsed = parseWithMdLocationPath(window.location.pathname);
      if (!parsed || parsed.repoId !== activeRepoId || !parsed.filePath) return;
      if (currentFile?.path === parsed.filePath) return;
      void selectFileByPath(parsed.filePath, { updateUrl: false });
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [activeRepoId, currentFile?.path, selectFileByPath]);

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
    await reloadFiles();
    await reloadActivity();
  }, [activeRepoId, reloadActivity, reloadFiles]);

  const onResync = useCallback(async () => {
    if (!activeRepoId) return;
    setStatusMessage('Re-syncing from GitHub...');

    // Find the active repo to get installation details
    const repo = repos.find((r) => r.repoId === activeRepoId);
    if (!repo || !repo.githubInstallationId || !repo.githubRepoId || !repo.defaultBranch) {
      // Fallback to old Convex resync
      await api.resync(activeRepoId);
      await reloadFiles();
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
      const loadedFiles = await reloadFiles();
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
  }, [activeRepoId, repos, currentFile, reloadActivity, reloadFiles]);

  const openImportReviewFromFileList = useCallback(async (fileList: FileList) => {
    const dropped = Array.from(fileList);
    if (dropped.length === 0) {
      setImportOverlayVisible(false);
      return;
    }

    const rows: ImportRowState[] = [];
    for (const file of dropped) {
      const sourceName = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const normalizedPath = normalizePathInput(sourceName) ?? file.name;
      if (!isMarkdownPath(normalizedPath)) continue;
      rows.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sourceName,
        relativePath: sourceName,
        targetPath: normalizedPath,
        conflictMode: 'keep_both',
        hasExistingConflict: hasPathConflict(normalizedPath, files),
        isValid: true,
        content: await file.text(),
      });
    }

    if (rows.length === 0) {
      setImportOverlayVisible(false);
      setStatusMessage('Only .md and .markdown files are supported for import.');
      return;
    }

    setImportRows(rows.map((row) => normalizeImportRow(row, files)));
    setImportReviewOpen(true);
    setImportOverlayVisible(false);
  }, [files]);

  useEffect(() => {
    let dragDepth = 0;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      if (!importProcessing) {
        setImportOverlayVisible(true);
      }
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0 && !importProcessing) {
        setImportOverlayVisible(false);
      }
    };

    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      const droppedFiles = event.dataTransfer?.files;
      if (!droppedFiles) return;
      void openImportReviewFromFileList(droppedFiles);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [importProcessing, openImportReviewFromFileList]);

  const onUpdateImportRow = useCallback((id: string, patch: Partial<Pick<ImportReviewRow, 'targetPath' | 'conflictMode'>>) => {
    setImportRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const nextRow: ImportRowState = {
          ...row,
          targetPath: patch.targetPath ?? row.targetPath,
          conflictMode: (patch.conflictMode ?? row.conflictMode) as ImportConflictMode,
        };
        return normalizeImportRow(nextRow, files);
      }),
    );
  }, [files]);

  const onSubmitImportReview = useCallback(async () => {
    if (!activeRepoId) return;
    const validRows = importRows.filter((row) => row.isValid);
    if (validRows.length === 0) {
      setStatusMessage('No valid markdown files to import.');
      return;
    }

    setImportProcessing(true);
    setImportOverlayVisible(true);
    try {
      const result = await api.importLocalBatch(
        activeRepoId,
        validRows.map((row) => ({
          relativePath: row.relativePath,
          targetPath: row.targetPath,
          content: row.content,
          conflictMode: row.conflictMode,
        })),
      );

      const loadedFiles = await reloadFiles();
      if (result.firstPath) {
        const nextFile = loadedFiles.find((file) => file.path === result.firstPath);
        if (nextFile) {
          setCurrentFileContext(nextFile);
          const loadedComments = await api.listCommentsByFile(nextFile.mdFileId);
          setComments(loadedComments);
        }
        setUrlForSelection(activeRepoId, result.firstPath, 'push');
      }
      await reloadActivity();

      setStatusMessage(
        `Imported ${result.imported} new, ${result.updated} replaced, ${result.autoRenamed} keep-both, ${result.unchanged} unchanged, ${result.invalid} invalid.`,
      );
      setImportReviewOpen(false);
      setImportRows([]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setImportProcessing(false);
      setImportOverlayVisible(false);
    }
  }, [activeRepoId, importRows, reloadActivity, reloadFiles, setCurrentFileContext, setUrlForSelection]);

  const onMovePath = useCallback(async (input: { fromPath: string; toDirectoryPath: string; isDirectory: boolean }) => {
    if (!activeRepoId) return;
    const result = await api.movePath(activeRepoId, input.fromPath, input.toDirectoryPath, 'keep_both');
    if (!result.ok) {
      setStatusMessage(result.reason ?? 'Move failed.');
      return;
    }

    const loadedFiles = await reloadFiles();
    if (currentFile && result.moved) {
      const movedCurrent = result.moved.find((entry) => entry.mdFileId === currentFile.mdFileId);
      if (movedCurrent) {
        const refreshed = loadedFiles.find((file) => file.mdFileId === currentFile.mdFileId);
        if (refreshed) {
          setCurrentFileContext(refreshed);
          const loadedComments = await api.listCommentsByFile(refreshed.mdFileId);
          setComments(loadedComments);
          setUrlForSelection(activeRepoId, refreshed.path, 'replace');
        }
      } else {
        const remapped = remapPathAfterRewrite(currentFile.path, input.fromPath, result.toPath ?? input.toDirectoryPath);
        if (remapped) {
          setUrlForSelection(activeRepoId, remapped, 'replace');
        }
      }
    }

    await reloadActivity();
    setStatusMessage(`Moved ${result.movedCount ?? 0} path(s).`);
  }, [activeRepoId, currentFile, reloadActivity, reloadFiles, setCurrentFileContext, setUrlForSelection]);

  const onRenamePath = useCallback(async (input: { fromPath: string; toPath: string; isDirectory: boolean }) => {
    if (!activeRepoId) return;
    const result = await api.renamePath(activeRepoId, input.fromPath, input.toPath, 'keep_both');
    if (!result.ok) {
      setStatusMessage(result.reason ?? 'Rename failed.');
      return;
    }

    const loadedFiles = await reloadFiles();
    if (currentFile && result.moved) {
      const movedCurrent = result.moved.find((entry) => entry.mdFileId === currentFile.mdFileId);
      if (movedCurrent) {
        const refreshed = loadedFiles.find((file) => file.mdFileId === currentFile.mdFileId);
        if (refreshed) {
          setCurrentFileContext(refreshed);
          const loadedComments = await api.listCommentsByFile(refreshed.mdFileId);
          setComments(loadedComments);
          setUrlForSelection(activeRepoId, refreshed.path, 'replace');
        }
      }
    }

    await reloadActivity();
    setStatusMessage(`Renamed ${result.renamedCount ?? result.movedCount ?? 0} path(s).`);
  }, [activeRepoId, currentFile, reloadActivity, reloadFiles, setCurrentFileContext, setUrlForSelection]);

  const onOpenRepoPicker = useCallback(() => {
    setRepoPickerOpen(true);
  }, []);

  const onRepoPickerSelect = useCallback((result: { repoId: string }) => {
    setRepoPickerOpen(false);
    if (result.repoId === activeRepoId) return;
    window.location.href = `/with-md/${encodeURIComponent(result.repoId)}`;
  }, [activeRepoId]);

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
        <aside ref={filesPanelRef} className={`withmd-side withmd-side-left ${filesOpen ? 'is-open' : ''}`}>
          <div className="withmd-drawer withmd-drawer-left">
            <div className="withmd-drawer-inner">
              <FileTree
                repoId={activeRepoId || currentFile.repoId}
                files={files}
                activePath={currentFile.path}
                pendingPaths={pendingGitHubPaths}
                activeRepo={repos.find((r) => r.repoId === activeRepoId)}
                onOpenRepoPicker={onOpenRepoPicker}
                onSelectPath={(path) => {
                  if (path === currentFile.path) return;
                  void selectFileByPath(path, { updateUrl: true, historyMode: 'push' });
                }}
                onMovePath={onMovePath}
                onRenamePath={onRenamePath}
              />
            </div>
          </div>
          <button
            ref={filesToggleRef}
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
              formatBarOpen={formatBarOpen}
              onToggleFormatBar={() => setFormatBarOpen((v) => !v)}
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
                  key={currentFile.mdFileId}
                  mdFileId={currentFile.mdFileId}
                  contentHash={currentFile.contentHash}
                  realtimeEnabled={realtimeEnabled}
                  userMode={userMode}
                  content={currentFile.content}
                  formatBarOpen={formatBarOpen}
                  comments={comments}
                  anchorByCommentId={anchorMap}
                  activeCommentId={activeComment?.id ?? null}
                  focusedComment={activeComment}
                  focusRequestId={focusRequestId}
                  sourceValue={sourceValue}
                  onSourceChange={(next) => {
                    setSourceValue(next);
                    if (currentFile) {
                      setLocalPathDirty(currentFile.path, hasMeaningfulDiff(next, savedContent));
                    }
                  }}
                  onEditorContentChange={(next) => {
                    if (currentFile) {
                      setLocalPathDirty(currentFile.path, hasMeaningfulDiff(next, savedContent));
                    }
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
            ref={commentsToggleRef}
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

      <ImportDropOverlay
        visible={importOverlayVisible || importProcessing}
        processing={importProcessing}
        fileCount={importRows.length}
      />
      <ImportReviewSheet
        open={importReviewOpen}
        rows={importRows}
        busy={importProcessing}
        onUpdateRow={onUpdateImportRow}
        onCancel={() => {
          if (importProcessing) return;
          setImportReviewOpen(false);
          setImportRows([]);
        }}
        onSubmit={() => void onSubmitImportReview()}
      />
      {repoPickerOpen && (
        <div className="withmd-repo-picker-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) setRepoPickerOpen(false);
        }}>
          <div className="withmd-repo-picker-modal">
            <button
              type="button"
              className="withmd-repo-picker-close"
              onClick={() => setRepoPickerOpen(false)}
              aria-label="Close"
            >
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <RepoPicker onSelect={onRepoPickerSelect} />
          </div>
        </div>
      )}
    </main>
  );
}
