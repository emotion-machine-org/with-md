export type DocMode = 'read' | 'edit' | 'source';

/** User-facing mode toggle: document (rich) vs source (raw markdown) */
export type UserMode = 'document' | 'source';

export type SyntaxSupportStatus = 'unknown' | 'supported' | 'unsupported';

export interface CursorHint {
  sourceLine?: number;
  textFragment?: string;
  offsetInFragment?: number;
}

export type FileCategory =
  | 'readme'
  | 'prompt'
  | 'agent'
  | 'claude'
  | 'docs'
  | 'other';

export interface RepoSummary {
  repoId: string;
  owner: string;
  name: string;
  installationId?: string;
  githubRepoId?: number;
  defaultBranch?: string;
  githubInstallationId?: number;
}

export interface MdFile {
  mdFileId: string;
  repoId: string;
  path: string;
  content: string;
  contentHash: string;
  fileCategory: FileCategory;
  editHeartbeat?: number;
  pendingGithubContent?: string;
  isDeleted?: boolean;
  deletedAt?: number;
  syntaxSupportStatus?: SyntaxSupportStatus;
  syntaxSupportReasons?: string[];
  isOversized?: boolean;
  lastOversizeBytes?: number;
  oversizeUpdatedAt?: number;
}

export interface CommentAnchorSnapshot {
  commentMarkId: string;
  textQuote: string;
  anchorPrefix: string;
  anchorSuffix: string;
  anchorHeadingPath: string[];
  fallbackLine: number;
  rangeStart?: number;
  rangeEnd?: number;
}

export interface CommentRecord {
  id: string;
  mdFileId: string;
  authorId: string;
  body: string;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  parentCommentId?: string;
  anchor: CommentAnchorSnapshot;
}

export interface ActivityItem {
  id: string;
  type:
    | 'comment_created'
    | 'comment_resolved'
    | 'suggestion_created'
    | 'suggestion_accepted'
    | 'source_saved'
    | 'push_completed'
    | 'sync_completed';
  summary: string;
  createdAt: number;
}

export interface SyntaxSupportResult {
  supported: boolean;
  reasons: string[];
}

export interface AnchorMatch {
  start: number;
  end: number;
}

export interface CommentSelectionDraft {
  source: 'read' | 'edit';
  textQuote: string;
  anchorPrefix: string;
  anchorSuffix: string;
  anchorHeadingPath: string[];
  fallbackLine: number;
  rangeStart?: number;
  rangeEnd?: number;
  selectionFrom?: number;
  selectionTo?: number;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}
