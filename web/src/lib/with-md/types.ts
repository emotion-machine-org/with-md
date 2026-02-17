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
  activeBranch?: string;
  githubInstallationId?: number;
}

export interface MdFile {
  mdFileId: string;
  repoId: string;
  path: string;
  branch?: string;
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

export type ImportConflictMode = 'keep_both' | 'replace';

export interface LocalImportFileInput {
  relativePath: string;
  targetPath?: string;
  content: string;
  conflictMode?: ImportConflictMode;
}

export interface LocalImportResult {
  ok: boolean;
  imported: number;
  updated: number;
  unchanged: number;
  skipped: number;
  invalid: number;
  autoRenamed: number;
  undoUnsupportedCount: number;
  createdOrUpdatedPaths: string[];
  invalidRows: string[];
  firstPath: string | null;
  undoPayload: string | null;
  undoExpiresAt: number | null;
}

export interface PathRewriteEntry {
  mdFileId: string;
  fromPath: string;
  toPath: string;
}

export interface PathRewriteResult {
  ok: boolean;
  reason?: string;
  movedCount?: number;
  renamedCount?: number;
  fromPath?: string;
  toPath?: string;
  moved?: PathRewriteEntry[];
  undoPayload?: string | null;
  undoExpiresAt?: number | null;
}

export interface UndoFileOperationResult {
  ok: boolean;
  reason?: string;
  restored?: number;
  skipped?: number;
}
