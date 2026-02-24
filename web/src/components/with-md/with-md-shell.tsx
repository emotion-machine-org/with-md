'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import BranchSwitcher from '@/components/with-md/branch-switcher';
import CommentsSidebar from '@/components/with-md/comments-sidebar';
import DiffViewer from '@/components/with-md/diff-viewer';
import DocumentSurface from '@/components/with-md/document-surface';
import DocumentToolbar from '@/components/with-md/document-toolbar';
import FileTree from '@/components/with-md/file-tree';
import ImportDropOverlay from '@/components/with-md/import-drop-overlay';
import ImportReviewSheet from '@/components/with-md/import-review-sheet';
import PushCommitSheet from '@/components/with-md/push-commit-sheet';
import ResyncConflictSheet from '@/components/with-md/resync-conflict-sheet';
import RepoPicker from '@/components/with-md/repo-picker';
import type { ImportReviewRow } from '@/components/with-md/import-review-sheet';
import type { PushCommitRow } from '@/components/with-md/push-commit-sheet';
import type { ResyncConflictRow } from '@/components/with-md/resync-conflict-sheet';
import { useAuth } from '@/hooks/with-md/use-auth';
import { clearReauthFlag, handleGitHubResponse } from '@/lib/with-md/github-fetch';
import { useCommentAnchors } from '@/hooks/with-md/use-comment-anchors';
import { cursorColorForUser } from '@/lib/with-md/cursor-colors';
import { useDocMode } from '@/hooks/with-md/use-doc-mode';
import { getWithMdApi } from '@/lib/with-md/api';
import { INLINE_REALTIME_MAX_BYTES, markdownByteLength } from '@/lib/with-md/collab-policy';
import { hasMeaningfulDiff } from '@/lib/with-md/markdown-diff';
import { detectUnsupportedSyntax } from '@/lib/with-md/syntax';
import type { ActivityItem, CommentRecord, CommentSelectionDraft, ImportConflictMode, MdFile, RepoSummary, UserMode } from '@/lib/with-md/types';

interface Props {
  repoId?: string;
  filePath?: string;
}

const api = getWithMdApi();

interface ImportRowState extends ImportReviewRow {
  relativePath: string;
  content: string;
}

interface ShareLinkSnapshot {
  mdFileId: string;
  viewUrl: string;
  editUrl: string;
  markdownUrl: string;
}

const BRANCH_KEY_PREFIX = 'withmd-branch-';
function readBranchPref(repoId: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return localStorage.getItem(BRANCH_KEY_PREFIX + repoId) || fallback;
}
function writeBranchPref(repoId: string, branch: string): void {
  localStorage.setItem(BRANCH_KEY_PREFIX + repoId, branch);
}

const FILE_KEY_PREFIX = 'withmd-file-';
function readFilePref(repoId: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(FILE_KEY_PREFIX + repoId);
}
function writeFilePref(repoId: string, path: string): void {
  localStorage.setItem(FILE_KEY_PREFIX + repoId, path);
}

const FILES_PANEL_STORAGE_KEY = 'withmd-files-panel-open';
const REPO_STORAGE_KEY = 'withmd-repo';
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
  if (!path) return `/workspace/${encodedRepo}`;
  return `/workspace/${encodedRepo}/${encodePath(path)}`;
}

function toMarkdownRawUrl(viewUrl: string): string {
  try {
    const url = new URL(viewUrl);
    const trimmedPath = url.pathname.replace(/\/+$/, '');
    url.pathname = `${trimmedPath}/raw`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return `${viewUrl.replace(/\/+$/, '')}/raw`;
  }
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
  const collabUser = useMemo(
    () => user?.githubLogin
      ? { name: user.githubLogin, color: cursorColorForUser(user.githubLogin) }
      : undefined,
    [user?.githubLogin],
  );
  // Clear the re-auth loop-prevention flag on successful page load
  useEffect(() => { clearReauthFlag(); }, []);

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
  const [resyncConflictRows, setResyncConflictRows] = useState<ResyncConflictRow[]>([]);
  const [resyncConflictOpen, setResyncConflictOpen] = useState(false);
  const [resyncConflictBusy, setResyncConflictBusy] = useState(false);
  const resyncBodyRef = useRef<Record<string, unknown> | null>(null);
  const [pushCommitRows, setPushCommitRows] = useState<PushCommitRow[]>([]);
  const [pushCommitOpen, setPushCommitOpen] = useState(false);
  const [pushCommitBusy, setPushCommitBusy] = useState(false);
  const [pushCommitMessage, setPushCommitMessage] = useState('');
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [formatBarOpen, setFormatBarOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [branchSwitcherOpen, setBranchSwitcherOpen] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [collabToken, setCollabToken] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const shareLinkSnapshotRef = useRef<ShareLinkSnapshot | null>(null);
  const pendingGitHubPaths = useMemo(() => {
    const merged = new Set(queuedGitHubPaths);
    for (const path of localEditedPaths) {
      merged.add(path);
    }
    return merged;
  }, [queuedGitHubPaths, localEditedPaths]);

  const activeRepo = repos.find((r) => r.repoId === activeRepoId);
  const [currentBranch, setCurrentBranch] = useState('main');

  // Sync branch state with localStorage when repo changes
  useEffect(() => {
    if (!activeRepoId || !activeRepo?.defaultBranch) return;
    const stored = readBranchPref(activeRepoId, activeRepo.defaultBranch);
    setCurrentBranch(stored);
  }, [activeRepoId, activeRepo?.defaultBranch]);

  // Keep the workspace entrypoint cache aligned with the currently active repo.
  useEffect(() => {
    if (!activeRepoId) return;
    localStorage.setItem(REPO_STORAGE_KEY, activeRepoId);
  }, [activeRepoId]);

  // Fetch a signed collab token when the user is authenticated
  useEffect(() => {
    if (!user) {
      setCollabToken(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/collab-token', { method: 'POST' });
        if (!active) return;
        if (!res.ok) {
          setCollabToken(null);
          return;
        }
        const data = (await res.json()) as { token?: string };
        if (active && data.token) {
          setCollabToken(data.token);
        }
      } catch {
        if (active) setCollabToken(null);
      }
    })();
    return () => { active = false; };
  }, [user]);

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
        const loadedRepos = await api.listRepos(user?.userId);
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

        const repo = selectedRepo;
        const initialBranch = readBranchPref(nextRepoId, repo?.defaultBranch || 'main');
        setCurrentBranch(initialBranch);

        const [loadedFiles, queuedPaths] = await Promise.all([
          api.listFilesByRepo(nextRepoId, initialBranch),
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
          const storedPath = readFilePref(nextRepoId);
          if (storedPath) {
            targetFile = loadedFiles.find((f) => f.path === storedPath) ?? null;
          }
        }
        if (!targetFile) {
          targetFile = loadedFiles[0] ?? null;
        }
        setCurrentFileContext(targetFile);
        if (targetFile) {
          writeFilePref(nextRepoId, targetFile.path);
        }

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
    setDiffOpen(false);
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
  const diffAvailable = Boolean(
    currentFile?.lastGithubSha &&
    !currentFile.lastGithubSha.startsWith('local_') &&
    currentFile.lastGithubSha !== 'seed'
  );

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
    setDiffOpen(false);
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

  // Keep anchor recovery tied to last synced content so comment-mark rehydration
  // doesn't thrash on every local keystroke.
  const anchorMap = useCommentAnchors(savedContent, comments);

  const reloadActivity = useCallback(async () => {
    if (!activeRepoId) return;
    const loaded = await api.listActivity(activeRepoId);
    setActivity(loaded);
  }, [activeRepoId]);

  // Flush dirty source content before switching from source → document mode.
  // The source auto-save uses a 1200ms debounce which gets cancelled on mode
  // switch (userMode is a dependency).  Without this flush, CollabEditor would
  // mount with stale content and overwrite sourceValue via onUpdate.
  const flushSourceAndSwitchMode = useCallback(async (next: UserMode) => {
    if (userMode === 'source' && next === 'document' && currentFile && sourceDirty) {
      // Update currentFile.content so non-realtime CollabEditor gets fresh content.
      setCurrentFile((prev) => prev ? { ...prev, content: sourceValue } : prev);

      // Save to server before switching so Hocuspocus bootstraps from fresh content.
      try {
        const result = await api.saveSource({
          mdFileId: currentFile.mdFileId,
          sourceContent: sourceValue,
        });
        if (result.changed) {
          setSavedContent(sourceValue);
          void reloadActivity();
        }
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : 'Save failed.');
      }
    }

    setUserMode(next);
  }, [userMode, currentFile, sourceDirty, sourceValue, setUserMode, reloadActivity]);

  const reloadFiles = useCallback(async () => {
    if (!activeRepoId) {
      setQueuedGitHubPaths(new Set());
      setLocalEditedPaths(new Set());
      return [] as MdFile[];
    }
    const [loaded, queuedPaths] = await Promise.all([
      api.listFilesByRepo(activeRepoId, currentBranch),
      api.listQueuedPaths(activeRepoId),
    ]);
    setFiles(loaded);
    setQueuedGitHubPaths(new Set(queuedPaths));
    setLocalEditedPaths(new Set());
    return loaded;
  }, [activeRepoId, currentBranch]);

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
      targetFile = await api.resolveByPath(activeRepoId, targetPath, currentBranch);
      if (!targetFile) {
        if (fileSwitchRequestIdRef.current !== requestId) return;
        setStatusMessage(`Requested path "${targetPath}" not found.`);
        return;
      }
    }
    if (fileSwitchRequestIdRef.current !== requestId) return;
    setCurrentFileContext(targetFile);
    writeFilePref(activeRepoId, targetFile.path);
    const loadedComments = await api.listCommentsByFile(targetFile.mdFileId);
    if (fileSwitchRequestIdRef.current !== requestId) return;
    setComments(loadedComments);
    if (options?.updateUrl !== false) {
      setUrlForSelection(activeRepoId, targetFile.path, options?.historyMode ?? 'push');
    }
  }, [activeRepoId, currentBranch, files, setCurrentFileContext, setUrlForSelection]);

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
    if (!hasMeaningfulDiff(currentFile.content, savedContent)) return;
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
      const previousActiveCommentId = activeCommentId;
      const commentMarkId = selection?.source === 'edit'
        ? `cmark_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        : parentAnchor?.commentMarkId;
      const optimisticCommentId = `tmpc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const authorId = user?.githubLogin ?? 'local-user';
      const optimisticAnchor = {
        commentMarkId: commentMarkId ?? `cmark_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        textQuote: selection?.textQuote ?? parentAnchor?.textQuote ?? '',
        anchorPrefix: selection?.anchorPrefix ?? parentAnchor?.anchorPrefix ?? '',
        anchorSuffix: selection?.anchorSuffix ?? parentAnchor?.anchorSuffix ?? '',
        anchorHeadingPath: selection?.anchorHeadingPath ?? parentAnchor?.anchorHeadingPath ?? [],
        fallbackLine: selection?.fallbackLine ?? parentAnchor?.fallbackLine ?? 1,
        rangeStart: selection?.rangeStart ?? parentAnchor?.rangeStart,
        rangeEnd: selection?.rangeEnd ?? parentAnchor?.rangeEnd,
      };

      const optimisticComment: CommentRecord = {
        id: optimisticCommentId,
        mdFileId: currentFile.mdFileId,
        authorId,
        body: input.body,
        createdAt: Date.now(),
        parentCommentId: parentComment?.id,
        anchor: optimisticAnchor,
      };

      // Optimistic UI: show comment immediately.
      setComments((prev) => [...prev, optimisticComment]);
      if (selection) {
        setPendingSelection(null);
        window.getSelection()?.removeAllRanges();
      }
      setActiveCommentId(optimisticCommentId);
      setFocusRequestId((prev) => prev + 1);

      let created: CommentRecord;
      try {
        created = await api.createComment({
          mdFileId: currentFile.mdFileId,
          authorId,
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
      } catch (error) {
        // Roll back optimistic insert if server create fails.
        setComments((prev) => prev.filter((comment) => comment.id !== optimisticCommentId));
        setActiveCommentId((prev) => (prev === optimisticCommentId ? previousActiveCommentId ?? null : prev));
        if (selection) {
          setPendingSelection(selection);
        }
        setStatusMessage(error instanceof Error ? error.message : 'Failed to create comment.');
        return;
      }

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

      setComments((prev) => prev.map((comment) => (comment.id === optimisticCommentId ? created : comment)));
      setActiveCommentId((prev) => (prev === optimisticCommentId ? created.id : prev));
      // Reconcile in the background – don't block the UI
      void reloadCurrentFileData();
      void reloadActivity();
    },
    [activeCommentId, currentFile, reloadActivity, reloadCurrentFileData, user?.githubLogin],
  );

  const onSelectComment = useCallback(
    (comment: CommentRecord) => {
      setActiveCommentId(comment.id);
      setFocusRequestId((prev) => prev + 1);
      if (userMode === 'source') {
        void flushSourceAndSwitchMode('document');
      }
      if (!commentsOpen) {
        setCommentsOpen(true);
        setFilesOpen(false);
      }
    },
    [commentsOpen, userMode, flushSourceAndSwitchMode],
  );

  const onResolveThread = useCallback(async (commentIds: string[]) => {
    const uniqueIds = Array.from(new Set(commentIds));
    if (uniqueIds.length === 0) return;
    const resolvingIds = new Set(uniqueIds);
    let skippedForbidden = 0;

    // Optimistic UI: remove resolved thread comments immediately.
    setComments((prev) => prev.filter((comment) => !resolvingIds.has(comment.id)));
    if (activeCommentId && resolvingIds.has(activeCommentId)) {
      setActiveCommentId(null);
    }

    const results = await Promise.allSettled(uniqueIds.map(async (id) => {
      try {
        await api.deleteComment(id);
      } catch (error) {
        // Can happen if another client already resolved/deleted this comment.
        if (error instanceof Error && error.message === 'Forbidden') {
          skippedForbidden += 1;
          return;
        }
        throw error;
      }
    }));

    const hardFailures = results.filter((result) => result.status === 'rejected');
    if (hardFailures.length > 0) {
      await reloadCurrentFileData();
      await reloadActivity();
      const reason = hardFailures[0]!.reason;
      setStatusMessage(reason instanceof Error ? reason.message : 'Failed to resolve comment thread.');
      return;
    }

    // Background reconcile keeps client state aligned without blocking UI.
    void reloadCurrentFileData();
    void reloadActivity();
    if (skippedForbidden > 0) {
      setStatusMessage('Some comments were already resolved in another session.');
    }
  }, [activeCommentId, reloadActivity, reloadCurrentFileData]);

  const onPush = useCallback(async () => {
    if (!activeRepoId) return;
    try {
      const queuedFiles = await api.listQueuedFiles(activeRepoId);
      if (queuedFiles.length === 0) {
        setStatusMessage('Nothing to push.');
        return;
      }
      const rows: PushCommitRow[] = queuedFiles.map((f) => ({
        path: f.path,
        selected: true,
        isDelete: f.isDelete,
      }));
      setPushCommitRows(rows);

      // Generate default commit message
      const updates = queuedFiles.filter((f) => !f.isDelete);
      const deletions = queuedFiles.filter((f) => f.isDelete);
      let defaultMessage: string;
      if (updates.length === 0 && deletions.length === 1) {
        defaultMessage = `Delete ${deletions[0]!.path} via with.md`;
      } else if (deletions.length === 0 && updates.length === 1) {
        defaultMessage = `Update ${updates[0]!.path} via with.md`;
      } else {
        const parts: string[] = [];
        if (updates.length > 0) parts.push(`update ${updates.length} file${updates.length > 1 ? 's' : ''}`);
        if (deletions.length > 0) parts.push(`delete ${deletions.length} file${deletions.length > 1 ? 's' : ''}`);
        const joined = parts.join(', ');
        defaultMessage = `${joined.charAt(0).toUpperCase()}${joined.slice(1)} via with.md`;
      }
      setPushCommitMessage(defaultMessage);
      setPushCommitOpen(true);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to load push queue.');
    }
  }, [activeRepoId]);

  const onPushCommitConfirm = useCallback(async () => {
    if (!activeRepoId) return;
    const selectedPaths = pushCommitRows.filter((r) => r.selected).map((r) => r.path);
    if (selectedPaths.length === 0) return;

    setPushCommitBusy(true);
    setStatusMessage('Pushing to GitHub...');
    try {
      const res = await fetch('/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoId: activeRepoId,
          branch: currentBranch,
          paths: selectedPaths,
          message: pushCommitMessage,
        }),
      });
      handleGitHubResponse(res);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Push failed');
      }
      const data = (await res.json()) as { pushed: number; commitSha: string | null };
      setStatusMessage(data.pushed > 0 ? `Pushed ${data.pushed} file(s) to GitHub.` : 'Nothing to push.');
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Push failed.');
    } finally {
      setPushCommitBusy(false);
      setPushCommitOpen(false);
      setPushCommitRows([]);
      setPushCommitMessage('');
    }
    await reloadFiles();
    await reloadActivity();
  }, [activeRepoId, currentBranch, pushCommitRows, pushCommitMessage, reloadActivity, reloadFiles]);

  const onPushCommitToggle = useCallback((path: string) => {
    setPushCommitRows((prev) => prev.map((r) => (r.path === path ? { ...r, selected: !r.selected } : r)));
  }, []);

  const onPushCommitToggleAll = useCallback(() => {
    setPushCommitRows((prev) => {
      const allSelected = prev.every((r) => r.selected);
      return prev.map((r) => ({ ...r, selected: !allSelected }));
    });
  }, []);

  const onPushCommitCancel = useCallback(() => {
    setPushCommitOpen(false);
    setPushCommitRows([]);
    setPushCommitMessage('');
  }, []);

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
      const activeBranch = currentBranch !== repo.defaultBranch ? currentBranch : undefined;
      const syncBody = {
        installationId: repo.githubInstallationId,
        owner: repo.owner,
        repo: repo.name,
        defaultBranch: repo.defaultBranch,
        githubRepoId: repo.githubRepoId,
        activeBranch,
      };
      const res = await fetch('/api/github/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(syncBody),
      });
      handleGitHubResponse(res);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Sync failed');
      }
      const data = (await res.json()) as { filesCount: number; skippedPaths?: string[] };
      const branchLabel = currentBranch;

      // Reload files
      const loadedFiles = await reloadFiles();
      if (currentFile) {
        const refreshed = loadedFiles.find((f) => f.mdFileId === currentFile.mdFileId);
        if (refreshed) {
          setCurrentFile(refreshed);
          setSourceValue(refreshed.content);
          setSavedContent(refreshed.content);
        } else {
          const fallback = loadedFiles[0] ?? null;
          setCurrentFileContext(fallback);
          if (fallback && activeRepoId) {
            setUrlForSelection(activeRepoId, fallback.path, 'replace');
          }
        }
      }

      // Show conflict dialog if files were skipped
      const skipped = data.skippedPaths ?? [];
      if (skipped.length > 0) {
        resyncBodyRef.current = syncBody;
        setResyncConflictRows(skipped.map((p) => ({ path: p, overwrite: true })));
        setResyncConflictOpen(true);
        setStatusMessage(`Re-synced ${data.filesCount} file(s) from ${branchLabel}. ${skipped.length} file(s) had conflicts.`);
      } else {
        setStatusMessage(`Re-synced ${data.filesCount} file(s) from ${branchLabel}.`);
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Re-sync failed.');
    }
    await reloadActivity();
  }, [activeRepoId, currentBranch, repos, currentFile, reloadActivity, reloadFiles, setCurrentFileContext, setUrlForSelection]);

  const onResyncConflictToggle = useCallback((path: string) => {
    setResyncConflictRows((prev) => prev.map((r) => (r.path === path ? { ...r, overwrite: !r.overwrite } : r)));
  }, []);

  const onResyncConflictToggleAll = useCallback(() => {
    setResyncConflictRows((prev) => {
      const allChecked = prev.every((r) => r.overwrite);
      return prev.map((r) => ({ ...r, overwrite: !allChecked }));
    });
  }, []);

  const onResyncConflictKeepAll = useCallback(() => {
    setResyncConflictOpen(false);
    setResyncConflictRows([]);
    resyncBodyRef.current = null;
  }, []);

  const onResyncConflictOverwrite = useCallback(async () => {
    const body = resyncBodyRef.current;
    if (!body) return;
    const paths = resyncConflictRows.filter((r) => r.overwrite).map((r) => r.path);
    if (paths.length === 0) return;

    setResyncConflictBusy(true);
    try {
      const res = await fetch('/api/github/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, forcePaths: paths }),
      });
      handleGitHubResponse(res);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Force sync failed');
      }
      setStatusMessage(`Overwrote ${paths.length} file(s) with GitHub version.`);

      // Reload files and refresh editor
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
      setStatusMessage(err instanceof Error ? err.message : 'Force sync failed.');
    } finally {
      setResyncConflictBusy(false);
      setResyncConflictOpen(false);
      setResyncConflictRows([]);
      resyncBodyRef.current = null;
    }
  }, [resyncConflictRows, currentFile, reloadFiles]);

  const onBranchSwitch = useCallback(async (branchName: string) => {
    if (!activeRepoId) return;
    const repo = repos.find((r) => r.repoId === activeRepoId);
    if (!repo || !repo.githubInstallationId || !repo.githubRepoId || !repo.defaultBranch) return;

    // Persist branch preference locally
    writeBranchPref(activeRepoId, branchName);
    setCurrentBranch(branchName);

    const activeBranch = branchName === repo.defaultBranch ? undefined : branchName;
    setStatusMessage(`Switching to branch ${branchName}...`);

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
          activeBranch,
        }),
      });
      handleGitHubResponse(res);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Branch switch failed');
      }
      const data = (await res.json()) as { filesCount: number };

      // Reload files for the new branch
      const loadedFiles = await api.listFilesByRepo(activeRepoId, branchName);
      const queuedPaths = await api.listQueuedPaths(activeRepoId);
      setFiles(loadedFiles);
      setQueuedGitHubPaths(new Set(queuedPaths));
      setLocalEditedPaths(new Set());

      // Reset to first file on the new branch
      const firstFile = loadedFiles[0] ?? null;
      setCurrentFileContext(firstFile);
      if (firstFile) {
        const loadedComments = await api.listCommentsByFile(firstFile.mdFileId);
        setComments(loadedComments);
        setUrlForSelection(activeRepoId, firstFile.path, 'replace');
      }

      setStatusMessage(`Switched to ${branchName} (${data.filesCount} files).`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Branch switch failed.');
    }
    await reloadActivity();
  }, [activeRepoId, repos, reloadActivity, setCurrentFileContext, setUrlForSelection]);

  const onCopyShareLink = useCallback(async (mode: 'view' | 'edit' | 'markdown_url') => {
    if (!currentFile || shareBusy) return;

    setShareBusy(true);
    try {
      let snapshot = shareLinkSnapshotRef.current;
      if (!snapshot || snapshot.mdFileId !== currentFile.mdFileId) {
        setStatusMessage('Creating share link...');
        const response = await fetch('/api/repo-share/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mdFileId: currentFile.mdFileId,
          }),
        });
        const data = (await response.json().catch(() => null)) as
          | { viewUrl?: string; editUrl?: string; error?: string }
          | null;
        if (!response.ok || !data?.viewUrl || !data?.editUrl) {
          throw new Error(data?.error ?? 'Could not create share link.');
        }
        snapshot = {
          mdFileId: currentFile.mdFileId,
          viewUrl: data.viewUrl,
          editUrl: data.editUrl,
          markdownUrl: toMarkdownRawUrl(data.viewUrl),
        };
        shareLinkSnapshotRef.current = snapshot;
      }

      const url = mode === 'edit'
        ? snapshot.editUrl
        : mode === 'markdown_url'
          ? snapshot.markdownUrl
          : snapshot.viewUrl;
      await navigator.clipboard.writeText(url);
      setStatusMessage(
        mode === 'edit'
          ? 'Edit share link copied.'
          : mode === 'markdown_url'
            ? 'Raw URL copied.'
            : 'View share link copied.',
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not copy share link.');
    } finally {
      setShareBusy(false);
    }
  }, [currentFile, shareBusy]);

  const onCopyMarkdown = useCallback(async () => {
    if (!currentFile) return;
    const markdown = userMode === 'source' ? sourceValue : currentFile.content;
    try {
      await navigator.clipboard.writeText(markdown);
      setStatusMessage('Markdown copied.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not copy markdown.');
    }
  }, [currentFile, sourceValue, userMode]);

  const onRevert = useCallback(async () => {
    if (!currentFile) return;
    setStatusMessage('Reverting to GitHub version...');
    try {
      const res = await fetch('/api/github/blob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mdFileId: currentFile.mdFileId }),
      });
      handleGitHubResponse(res);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Failed to fetch GitHub version.');
      }
      const data = (await res.json()) as { content: string; sha: string };
      const githubContent = data.content;

      setCurrentFile((prev) => prev ? { ...prev, content: githubContent } : prev);
      setSourceValue(githubContent);
      setSavedContent(githubContent);

      await api.revertToGithub({
        mdFileId: currentFile.mdFileId,
        githubContent,
        githubSha: data.sha,
      });
      setLocalPathDirty(currentFile.path, false);
      setQueuedGitHubPaths((prev) => {
        const next = new Set(prev);
        next.delete(currentFile.path);
        return next;
      });
      setStatusMessage('Reverted to GitHub version.');
      void reloadActivity();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Revert failed.');
    }
  }, [currentFile, reloadActivity, setLocalPathDirty]);

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
        currentBranch,
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
  }, [activeRepoId, currentBranch, importRows, reloadActivity, reloadFiles, setCurrentFileContext, setUrlForSelection]);

  const onMovePath = useCallback(async (input: { fromPath: string; toDirectoryPath: string; isDirectory: boolean }) => {
    if (!activeRepoId) return;
    const result = await api.movePath(activeRepoId, input.fromPath, input.toDirectoryPath, 'keep_both', currentBranch);
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
  }, [activeRepoId, currentBranch, currentFile, reloadActivity, reloadFiles, setCurrentFileContext, setUrlForSelection]);

  const onRenamePath = useCallback(async (input: { fromPath: string; toPath: string; isDirectory: boolean }) => {
    if (!activeRepoId) return;
    const result = await api.renamePath(activeRepoId, input.fromPath, input.toPath, 'keep_both', currentBranch);
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
  }, [activeRepoId, currentBranch, currentFile, reloadActivity, reloadFiles, setCurrentFileContext, setUrlForSelection]);

  const onDeletePath = useCallback(async (input: { path: string; mdFileId: string }) => {
    if (!activeRepoId) return;
    const result = await api.deleteFile(activeRepoId, input.mdFileId);
    if (!result.ok) {
      setStatusMessage(result.reason ?? 'Delete failed.');
      return;
    }
    const loadedFiles = await reloadFiles();
    // If the deleted file was the active file, navigate to another file
    if (currentFile?.mdFileId === input.mdFileId) {
      const nextFile = loadedFiles[0];
      if (nextFile) {
        setCurrentFileContext(nextFile);
        const loadedComments = await api.listCommentsByFile(nextFile.mdFileId);
        setComments(loadedComments);
        setUrlForSelection(activeRepoId, nextFile.path, 'replace');
      } else {
        setCurrentFileContext(null);
        window.history.replaceState(null, '', `/workspace/${encodeURIComponent(activeRepoId)}`);
      }
    }
    await reloadActivity();
    setStatusMessage(`Deleted ${input.path}`);
  }, [activeRepoId, currentFile, reloadActivity, reloadFiles, setCurrentFileContext, setUrlForSelection]);

  const onCreateFile = useCallback(async () => {
    if (!activeRepoId) return;
    const result = await api.importLocalBatch(
      activeRepoId,
      [{ relativePath: 'new.md', content: '', conflictMode: 'keep_both' }],
      currentBranch,
    );
    const loadedFiles = await reloadFiles();
    if (result.firstPath) {
      const nextFile = loadedFiles.find((f) => f.path === result.firstPath);
      if (nextFile) {
        setCurrentFileContext(nextFile);
        const loadedComments = await api.listCommentsByFile(nextFile.mdFileId);
        setComments(loadedComments);
      }
      setUrlForSelection(activeRepoId, result.firstPath, 'push');
    }
    await reloadActivity();
  }, [activeRepoId, currentBranch, reloadActivity, reloadFiles, setCurrentFileContext, setUrlForSelection]);

  const onOpenRepoPicker = useCallback(() => {
    setRepoPickerOpen(true);
  }, []);

  const onRepoPickerSelect = useCallback((result: { repoId: string }) => {
    setRepoPickerOpen(false);
    if (result.repoId === activeRepoId) return;
    localStorage.setItem(REPO_STORAGE_KEY, result.repoId);
    window.location.href = `/workspace/${encodeURIComponent(result.repoId)}`;
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
                currentBranch={currentBranch}
                onOpenRepoPicker={onOpenRepoPicker}
                onOpenBranchSwitcher={activeRepo?.githubInstallationId ? () => setBranchSwitcherOpen(true) : undefined}
                onSelectPath={(path) => {
                  if (path === currentFile.path) return;
                  void selectFileByPath(path, { updateUrl: true, historyMode: 'push' });
                }}
                onMovePath={onMovePath}
                onRenamePath={onRenamePath}
                onDeletePath={onDeletePath}
                onCreateFile={onCreateFile}
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
          <section className={`withmd-doc-shell${diffOpen ? ' withmd-doc-shell-diff' : ''}`}>
            <DocumentToolbar
              userMode={userMode}
              canUseRichEdit={canUseRichEdit}
              syntaxReasons={syntaxReasons}
              statusMessage={statusMessage}
              realtimeSafeModeMessage={realtimeSafeModeMessage}
              user={user ?? undefined}
              peerCount={peerCount}
              diffOpen={diffOpen}
              diffAvailable={diffAvailable}
              onToggleDiff={() => setDiffOpen((prev) => !prev)}
              onRevert={() => void onRevert()}
              formatBarOpen={formatBarOpen}
              onToggleFormatBar={() => setFormatBarOpen((v) => !v)}
              onUserModeChange={(next) => void flushSourceAndSwitchMode(next)}
              onCreateFile={onCreateFile}
              onPush={onPush}
              onResync={onResync}
              onCopyMarkdown={onCopyMarkdown}
              onCopyShareLink={onCopyShareLink}
              shareBusy={shareBusy}
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
              {diffOpen ? (
                <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill">
                  <DiffViewer
                    fileName={currentFile.path.split('/').pop() ?? 'document.md'}
                    mdFileId={currentFile.mdFileId}
                    currentContent={userMode === 'source' ? sourceValue : currentFile.content}
                    onError={(msg) => setStatusMessage(msg)}
                    onClose={() => setDiffOpen(false)}
                  />
                </div>
              ) : (
              <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill">
                <DocumentSurface
                  // Force a full editor/provider reset when canonical server content changes.
                  // This prevents stale in-memory Yjs state from replaying after re-sync/revert.
                  key={`${currentFile.mdFileId}:${currentFile.contentHash}`}
                  mdFileId={currentFile.mdFileId}
                  contentHash={currentFile.contentHash}
                  realtimeEnabled={realtimeEnabled}
                  userMode={userMode}
                  content={currentFile.content}
                  authToken={collabToken}
                  collabUser={collabUser}
                  onPeerCountChange={setPeerCount}
                  filePath={currentFile.path}
                  formatBarOpen={formatBarOpen}
                  commentsOpen={commentsOpen}
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
                  onResolveThread={onResolveThread}
                  markRequest={markRequest}
                  onMarkRequestApplied={(requestId) => {
                    setMarkRequest((prev) => (prev?.requestId === requestId ? null : prev));
                  }}
                />
              </div>
              )}
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
                onReplyComment={async (parentComment, body) => {
                  await onCreateComment({
                    body,
                    selection: null,
                    parentComment,
                  });
                }}
                onResolveThread={onResolveThread}
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
      <ResyncConflictSheet
        open={resyncConflictOpen}
        rows={resyncConflictRows}
        busy={resyncConflictBusy}
        onToggle={onResyncConflictToggle}
        onToggleAll={onResyncConflictToggleAll}
        onOverwrite={() => void onResyncConflictOverwrite()}
        onKeepAll={onResyncConflictKeepAll}
      />
      <PushCommitSheet
        open={pushCommitOpen}
        rows={pushCommitRows}
        commitMessage={pushCommitMessage}
        busy={pushCommitBusy}
        onToggle={onPushCommitToggle}
        onToggleAll={onPushCommitToggleAll}
        onCommitMessageChange={setPushCommitMessage}
        onPush={() => void onPushCommitConfirm()}
        onCancel={onPushCommitCancel}
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
      {branchSwitcherOpen && activeRepo?.githubInstallationId && activeRepo.defaultBranch && (
        <BranchSwitcher
          installationId={activeRepo.githubInstallationId}
          owner={activeRepo.owner}
          repo={activeRepo.name}
          defaultBranch={activeRepo.defaultBranch}
          currentBranch={currentBranch}
          onSwitch={(branch) => void onBranchSwitch(branch)}
          onClose={() => setBranchSwitcherOpen(false)}
        />
      )}
    </main>
  );
}
