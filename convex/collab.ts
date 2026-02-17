import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation, internalQuery, mutation } from './_generated/server';
import { v } from 'convex/values';

import { INLINE_REALTIME_MAX_BYTES, markdownByteLength } from './lib/collabPolicy';
import { hashContent, hasMeaningfulDiff } from './lib/markdownDiff';
import { detectUnsupportedSyntax } from './lib/syntax';

const OVERSIZE_ACTIVITY_INTERVAL_MS = 5 * 60 * 1000;
const OVERSIZE_ACTIVITY_BYTES_DELTA = 64 * 1024;
const REALTIME_SHRINK_GUARD_MIN_BYTES = 1024;
const REALTIME_SHRINK_GUARD_RATIO = 0.85;
const REALTIME_SHRINK_GUARD_MIN_DELTA_BYTES = 256;
const REPEAT_DEDUPE_MIN_BYTES = 1024;
const HEADING_REPEAT_DEDUPE_MIN_BYTES = 2048;
const HEADING_REPEAT_MIN_SECTION_BYTES = 800;
const HEADING_REPEAT_MIN_DUPLICATED_BYTES = 512;
const REPO_SHARE_REALTIME_PREFIX = 'rse1:';
const REPO_SHARE_SHORT_ID_HASH_SCOPE = 'withmd:repo-share:short-id';
const REPO_SHARE_EDIT_SECRET_HASH_SCOPE = 'withmd:repo-share:edit-secret';

interface OversizeFileSnapshot {
  _id: Id<'mdFiles'>;
  repoId: Id<'repos'>;
  path: string;
  isOversized?: boolean;
  lastOversizeBytes?: number;
  oversizeUpdatedAt?: number;
}

interface SanitizedRealtimeMarkdown {
  content: string;
  repeats: number;
  strippedLeadingPlaceholders: boolean;
}

interface PersistNormalizationSignal {
  normalized?: boolean;
  normalizedRepeats?: number;
  normalizedStrippedLeadingPlaceholders?: boolean;
}

function parseRepoShareRealtimeToken(token: string): { shortId: string; editSecret: string } | null {
  if (!token.startsWith(REPO_SHARE_REALTIME_PREFIX)) return null;
  const raw = token.slice(REPO_SHARE_REALTIME_PREFIX.length);
  const splitAt = raw.indexOf(':');
  if (splitAt <= 0) return null;
  const shortId = raw.slice(0, splitAt).trim();
  const editSecret = raw.slice(splitAt + 1).trim();
  if (!shortId || !editSecret) return null;
  return { shortId, editSecret };
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyRepoShareEditToken(
  ctx: { db: { query: (table: 'repoShares') => any } },
  token: string,
  expectedMdFileId: string,
): Promise<boolean> {
  const parsed = parseRepoShareRealtimeToken(token);
  if (!parsed) return false;

  const shortIdHash = await sha256Hex(`${REPO_SHARE_SHORT_ID_HASH_SCOPE}:${parsed.shortId}`);
  const editSecretHash = await sha256Hex(`${REPO_SHARE_EDIT_SECRET_HASH_SCOPE}:${parsed.editSecret}`);
  const share = await ctx.db
    .query('repoShares')
    .withIndex('by_short_id_hash', (q: any) => q.eq('shortIdHash', shortIdHash))
    .first();

  if (!share) return false;
  if (share.mdFileId !== expectedMdFileId) return false;
  if (share.expiresAt <= Date.now()) return false;
  if (typeof share.revokedAt === 'number') return false;
  return share.editSecretHash === editSecretHash;
}

function stripLeadingPlaceholderParagraphs(content: string): { content: string; stripped: boolean } {
  if (!content) return { content, stripped: false };

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  while (start < lines.length) {
    const normalized = lines[start].replace(/\u00A0/g, ' ').trim();
    if (normalized === '' || normalized === '&nbsp;') {
      start += 1;
      continue;
    }
    break;
  }

  if (start === 0) {
    return { content: lines.join('\n'), stripped: false };
  }
  return { content: lines.slice(start).join('\n'), stripped: true };
}

function clearOversizedFields() {
  return {
    isOversized: false,
    lastOversizeBytes: undefined,
    oversizeUpdatedAt: undefined,
  };
}

function buildDocumentVersion(contentHash: string, yjsStateStorageId: Id<'_storage'> | undefined): string {
  return `${contentHash}:${yjsStateStorageId ?? 'none'}`;
}

function collapseExactRepetition(content: string): SanitizedRealtimeMarkdown | null {
  const totalLength = content.length;
  if (totalLength < REPEAT_DEDUPE_MIN_BYTES) return null;

  const lps = new Array<number>(totalLength).fill(0);
  let prefixLength = 0;
  for (let i = 1; i < totalLength; i += 1) {
    while (prefixLength > 0 && content[i] !== content[prefixLength]) {
      prefixLength = lps[prefixLength - 1] ?? 0;
    }
    if (content[i] === content[prefixLength]) {
      prefixLength += 1;
      lps[i] = prefixLength;
    }
  }

  const period = totalLength - (lps[totalLength - 1] ?? 0);
  if (period <= 0 || period >= totalLength) return null;
  if (totalLength % period !== 0) return null;

  const repeats = totalLength / period;
  if (repeats < 2) return null;

  const deduped = content.slice(0, period);
  if (!deduped.trim()) return null;
  return { content: deduped, repeats, strippedLeadingPlaceholders: false };
}

function collapseTopHeadingRepetition(content: string): SanitizedRealtimeMarkdown | null {
  if (content.length < HEADING_REPEAT_DEDUPE_MIN_BYTES) return null;

  const firstLineEnd = content.indexOf('\n');
  if (firstLineEnd <= 0) return null;
  const firstLine = content.slice(0, firstLineEnd).trim();
  if (!firstLine.startsWith('# ')) return null;

  const marker = `\n${firstLine}\n`;
  const firstRepeat = content.indexOf(marker, firstLineEnd + 1);
  if (firstRepeat < 0) return null;

  let repeats = 1;
  let cursor = firstRepeat;
  while (cursor >= 0) {
    repeats += 1;
    cursor = content.indexOf(marker, cursor + marker.length);
  }
  if (repeats < 2) return null;

  const deduped = `${content.slice(0, firstRepeat).trimEnd()}\n`;
  if (!deduped.trim()) return null;
  if (deduped.length < HEADING_REPEAT_MIN_SECTION_BYTES) return null;
  if (content.length - deduped.length < HEADING_REPEAT_MIN_DUPLICATED_BYTES) return null;
  return { content: deduped, repeats, strippedLeadingPlaceholders: false };
}

function sanitizeRealtimeMarkdown(content: string): SanitizedRealtimeMarkdown {
  const stripped = stripLeadingPlaceholderParagraphs(content);
  const normalized = stripped.content;

  const exact = collapseExactRepetition(normalized);
  if (exact) {
    return {
      ...exact,
      strippedLeadingPlaceholders: stripped.stripped,
    };
  }

  const byHeading = collapseTopHeadingRepetition(normalized);
  if (byHeading) {
    return {
      ...byHeading,
      strippedLeadingPlaceholders: stripped.stripped,
    };
  }

  return {
    content: normalized,
    repeats: 1,
    strippedLeadingPlaceholders: stripped.stripped,
  };
}

function hasNormalizationSignal(
  signal: PersistNormalizationSignal,
  sanitizedIncoming: SanitizedRealtimeMarkdown,
): boolean {
  if (sanitizedIncoming.repeats > 1 || sanitizedIncoming.strippedLeadingPlaceholders) {
    return true;
  }
  if (signal.normalized) {
    return true;
  }
  if ((signal.normalizedRepeats ?? 1) > 1) {
    return true;
  }
  return Boolean(signal.normalizedStrippedLeadingPlaceholders);
}

function matchesCollapsedExistingContent(existingContent: string, incomingContent: string): boolean {
  const collapsedExisting = sanitizeRealtimeMarkdown(existingContent);
  if (collapsedExisting.repeats <= 1 && !collapsedExisting.strippedLeadingPlaceholders) {
    return false;
  }
  return !hasMeaningfulDiff(collapsedExisting.content, incomingContent);
}

function shouldRejectSuspiciousRealtimeShrink(existingBytes: number, incomingBytes: number): boolean {
  if (existingBytes < REALTIME_SHRINK_GUARD_MIN_BYTES) return false;
  if (incomingBytes >= existingBytes) return false;

  const delta = existingBytes - incomingBytes;
  if (delta < REALTIME_SHRINK_GUARD_MIN_DELTA_BYTES) return false;
  return incomingBytes < existingBytes * REALTIME_SHRINK_GUARD_RATIO;
}

async function markFileOversized(
  ctx: MutationCtx,
  file: OversizeFileSnapshot,
  markdownBytes: number,
  source: string,
) {
  const now = Date.now();
  const previousBytes = file.lastOversizeBytes ?? 0;
  const previousUpdatedAt = file.oversizeUpdatedAt ?? 0;
  const shouldLogActivity =
    !file.isOversized ||
    Math.abs(previousBytes - markdownBytes) >= OVERSIZE_ACTIVITY_BYTES_DELTA ||
    now - previousUpdatedAt > OVERSIZE_ACTIVITY_INTERVAL_MS;

  await ctx.db.patch(file._id, {
    isOversized: true,
    lastOversizeBytes: markdownBytes,
    oversizeUpdatedAt: now,
    editHeartbeat: now,
  });

  if (shouldLogActivity) {
    await ctx.db.insert('activities', {
      repoId: file.repoId,
      mdFileId: file._id,
      actorId: 'system',
      type: 'source_saved',
      summary: `Realtime inline persistence skipped for ${file.path} (${markdownBytes} bytes via ${source})`,
      filePath: file.path,
      createdAt: now,
    });
  }
}

export const authenticate = internalQuery({
  args: {
    userToken: v.string(),
    mdFileId: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId as Id<'mdFiles'>);
    if (!file || file.isDeleted) {
      return { ok: false, reason: 'missing' as const };
    }

    if (args.userToken.startsWith(REPO_SHARE_REALTIME_PREFIX)) {
      const allowed = await verifyRepoShareEditToken(ctx as any, args.userToken, args.mdFileId);
      if (!allowed) {
        return { ok: false, reason: 'forbidden' as const };
      }
      return { ok: true };
    }

    // TODO: validate Clerk/GitHub identity and repo access.
    return { ok: true };
  },
});

export const loadDocument = internalQuery({
  args: {
    mdFileId: v.id('mdFiles'),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) {
      return {
        yjsStateUrl: null,
        yjsStateStorageId: null,
        markdownContent: '',
        syntaxSupportStatus: 'unknown',
        documentVersion: 'missing',
      };
    }

    const yjsStateUrl = file.yjsStateStorageId
      ? await ctx.storage.getUrl(file.yjsStateStorageId)
      : null;

    return {
      yjsStateUrl,
      yjsStateStorageId: file.yjsStateStorageId ?? null,
      markdownContent: file.content,
      syntaxSupportStatus: file.syntaxSupportStatus ?? 'unknown',
      documentVersion: `${file.contentHash}:${file.yjsStateStorageId ?? 'none'}`,
    };
  },
});

export const storeDocument = internalMutation({
  args: {
    mdFileId: v.id('mdFiles'),
    markdownContent: v.string(),
    yjsStateStorageId: v.optional(v.id('_storage')),
    normalized: v.optional(v.boolean()),
    normalizedRepeats: v.optional(v.number()),
    normalizedStrippedLeadingPlaceholders: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) {
      return {
        persistPath: 'missing',
        markdownBytes: markdownByteLength(args.markdownContent),
        documentVersion: 'missing',
      };
    }

    const sanitized = sanitizeRealtimeMarkdown(args.markdownContent);
    const markdownContent = sanitized.content;
    const markdownBytes = markdownByteLength(markdownContent);
    const existingBytes = markdownByteLength(file.content);
    const incomingYjsStateStorageId = args.yjsStateStorageId;
    const nextYjsStateStorageId = incomingYjsStateStorageId ?? file.yjsStateStorageId;
    const replacedYjsStateStorageId =
      incomingYjsStateStorageId && incomingYjsStateStorageId !== file.yjsStateStorageId
        ? file.yjsStateStorageId
        : undefined;
    if (markdownBytes > INLINE_REALTIME_MAX_BYTES) {
      await markFileOversized(ctx, file, markdownBytes, 'storeDocument');
      return {
        persistPath: 'oversized',
        markdownBytes,
        replacedYjsStateStorageId: undefined,
        documentVersion: buildDocumentVersion(file.contentHash, file.yjsStateStorageId),
      };
    }

    const normalizationSignal: PersistNormalizationSignal = {
      normalized: args.normalized,
      normalizedRepeats: args.normalizedRepeats,
      normalizedStrippedLeadingPlaceholders: args.normalizedStrippedLeadingPlaceholders,
    };
    const allowsRepairingShrink =
      markdownBytes < existingBytes &&
      (
        hasNormalizationSignal(normalizationSignal, sanitized) ||
        matchesCollapsedExistingContent(file.content, markdownContent)
      );
    if (!allowsRepairingShrink && shouldRejectSuspiciousRealtimeShrink(existingBytes, markdownBytes)) {
      const now = Date.now();
      await ctx.db.patch(file._id, { editHeartbeat: now });
      await ctx.db.insert('activities', {
        repoId: file.repoId,
        mdFileId: file._id,
        actorId: 'system',
        type: 'source_saved',
        summary: `Skipped suspicious realtime shrink for ${file.path} (${existingBytes} -> ${markdownBytes} bytes); use Source mode save for intentional large deletions.`,
        filePath: file.path,
        createdAt: now,
      });
      return {
        persistPath: 'guard_rejected',
        markdownBytes,
        existingBytes,
        replacedYjsStateStorageId: undefined,
        documentVersion: buildDocumentVersion(file.contentHash, file.yjsStateStorageId),
      };
    }

    const now = Date.now();
    const hasDiff = hasMeaningfulDiff(markdownContent, file.content);
    if (hasDiff) {
      const syntax = detectUnsupportedSyntax(markdownContent);
      await ctx.db.patch(file._id, {
        content: markdownContent,
        contentHash: hashContent(markdownContent),
        editHeartbeat: now,
        syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
        syntaxSupportReasons: syntax.reasons,
        pendingGithubContent: markdownContent,
        pendingGithubSha: hashContent(markdownContent),
        yjsStateStorageId: nextYjsStateStorageId,
        ...clearOversizedFields(),
      });

      const queued = await ctx.db
        .query('pushQueue')
        .withIndex('by_md_file', (q) => q.eq('mdFileId', file._id))
        .collect();
      const pending = queued.filter((item) => item.status === 'queued');

      if (pending.length > 0) {
        for (const item of pending) {
          await ctx.db.patch(item._id, {
            newContent: markdownContent,
            createdAt: now,
          });
        }
      } else {
        await ctx.db.insert('pushQueue', {
          repoId: file.repoId,
          mdFileId: file._id,
          path: file.path,
          branch: file.branch,
          newContent: markdownContent,
          authorLogins: [],
          authorEmails: [],
          status: 'queued',
          createdAt: now,
        });
      }

      if (sanitized.repeats > 1) {
        await ctx.db.insert('activities', {
          repoId: file.repoId,
          mdFileId: file._id,
          actorId: 'system',
          type: 'source_saved',
          summary: `Auto-deduped repeated collaborative payload for ${file.path} (${sanitized.repeats}x -> 1x)`,
          filePath: file.path,
          createdAt: now,
        });
      }
    } else {
      await ctx.db.patch(file._id, {
        editHeartbeat: now,
        yjsStateStorageId: nextYjsStateStorageId,
        ...clearOversizedFields(),
      });
    }

    const nextContentHash = hasDiff ? hashContent(markdownContent) : file.contentHash;
    return {
      persistPath: hasDiff ? 'normal' : 'unchanged',
      markdownBytes,
      replacedYjsStateStorageId,
      documentVersion: buildDocumentVersion(nextContentHash, nextYjsStateStorageId),
    };
  },
});

export const storeDocumentOversized = internalMutation({
  args: {
    mdFileId: v.id('mdFiles'),
    markdownBytes: v.number(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) return { persistPath: 'missing' as const };

    await markFileOversized(ctx, file, args.markdownBytes, args.source ?? 'storeDocumentOversized');
    return { persistPath: 'oversized' as const, markdownBytes: args.markdownBytes };
  },
});

export const onAllDisconnected = internalMutation({
  args: {
    mdFileId: v.id('mdFiles'),
    markdownContent: v.string(),
    yjsStateStorageId: v.optional(v.id('_storage')),
    normalized: v.optional(v.boolean()),
    normalizedRepeats: v.optional(v.number()),
    normalizedStrippedLeadingPlaceholders: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) {
      return {
        persistPath: 'missing',
        markdownBytes: markdownByteLength(args.markdownContent),
        documentVersion: 'missing',
      };
    }

    const sanitized = sanitizeRealtimeMarkdown(args.markdownContent);
    const markdownContent = sanitized.content;
    const markdownBytes = markdownByteLength(markdownContent);
    const existingBytes = markdownByteLength(file.content);
    const incomingYjsStateStorageId = args.yjsStateStorageId;
    const nextYjsStateStorageId = incomingYjsStateStorageId ?? file.yjsStateStorageId;
    const replacedYjsStateStorageId =
      incomingYjsStateStorageId && incomingYjsStateStorageId !== file.yjsStateStorageId
        ? file.yjsStateStorageId
        : undefined;
    if (markdownBytes > INLINE_REALTIME_MAX_BYTES) {
      await markFileOversized(ctx, file, markdownBytes, 'onAllDisconnected');
      return {
        persistPath: 'oversized',
        markdownBytes,
        replacedYjsStateStorageId: undefined,
        documentVersion: buildDocumentVersion(file.contentHash, file.yjsStateStorageId),
      };
    }

    const normalizationSignal: PersistNormalizationSignal = {
      normalized: args.normalized,
      normalizedRepeats: args.normalizedRepeats,
      normalizedStrippedLeadingPlaceholders: args.normalizedStrippedLeadingPlaceholders,
    };
    const allowsRepairingShrink =
      markdownBytes < existingBytes &&
      (
        hasNormalizationSignal(normalizationSignal, sanitized) ||
        matchesCollapsedExistingContent(file.content, markdownContent)
      );
    if (!allowsRepairingShrink && shouldRejectSuspiciousRealtimeShrink(existingBytes, markdownBytes)) {
      const now = Date.now();
      await ctx.db.patch(file._id, { editHeartbeat: now });
      await ctx.db.insert('activities', {
        repoId: file.repoId,
        mdFileId: file._id,
        actorId: 'system',
        type: 'source_saved',
        summary: `Skipped suspicious realtime shrink for ${file.path} (${existingBytes} -> ${markdownBytes} bytes) on disconnect.`,
        filePath: file.path,
        createdAt: now,
      });
      return {
        persistPath: 'guard_rejected',
        markdownBytes,
        existingBytes,
        replacedYjsStateStorageId: undefined,
        documentVersion: buildDocumentVersion(file.contentHash, file.yjsStateStorageId),
      };
    }

    if (!hasMeaningfulDiff(markdownContent, file.content)) {
      await ctx.db.patch(file._id, {
        editHeartbeat: Date.now(),
        yjsStateStorageId: nextYjsStateStorageId,
        ...clearOversizedFields(),
      });
      return {
        persistPath: 'unchanged',
        markdownBytes,
        replacedYjsStateStorageId,
        documentVersion: buildDocumentVersion(file.contentHash, nextYjsStateStorageId),
      };
    }

    const now = Date.now();
    const syntax = detectUnsupportedSyntax(markdownContent);

    await ctx.db.patch(file._id, {
      content: markdownContent,
      contentHash: hashContent(markdownContent),
      editHeartbeat: now,
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
      pendingGithubContent: markdownContent,
      pendingGithubSha: hashContent(markdownContent),
      yjsStateStorageId: nextYjsStateStorageId,
      ...clearOversizedFields(),
    });

    const queued = await ctx.db
      .query('pushQueue')
      .withIndex('by_md_file', (q) => q.eq('mdFileId', file._id))
      .collect();
    const pending = queued.filter((item) => item.status === 'queued');

    if (pending.length > 0) {
      for (const item of pending) {
        await ctx.db.patch(item._id, {
          newContent: markdownContent,
          createdAt: now,
        });
      }
    } else {
      await ctx.db.insert('pushQueue', {
        repoId: file.repoId,
        mdFileId: file._id,
        path: file.path,
        branch: file.branch,
        newContent: markdownContent,
        authorLogins: [],
        authorEmails: [],
        status: 'queued',
        createdAt: now,
      });
    }

    await ctx.db.insert('activities', {
      repoId: file.repoId,
      mdFileId: file._id,
      actorId: 'local-user',
      type: 'source_saved',
      summary: sanitized.repeats > 1
        ? `Collaborative edits persisted for ${file.path} (auto-deduped ${sanitized.repeats}x payload)`
        : `Collaborative edits persisted for ${file.path}`,
      filePath: file.path,
      createdAt: now,
    });

    return {
      persistPath: 'normal',
      markdownBytes,
      replacedYjsStateStorageId,
      documentVersion: buildDocumentVersion(hashContent(markdownContent), nextYjsStateStorageId),
    };
  },
});

export const tombstoneFile = mutation({
  args: {
    mdFileId: v.id('mdFiles'),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file) return;

    await ctx.db.patch(file._id, {
      isDeleted: true,
      deletedAt: Date.now(),
      yjsStateStorageId: undefined,
      ...clearOversizedFields(),
    });
  },
});

export const reviveByPath = mutation({
  args: {
    repoId: v.id('repos'),
    path: v.string(),
    branch: v.optional(v.string()),
    content: v.string(),
    fileCategory: v.string(),
    lastGithubSha: v.string(),
  },
  handler: async (ctx, args) => {
    let existing = args.branch !== undefined
      ? await ctx.db
          .query('mdFiles')
          .withIndex('by_repo_branch_path', (q) => q.eq('repoId', args.repoId).eq('branch', args.branch).eq('path', args.path))
          .first()
      : null;

    // Check legacy records for default branch
    if (!existing && args.branch !== undefined) {
      const repo = await ctx.db.get(args.repoId);
      if (repo && args.branch === repo.defaultBranch) {
        existing = await ctx.db
          .query('mdFiles')
          .withIndex('by_repo_branch_path', (q) => q.eq('repoId', args.repoId).eq('branch', undefined).eq('path', args.path))
          .first();
      }
    }

    // Fallback to old index when no branch provided
    if (!existing && args.branch === undefined) {
      existing = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_and_path', (q) => q.eq('repoId', args.repoId).eq('path', args.path))
        .first();
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        isDeleted: false,
        deletedAt: undefined,
        content: args.content,
        contentHash: hashContent(args.content),
        yjsStateStorageId: undefined,
        fileCategory: args.fileCategory,
        lastGithubSha: args.lastGithubSha,
        lastSyncedAt: Date.now(),
        ...clearOversizedFields(),
        // Upgrade legacy records
        ...(args.branch !== undefined && existing.branch === undefined ? { branch: args.branch } : {}),
      });
      return existing._id;
    }

    return ctx.db.insert('mdFiles', {
      repoId: args.repoId,
      path: args.path,
      branch: args.branch,
      content: args.content,
      contentHash: hashContent(args.content),
      lastGithubSha: args.lastGithubSha,
      fileCategory: args.fileCategory,
      sizeBytes: args.content.length,
      isDeleted: false,
      lastSyncedAt: Date.now(),
      isOversized: false,
    });
  },
});
