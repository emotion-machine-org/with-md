export type DocMode = 'read' | 'edit' | 'source';

export type SyntaxSupportStatus = 'unknown' | 'supported' | 'unsupported';

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
}

export interface CommentAnchorSnapshot {
  commentMarkId: string;
  textQuote: string;
  anchorPrefix: string;
  anchorSuffix: string;
  anchorHeadingPath: string[];
  fallbackLine: number;
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
