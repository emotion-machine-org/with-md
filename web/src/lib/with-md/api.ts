import { extractHeadingPathAtIndex } from '@/lib/with-md/anchor';
import { WITH_MD_CONVEX_FUNCTIONS } from '@/lib/with-md/convex-functions';
import { hasMeaningfulDiff } from '@/lib/with-md/markdown-diff';
import { detectUnsupportedSyntax } from '@/lib/with-md/syntax';
import type {
  ActivityItem,
  CommentAnchorSnapshot,
  CommentRecord,
  MdFile,
  RepoSummary,
} from '@/lib/with-md/types';

interface CreateCommentInput {
  mdFileId: string;
  authorId: string;
  body: string;
  textQuote: string;
  fallbackLine: number;
  anchorPrefix?: string;
  anchorSuffix?: string;
  anchorHeadingPath?: string[];
}

interface SaveSourceInput {
  mdFileId: string;
  sourceContent: string;
}

export interface WithMdApi {
  listRepos(): Promise<RepoSummary[]>;
  listFilesByRepo(repoId: string): Promise<MdFile[]>;
  resolveByPath(repoId: string, path: string): Promise<MdFile | null>;
  getFile(mdFileId: string): Promise<MdFile | null>;
  listCommentsByFile(mdFileId: string): Promise<CommentRecord[]>;
  createComment(input: CreateCommentInput): Promise<CommentRecord>;
  saveSource(input: SaveSourceInput): Promise<{ changed: boolean }>;
  listActivity(repoId: string): Promise<ActivityItem[]>;
  pushNow(repoId: string): Promise<{ ok: boolean }>;
  resync(repoId: string): Promise<{ ok: boolean }>;
}

// Convex-first contract (replace mock implementation with real adapter)
// Query names:
// - WITH_MD_CONVEX_FUNCTIONS.queries.*
// Mutation names:
// - WITH_MD_CONVEX_FUNCTIONS.mutations.*
void WITH_MD_CONVEX_FUNCTIONS;

const SAMPLE = `# with.md Architecture Notes

with.md enables markdown collaboration for people and agents.

## Workflow

1. Open file in read mode.
2. Enter rich edit mode when syntax is supported.
3. Fall back to source mode when unsupported.

## Comments

Comments are anchored with quote + context + heading path + fallback line.
`;

const repos: RepoSummary[] = [
  {
    repoId: 'repo_withmd',
    owner: 'emotion-machine',
    name: 'with-md',
  },
];

const files = new Map<string, MdFile>([
  [
    'file_docs_plan',
    buildFile({
      mdFileId: 'file_docs_plan',
      repoId: 'repo_withmd',
      path: 'docs/with-md-architecture.md',
      content: SAMPLE,
      fileCategory: 'docs',
    }),
  ],
  [
    'file_agents',
    buildFile({
      mdFileId: 'file_agents',
      repoId: 'repo_withmd',
      path: 'AGENTS.md',
      content: '# AGENTS\n\nAgent instructions here.',
      fileCategory: 'agent',
    }),
  ],
]);

const commentsByFile = new Map<string, CommentRecord[]>();
const activityByRepo = new Map<string, ActivityItem[]>();

function buildFile(input: {
  mdFileId: string;
  repoId: string;
  path: string;
  content: string;
  fileCategory: MdFile['fileCategory'];
}): MdFile {
  const syntax = detectUnsupportedSyntax(input.content);
  return {
    mdFileId: input.mdFileId,
    repoId: input.repoId,
    path: input.path,
    content: input.content,
    contentHash: hashString(input.content),
    fileCategory: input.fileCategory,
    isDeleted: false,
    syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
    syntaxSupportReasons: syntax.reasons,
  };
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return `h_${(hash >>> 0).toString(16)}`;
}

function nowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function recordActivity(repoId: string, type: ActivityItem['type'], summary: string): void {
  const list = activityByRepo.get(repoId) ?? [];
  list.unshift({
    id: nowId('act'),
    type,
    summary,
    createdAt: Date.now(),
  });
  activityByRepo.set(repoId, list.slice(0, 100));
}

const mockApi: WithMdApi = {
  async listRepos() {
    return repos;
  },

  async listFilesByRepo(repoId) {
    return [...files.values()]
      .filter((f) => f.repoId === repoId && !f.isDeleted)
      .sort((a, b) => a.path.localeCompare(b.path));
  },

  async resolveByPath(repoId, path) {
    for (const file of files.values()) {
      if (file.repoId === repoId && file.path === path && !file.isDeleted) return file;
    }
    return null;
  },

  async getFile(mdFileId) {
    return files.get(mdFileId) ?? null;
  },

  async listCommentsByFile(mdFileId) {
    return commentsByFile.get(mdFileId) ?? [];
  },

  async createComment(input) {
    const file = files.get(input.mdFileId);
    if (!file) throw new Error('File not found');

    const firstQuoteIndex = input.textQuote ? file.content.indexOf(input.textQuote) : -1;
    const anchorAt = firstQuoteIndex >= 0 ? firstQuoteIndex : 0;

    const anchor: CommentAnchorSnapshot = {
      commentMarkId: nowId('cmark'),
      textQuote: input.textQuote,
      anchorPrefix:
        input.anchorPrefix ?? file.content.slice(Math.max(0, anchorAt - 32), Math.max(0, anchorAt)),
      anchorSuffix:
        input.anchorSuffix ?? file.content.slice(anchorAt, Math.min(anchorAt + 32, file.content.length)),
      anchorHeadingPath: input.anchorHeadingPath ?? extractHeadingPathAtIndex(file.content, anchorAt),
      fallbackLine: input.fallbackLine,
    };

    const comment: CommentRecord = {
      id: nowId('comment'),
      mdFileId: input.mdFileId,
      authorId: input.authorId,
      body: input.body,
      createdAt: Date.now(),
      anchor,
    };

    const list = commentsByFile.get(input.mdFileId) ?? [];
    commentsByFile.set(input.mdFileId, [...list, comment]);
    recordActivity(file.repoId, 'comment_created', `Comment added on ${file.path}`);

    return comment;
  },

  async saveSource({ mdFileId, sourceContent }) {
    const file = files.get(mdFileId);
    if (!file || file.isDeleted) throw new Error('Cannot save deleted or missing file');

    if (!hasMeaningfulDiff(sourceContent, file.content)) {
      return { changed: false };
    }

    const syntax = detectUnsupportedSyntax(sourceContent);

    files.set(mdFileId, {
      ...file,
      content: sourceContent,
      contentHash: hashString(sourceContent),
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
    });

    recordActivity(file.repoId, 'source_saved', `Source saved for ${file.path}`);
    return { changed: true };
  },

  async listActivity(repoId) {
    return activityByRepo.get(repoId) ?? [];
  },

  async pushNow(repoId) {
    recordActivity(repoId, 'push_completed', 'Manual push triggered');
    return { ok: true };
  },

  async resync(repoId) {
    recordActivity(repoId, 'sync_completed', 'Manual re-sync completed');
    return { ok: true };
  },
};

export function getWithMdApi(): WithMdApi {
  return mockApi;
}
