import { ConvexHttpClient } from 'convex/browser';

import { extractHeadingPathAtIndex, pickBestQuoteIndex } from '@/lib/with-md/anchor';
import { WITH_MD_CONVEX_FUNCTIONS } from '@/lib/with-md/convex-functions';
import { detectUnsupportedSyntax } from '@/lib/with-md/syntax';
import type {
  ActivityItem,
  CommentAnchorSnapshot,
  CommentRecord,
  FileCategory,
  MdFile,
  RepoSummary,
  SyntaxSupportStatus,
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
  githubInstallationId?: number | null;
}

interface WithMdFileRow {
  _id: string;
  repoId: string;
  path: string;
  content: string;
  contentHash: string;
  fileCategory: string;
  editHeartbeat?: number;
  pendingGithubContent?: string;
  isDeleted?: boolean;
  deletedAt?: number;
  syntaxSupportStatus?: string;
  syntaxSupportReasons?: string[];
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

export interface WithMdApi {
  listRepos(): Promise<RepoSummary[]>;
  listFilesByRepo(repoId: string): Promise<MdFile[]>;
  resolveByPath(repoId: string, path: string): Promise<MdFile | null>;
  getFile(mdFileId: string): Promise<MdFile | null>;
  listCommentsByFile(mdFileId: string): Promise<CommentRecord[]>;
  createComment(input: CreateCommentInput): Promise<CommentRecord>;
  deleteComment(commentId: string): Promise<void>;
  saveSource(input: SaveSourceInput): Promise<{ changed: boolean }>;
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
    content: row.content,
    contentHash: row.contentHash,
    fileCategory: normalizeCategory(row.fileCategory),
    editHeartbeat: row.editHeartbeat,
    pendingGithubContent: row.pendingGithubContent,
    isDeleted: row.isDeleted,
    deletedAt: row.deletedAt,
    syntaxSupportStatus: syntax.status,
    syntaxSupportReasons: syntax.reasons,
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

let convexClient: ConvexHttpClient | null = null;
function getConvexClient(): ConvexHttpClient {
  if (convexClient) return convexClient;

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_CONVEX_URL. Set it in web/.env.local.');
  }

  convexClient = new ConvexHttpClient(url);
  return convexClient;
}

async function queryConvex<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const client = getConvexClient();
  return (await client.query(name as never, args as never)) as T;
}

async function mutateConvex<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const client = getConvexClient();
  return (await client.mutation(name as never, args as never)) as T;
}

const convexApi: WithMdApi = {
  async listRepos() {
    const rows = await queryConvex<WithMdRepoRow[]>(WITH_MD_CONVEX_FUNCTIONS.queries.reposList, {});
    return rows.map(mapRepo);
  },

  async listFilesByRepo(repoId) {
    const rows = await queryConvex<WithMdFileRow[]>(WITH_MD_CONVEX_FUNCTIONS.queries.mdFilesListByRepo, {
      repoId: repoId as never,
      includeDeleted: false,
    });
    return rows.map(mapFile);
  },

  async resolveByPath(repoId, path) {
    const row = await queryConvex<WithMdFileRow | null>(WITH_MD_CONVEX_FUNCTIONS.queries.mdFilesResolveByPath, {
      repoId: repoId as never,
      path,
    });
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
          preferredStart: input.rangeStart,
          anchorPrefix: input.anchorPrefix,
          anchorSuffix: input.anchorSuffix,
          anchorHeadingPath: input.anchorHeadingPath,
        })
      : undefined;

    const persistedRangeStart = typeof input.rangeStart === 'number'
      ? input.rangeStart
      : bestQuoteIndex;
    const persistedRangeEnd = typeof input.rangeEnd === 'number'
      ? input.rangeEnd
      : (typeof persistedRangeStart === 'number' && input.textQuote
        ? persistedRangeStart + input.textQuote.length
        : undefined);

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
