import { extractHeadingPathAtIndex, pickBestQuoteIndex } from '@/lib/with-md/anchor';
import { WITH_MD_CONVEX_FUNCTIONS } from '@/lib/with-md/convex-functions';
import { detectUnsupportedSyntax } from '@/lib/with-md/syntax';
import type {
  ActivityItem,
  CommentAnchorSnapshot,
  CommentRecord,
  FileCategory,
  ImportConflictMode,
  LocalImportFileInput,
  LocalImportResult,
  MdFile,
  PathRewriteResult,
  RepoSummary,
  SyntaxSupportStatus,
  UndoFileOperationResult,
} from '@/lib/with-md/types';

interface CreateCommentInput {
  mdFileId: string;
  authorId: string;
  body: string;
  parentCommentId?: string;
  commentMarkId?: string;
  textQuote: string;
  fallbackLine: number;
  anchorPrefix?: string;
  anchorSuffix?: string;
  anchorHeadingPath?: string[];
  rangeStart?: number;
  rangeEnd?: number;
}

interface SaveSourceInput {
  mdFileId: string;
  sourceContent: string;
}

interface WithMdRepoRow {
  _id: string;
  owner: string;
  name: string;
  installationId?: string;
  githubRepoId?: number;
  defaultBranch?: string;
  activeBranch?: string;
  githubInstallationId?: number | null;
}

interface WithMdFileRow {
  _id: string;
  repoId: string;
  path: string;
  branch?: string;
  content: string;
  contentHash: string;
  fileCategory: string;
  editHeartbeat?: number;
  pendingGithubContent?: string;
  isDeleted?: boolean;
  deletedAt?: number;
  syntaxSupportStatus?: string;
  syntaxSupportReasons?: string[];
  isOversized?: boolean;
  lastOversizeBytes?: number;
  oversizeUpdatedAt?: number;
  lastGithubSha?: string;
}

interface WithMdCommentRow {
  _id: string;
  mdFileId: string;
  authorId: string;
  body: string;
  createdAt?: number;
  resolvedAt?: number;
  resolvedBy?: string;
  parentCommentId?: string;
  commentMarkId?: string;
  textQuote?: string;
  anchorPrefix?: string;
  anchorSuffix?: string;
  anchorHeadingPath?: string[];
  fallbackLine?: number;
  rangeStart?: number;
  rangeEnd?: number;
  _creationTime?: number;
}

interface WithMdActivityRow {
  _id: string;
  type: ActivityItem['type'];
  summary: string;
  createdAt?: number;
  _creationTime?: number;
}

interface WithMdPushQueueRow {
  path: string;
  isDelete?: boolean;
}

export interface WithMdApi {
  listRepos(userId?: string): Promise<RepoSummary[]>;
  listFilesByRepo(repoId: string, branch?: string): Promise<MdFile[]>;
  listQueuedPaths(repoId: string): Promise<string[]>;
  listQueuedFiles(repoId: string): Promise<{ path: string; isDelete: boolean }[]>;
  resolveByPath(repoId: string, path: string, branch?: string): Promise<MdFile | null>;
  getFile(mdFileId: string): Promise<MdFile | null>;
  listCommentsByFile(mdFileId: string): Promise<CommentRecord[]>;
  createComment(input: CreateCommentInput): Promise<CommentRecord>;
  deleteComment(commentId: string): Promise<void>;
  saveSource(input: SaveSourceInput): Promise<{ changed: boolean }>;
  revertToGithub(input: { mdFileId: string; githubContent: string; githubSha: string }): Promise<void>;
  importLocalBatch(repoId: string, files: LocalImportFileInput[], branch?: string): Promise<LocalImportResult>;
  movePath(repoId: string, fromPath: string, toDirectoryPath: string, conflictMode?: ImportConflictMode, branch?: string): Promise<PathRewriteResult>;
  renamePath(repoId: string, fromPath: string, toPath: string, conflictMode?: ImportConflictMode, branch?: string): Promise<PathRewriteResult>;
  undoFileOperation(repoId: string, undoPayload: string): Promise<UndoFileOperationResult>;
  deleteFile(repoId: string, mdFileId: string): Promise<{ ok: boolean; deletedPath?: string; reason?: string }>;
  listActivity(repoId: string): Promise<ActivityItem[]>;
  pushNow(repoId: string): Promise<{ ok: boolean }>;
  resync(repoId: string): Promise<{ ok: boolean }>;
}

function nowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function indexFromLineNumber(content: string, lineNumber: number): number {
  if (!Number.isFinite(lineNumber) || lineNumber <= 1) return 0;
  const target = Math.floor(lineNumber);
  let line = 1;
  for (let i = 0; i < content.length; i += 1) {
    if (line >= target) return i;
    if (content[i] === '\n') line += 1;
  }
  return content.length;
}

function normalizeCategory(input: string): FileCategory {
  const value = input.toLowerCase();
  if (value === 'readme') return 'readme';
  if (value === 'prompt') return 'prompt';
  if (value === 'agent') return 'agent';
  if (value === 'claude') return 'claude';
  if (value === 'docs') return 'docs';
  return 'other';
}

function mapRepo(row: WithMdRepoRow): RepoSummary {
  return {
    repoId: row._id,
    owner: row.owner,
    name: row.name,
    installationId: row.installationId,
    githubRepoId: row.githubRepoId,
    defaultBranch: row.defaultBranch,
    activeBranch: row.activeBranch,
    githubInstallationId: row.githubInstallationId ?? undefined,
  };
}

function mapFile(row: WithMdFileRow): MdFile {
  // Recompute from live content to avoid stale backend flags locking files in unsupported mode.
  const detected = detectUnsupportedSyntax(row.content);
  const syntax: { status: SyntaxSupportStatus; reasons: string[] } = {
    status: detected.supported ? 'supported' : 'unsupported',
    reasons: detected.reasons,
  };

  return {
    mdFileId: row._id,
    repoId: row.repoId,
    path: row.path,
    branch: row.branch,
    content: row.content,
    contentHash: row.contentHash,
    fileCategory: normalizeCategory(row.fileCategory),
    editHeartbeat: row.editHeartbeat,
    pendingGithubContent: row.pendingGithubContent,
    isDeleted: row.isDeleted,
    deletedAt: row.deletedAt,
    syntaxSupportStatus: syntax.status,
    syntaxSupportReasons: syntax.reasons,
    isOversized: row.isOversized,
    lastOversizeBytes: row.lastOversizeBytes,
    oversizeUpdatedAt: row.oversizeUpdatedAt,
    lastGithubSha: row.lastGithubSha,
  };
}

function mapComment(row: WithMdCommentRow): CommentRecord {
  const createdAt = row.createdAt ?? row._creationTime ?? Date.now();
  const anchor: CommentAnchorSnapshot = {
    commentMarkId: row.commentMarkId ?? nowId('cmark'),
    textQuote: row.textQuote ?? '',
    anchorPrefix: row.anchorPrefix ?? '',
    anchorSuffix: row.anchorSuffix ?? '',
    anchorHeadingPath: row.anchorHeadingPath ?? [],
    fallbackLine: row.fallbackLine ?? 1,
    rangeStart: row.rangeStart,
    rangeEnd: row.rangeEnd,
  };

  return {
    id: row._id,
    mdFileId: row.mdFileId,
    authorId: row.authorId,
    body: row.body,
    createdAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
    parentCommentId: row.parentCommentId,
    anchor,
  };
}

function mapActivity(row: WithMdActivityRow): ActivityItem {
  return {
    id: row._id,
    type: row.type,
    summary: row.summary,
    createdAt: row.createdAt ?? row._creationTime ?? Date.now(),
  };
}

async function rpc<T>(fn: string, args: Record<string, unknown>, type: 'query' | 'mutation'): Promise<T> {
  const res = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn, args, type }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `RPC failed: ${res.status}`);
  }

  const body = (await res.json()) as { ok: boolean; result: T };
  return body.result;
}

async function queryConvex<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return rpc<T>(name, args, 'query');
}

async function mutateConvex<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return rpc<T>(name, args, 'mutation');
}

const convexApi: WithMdApi = {
  async listRepos(userId?: string) {
    const args: Record<string, unknown> = {};
    if (userId) args.userId = userId;
    const rows = await queryConvex<WithMdRepoRow[]>(WITH_MD_CONVEX_FUNCTIONS.queries.reposList, args);
    return rows.map(mapRepo);
  },

  async listFilesByRepo(repoId, branch) {
    const args: Record<string, unknown> = {
      repoId: repoId as never,
      includeDeleted: false,
    };
    if (branch !== undefined) args.branch = branch;
    const rows = await queryConvex<WithMdFileRow[]>(WITH_MD_CONVEX_FUNCTIONS.queries.mdFilesListByRepo, args);
    return rows.map(mapFile);
  },

  async listQueuedPaths(repoId) {
    const files = await this.listQueuedFiles(repoId);
    return files.map((f) => f.path);
  },

  async listQueuedFiles(repoId) {
    const rows = await queryConvex<WithMdPushQueueRow[]>(WITH_MD_CONVEX_FUNCTIONS.queries.pushQueueListByRepo, {
      repoId: repoId as never,
    });
    // Deduplicate by path, keeping last entry (matches push route behavior)
    const map = new Map<string, boolean>();
    for (const row of rows) {
      map.set(row.path, Boolean(row.isDelete));
    }
    return Array.from(map.entries()).map(([path, isDelete]) => ({ path, isDelete }));
  },

  async resolveByPath(repoId, path, branch) {
    const args: Record<string, unknown> = {
      repoId: repoId as never,
      path,
    };
    if (branch !== undefined) args.branch = branch;
    const row = await queryConvex<WithMdFileRow | null>(WITH_MD_CONVEX_FUNCTIONS.queries.mdFilesResolveByPath, args);
    return row ? mapFile(row) : null;
  },

  async getFile(mdFileId) {
    const row = await queryConvex<WithMdFileRow | null>(WITH_MD_CONVEX_FUNCTIONS.queries.mdFilesGet, {
      mdFileId: mdFileId as never,
    });
    return row ? mapFile(row) : null;
  },

  async listCommentsByFile(mdFileId) {
    const rows = await queryConvex<WithMdCommentRow[]>(WITH_MD_CONVEX_FUNCTIONS.queries.commentsListByFile, {
      mdFileId: mdFileId as never,
      includeResolved: true,
    });
    return rows.map(mapComment);
  },

  async createComment(input) {
    const file = await this.getFile(input.mdFileId);
    if (!file) throw new Error('File not found');

    const bestQuoteIndex = input.textQuote
      ? pickBestQuoteIndex(file.content, input.textQuote, {
          fallbackLine: input.fallbackLine,
          anchorPrefix: input.anchorPrefix,
          anchorSuffix: input.anchorSuffix,
          anchorHeadingPath: input.anchorHeadingPath,
        })
      : undefined;

    const hasValidProvidedRangeStart = typeof input.rangeStart === 'number'
      && input.rangeStart >= 0
      && (!input.textQuote || file.content.slice(input.rangeStart, input.rangeStart + input.textQuote.length) === input.textQuote);
    const persistedRangeStart = typeof bestQuoteIndex === 'number'
      ? bestQuoteIndex
      : (hasValidProvidedRangeStart ? input.rangeStart : undefined);
    const persistedRangeEnd = typeof persistedRangeStart === 'number' && input.textQuote
      ? persistedRangeStart + input.textQuote.length
      : (typeof input.rangeEnd === 'number' ? input.rangeEnd : undefined);

    const anchorAt = typeof persistedRangeStart === 'number'
      ? persistedRangeStart
      : typeof bestQuoteIndex === 'number'
        ? bestQuoteIndex
        : indexFromLineNumber(file.content, input.fallbackLine);

    const row = await mutateConvex<WithMdCommentRow>(WITH_MD_CONVEX_FUNCTIONS.mutations.commentsCreate, {
      mdFileId: input.mdFileId as never,
      authorId: input.authorId,
      body: input.body,
      parentCommentId: input.parentCommentId as never,
      commentMarkId: input.commentMarkId ?? nowId('cmark'),
      textQuote: input.textQuote,
      anchorPrefix: input.anchorPrefix ?? file.content.slice(Math.max(0, anchorAt - 32), Math.max(0, anchorAt)),
      anchorSuffix:
        input.anchorSuffix ?? file.content.slice(anchorAt, Math.min(anchorAt + 32, file.content.length)),
      anchorHeadingPath: input.anchorHeadingPath ?? extractHeadingPathAtIndex(file.content, anchorAt),
      fallbackLine: input.fallbackLine,
      rangeStart: persistedRangeStart,
      rangeEnd: persistedRangeEnd,
    });

    return mapComment(row);
  },

  async deleteComment(commentId) {
    await mutateConvex(WITH_MD_CONVEX_FUNCTIONS.mutations.commentsDelete, {
      commentId: commentId as never,
    });
  },

  async saveSource({ mdFileId, sourceContent }) {
    return await mutateConvex<{ changed: boolean }>(WITH_MD_CONVEX_FUNCTIONS.mutations.mdFilesSaveSource, {
      mdFileId: mdFileId as never,
      sourceContent,
    });
  },

  async revertToGithub({ mdFileId, githubContent, githubSha }) {
    await mutateConvex(WITH_MD_CONVEX_FUNCTIONS.mutations.mdFilesRevertToGithub, {
      mdFileId: mdFileId as never,
      githubContent,
      githubSha,
    });
  },

  async importLocalBatch(repoId, files, branch) {
    const rows = files.map((file) => ({
      relativePath: file.relativePath,
      targetPath: file.targetPath,
      content: file.content,
      conflictMode: file.conflictMode,
    }));
    const args: Record<string, unknown> = {
      repoId: repoId as never,
      files: rows,
    };
    if (branch !== undefined) args.branch = branch;
    return await mutateConvex<LocalImportResult>(WITH_MD_CONVEX_FUNCTIONS.mutations.mdFilesImportLocalBatch, args);
  },

  async movePath(repoId, fromPath, toDirectoryPath, conflictMode, branch) {
    const args: Record<string, unknown> = {
      repoId: repoId as never,
      fromPath,
      toDirectoryPath,
      conflictMode,
    };
    if (branch !== undefined) args.branch = branch;
    return await mutateConvex<PathRewriteResult>(WITH_MD_CONVEX_FUNCTIONS.mutations.mdFilesMovePath, args);
  },

  async renamePath(repoId, fromPath, toPath, conflictMode, branch) {
    const args: Record<string, unknown> = {
      repoId: repoId as never,
      fromPath,
      toPath,
      conflictMode,
    };
    if (branch !== undefined) args.branch = branch;
    return await mutateConvex<PathRewriteResult>(WITH_MD_CONVEX_FUNCTIONS.mutations.mdFilesRenamePath, args);
  },

  async undoFileOperation(repoId, undoPayload) {
    return await mutateConvex<UndoFileOperationResult>(WITH_MD_CONVEX_FUNCTIONS.mutations.mdFilesUndoFileOperation, {
      repoId: repoId as never,
      undoPayload,
    });
  },

  async deleteFile(repoId, mdFileId) {
    return await mutateConvex<{ ok: boolean; deletedPath?: string; reason?: string }>(
      WITH_MD_CONVEX_FUNCTIONS.mutations.mdFilesDeleteFile,
      { repoId: repoId as never, mdFileId: mdFileId as never },
    );
  },

  async listActivity(repoId) {
    const rows = await queryConvex<WithMdActivityRow[]>(WITH_MD_CONVEX_FUNCTIONS.queries.activitiesListByRepo, {
      repoId: repoId as never,
    });
    return rows.map(mapActivity);
  },

  async pushNow(repoId) {
    const response = await mutateConvex<{ ok?: boolean }>(WITH_MD_CONVEX_FUNCTIONS.mutations.pushQueuePushNow, {
      repoId: repoId as never,
    });
    return { ok: Boolean(response?.ok) };
  },

  async resync(repoId) {
    const response = await mutateConvex<{ ok?: boolean }>(WITH_MD_CONVEX_FUNCTIONS.mutations.reposResync, {
      repoId: repoId as never,
    });
    return { ok: Boolean(response?.ok) };
  },
};

export function getWithMdApi(): WithMdApi {
  return convexApi;
}
