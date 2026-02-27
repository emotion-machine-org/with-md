import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  installations: defineTable({
    githubInstallationId: v.number(),
    githubAccountLogin: v.string(),
    githubAccountType: v.string(),
    accessToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    connectedBy: v.optional(v.id('users')),
  })
    .index('by_github_installation_id', ['githubInstallationId'])
    .index('by_connected_user', ['connectedBy']),

  repos: defineTable({
    installationId: v.id('installations'),
    githubRepoId: v.number(),
    owner: v.string(),
    name: v.string(),
    defaultBranch: v.string(),
    activeBranch: v.optional(v.string()),
    lastSyncedCommitSha: v.optional(v.string()),
    syncStatus: v.string(),
  })
    .index('by_github_repo_id', ['githubRepoId'])
    .index('by_installation', ['installationId']),

  mdFiles: defineTable({
    repoId: v.id('repos'),
    path: v.string(),
    branch: v.optional(v.string()),
    content: v.string(),
    contentHash: v.string(),
    lastGithubSha: v.string(),
    fileCategory: v.string(),
    sizeBytes: v.number(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    lastSyncedAt: v.number(),
    yjsStateStorageId: v.optional(v.id('_storage')),
    editHeartbeat: v.optional(v.number()),
    pendingGithubContent: v.optional(v.string()),
    pendingGithubSha: v.optional(v.string()),
    syntaxSupportStatus: v.optional(v.string()),
    syntaxSupportReasons: v.optional(v.array(v.string())),
    isOversized: v.optional(v.boolean()),
    lastOversizeBytes: v.optional(v.number()),
    oversizeUpdatedAt: v.optional(v.number()),
  })
    .index('by_repo_and_path', ['repoId', 'path'])
    .index('by_repo_branch_path', ['repoId', 'branch', 'path'])
    .index('by_repo_and_branch', ['repoId', 'branch'])
    .index('by_repo_and_category', ['repoId', 'fileCategory'])
    .index('by_repo', ['repoId']),

  comments: defineTable({
    mdFileId: v.id('mdFiles'),
    authorId: v.string(),
    body: v.string(),
    commentMarkId: v.string(),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.string()),
    parentCommentId: v.optional(v.id('comments')),
    textQuote: v.optional(v.string()),
    anchorPrefix: v.optional(v.string()),
    anchorSuffix: v.optional(v.string()),
    anchorHeadingPath: v.optional(v.array(v.string())),
    fallbackLine: v.optional(v.number()),
    rangeStart: v.optional(v.number()),
    rangeEnd: v.optional(v.number()),
  })
    .index('by_md_file', ['mdFileId'])
    .index('by_parent', ['parentCommentId'])
    .index('by_comment_mark_id', ['commentMarkId']),

  suggestions: defineTable({
    mdFileId: v.id('mdFiles'),
    commentId: v.optional(v.id('comments')),
    authorId: v.id('users'),
    status: v.string(),
    originalText: v.string(),
    suggestedText: v.string(),
    baseContentHash: v.string(),
    resolvedBy: v.optional(v.id('users')),
    resolvedAt: v.optional(v.number()),
  })
    .index('by_md_file', ['mdFileId'])
    .index('by_md_file_and_status', ['mdFileId', 'status']),

  pushQueue: defineTable({
    repoId: v.id('repos'),
    mdFileId: v.id('mdFiles'),
    path: v.string(),
    branch: v.optional(v.string()),
    newContent: v.string(),
    authorLogins: v.array(v.string()),
    authorEmails: v.array(v.string()),
    isDelete: v.optional(v.boolean()),
    status: v.string(),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    pushedAt: v.optional(v.number()),
    commitSha: v.optional(v.string()),
  })
    .index('by_repo_and_status', ['repoId', 'status'])
    .index('by_md_file', ['mdFileId']),

  activities: defineTable({
    repoId: v.id('repos'),
    mdFileId: v.optional(v.id('mdFiles')),
    actorId: v.string(),
    type: v.string(),
    targetId: v.optional(v.string()),
    summary: v.string(),
    filePath: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_repo', ['repoId'])
    .index('by_repo_and_type', ['repoId', 'type'])
    .index('by_md_file', ['mdFileId']),

  activityReadCursors: defineTable({
    userId: v.id('users'),
    repoId: v.id('repos'),
    lastReadAt: v.number(),
  }).index('by_user_and_repo', ['userId', 'repoId']),

  users: defineTable({
    githubUserId: v.number(),
    githubLogin: v.string(),
    avatarUrl: v.optional(v.string()),
    email: v.optional(v.string()),
    bgIndex: v.optional(v.number()),
  }).index('by_github_user_id', ['githubUserId']),

  anonShares: defineTable({
    shortId: v.string(),
    title: v.string(),
    content: v.string(),
    contentHash: v.string(),
    sizeBytes: v.number(),
    syntaxSupportStatus: v.optional(v.string()),
    syntaxSupportReasons: v.optional(v.array(v.string())),
    yjsStateStorageId: v.optional(v.id('_storage')),
    editSecretHash: v.optional(v.string()),
    editSecret: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.optional(v.number()),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    createdByIpHash: v.optional(v.string()),
  }).index('by_short_id', ['shortId'])
    .index('by_expires_at', ['expiresAt']),

  anonRateLimits: defineTable({
    bucket: v.string(),
    count: v.number(),
    updatedAt: v.number(),
  }).index('by_bucket', ['bucket']),

  repoShares: defineTable({
    shortIdHash: v.string(),
    editSecretHash: v.string(),
    mdFileId: v.id('mdFiles'),
    createdByUserId: v.id('users'),
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index('by_short_id_hash', ['shortIdHash'])
    .index('by_md_file', ['mdFileId'])
    .index('by_expires_at', ['expiresAt']),

  webSnapshots: defineTable({
    urlHash: v.string(),
    normalizedUrl: v.string(),
    displayUrl: v.string(),
    title: v.string(),
    markdown: v.string(),
    markdownHash: v.string(),
    sourceEngine: v.string(),
    fetchedAt: v.number(),
    staleAt: v.number(),
    version: v.number(),
    tokenEstimate: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index('by_url_hash', ['urlHash'])
    .index('by_stale_at', ['staleAt']),

  webSnapshotVersions: defineTable({
    snapshotId: v.id('webSnapshots'),
    urlHash: v.string(),
    version: v.number(),
    normalizedUrl: v.string(),
    markdown: v.string(),
    markdownHash: v.string(),
    sourceEngine: v.string(),
    trigger: v.string(),
    createdAt: v.number(),
  })
    .index('by_snapshot', ['snapshotId'])
    .index('by_url_hash', ['urlHash']),
});
