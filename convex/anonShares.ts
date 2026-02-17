import type { Id } from './_generated/dataModel';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { v } from 'convex/values';

import { markdownByteLength } from './lib/collabPolicy';
import { hashContent, hasMeaningfulDiff } from './lib/markdownDiff';
import { detectUnsupportedSyntax } from './lib/syntax';

const DEFAULT_ANON_REALTIME_MAX_BYTES = 1024 * 1024;
const ANON_REALTIME_MAX_BYTES = (() => {
  const raw = process.env.WITHMD_ANON_REALTIME_MAX_BYTES;
  if (!raw) return DEFAULT_ANON_REALTIME_MAX_BYTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ANON_REALTIME_MAX_BYTES;
  return parsed;
})();
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EDIT_SECRET_PEPPER = 'withmd-anon-share-edit-secret';
const EDIT_SECRET_PEPPER = process.env.WITHMD_ANON_SHARE_EDIT_SECRET_PEPPER ?? DEFAULT_EDIT_SECRET_PEPPER;

async function hashEditSecret(secret: string): Promise<string> {
  const value = `${EDIT_SECRET_PEPPER}:${secret.trim()}`;
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function canEditShare(share: AnonShareDoc, editSecret: string): Promise<boolean> {
  if (!editSecret) return false;
  if (!share.editSecretHash) return false;
  const incomingHash = await hashEditSecret(editSecret);
  return incomingHash === share.editSecretHash;
}

function parseShareDocumentName(documentName: string): string | null {
  if (!documentName.startsWith('share:')) return null;
  const shortId = documentName.slice('share:'.length).trim();
  if (!shortId) return null;
  return shortId;
}

function buildDocumentVersion(contentHash: string, yjsStateStorageId: Id<'_storage'> | undefined): string {
  return `${contentHash}:${yjsStateStorageId ?? 'none'}`;
}

async function getActiveShareByShortId(
  ctx: any,
  shortId: string,
): Promise<AnonShareDoc | null> {
  const share = await ctx.db
    .query('anonShares')
    .withIndex('by_short_id', (q: any) => q.eq('shortId', shortId))
    .first();
  if (!share || share.isDeleted) return null;
  if (typeof share.expiresAt === 'number' && share.expiresAt <= Date.now()) return null;
  return share;
}

interface AnonShareDoc {
  _id: Id<'anonShares'>;
  shortId: string;
  title: string;
  content: string;
  contentHash: string;
  sizeBytes: number;
  syntaxSupportStatus?: string;
  syntaxSupportReasons?: string[];
  yjsStateStorageId?: Id<'_storage'>;
  editSecretHash?: string;
  editSecret?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  isDeleted: boolean;
  deletedAt?: number;
  createdByIpHash?: string;
}

async function persistShareDocument(
  ctx: any,
  args: {
    documentName: string;
    markdownContent: string;
    yjsStateStorageId?: Id<'_storage'>;
  },
) {
  const shortId = parseShareDocumentName(args.documentName);
  if (!shortId) {
    return {
      persistPath: 'missing',
      markdownBytes: markdownByteLength(args.markdownContent),
      documentVersion: 'missing',
    };
  }

  const share = await getActiveShareByShortId(ctx, shortId);
  if (!share) {
    return {
      persistPath: 'missing',
      markdownBytes: markdownByteLength(args.markdownContent),
      documentVersion: 'missing',
    };
  }

  const normalized = args.markdownContent.replace(/\r\n/g, '\n');
  const markdownBytes = markdownByteLength(normalized);
  if (markdownBytes > ANON_REALTIME_MAX_BYTES) {
    return {
      persistPath: 'oversized',
      markdownBytes,
      documentVersion: buildDocumentVersion(share.contentHash, share.yjsStateStorageId),
    };
  }

  const hasDiff = hasMeaningfulDiff(normalized, share.content);
  const incomingYjsStateStorageId = args.yjsStateStorageId;
  const nextYjsStateStorageId = incomingYjsStateStorageId ?? share.yjsStateStorageId;
  const replacedYjsStateStorageId =
    incomingYjsStateStorageId && incomingYjsStateStorageId !== share.yjsStateStorageId
      ? share.yjsStateStorageId
      : undefined;

  const now = Date.now();
  if (!hasDiff) {
    await ctx.db.patch(share._id, {
      yjsStateStorageId: nextYjsStateStorageId,
      updatedAt: now,
    });
    return {
      persistPath: 'unchanged',
      markdownBytes,
      replacedYjsStateStorageId,
      documentVersion: buildDocumentVersion(share.contentHash, nextYjsStateStorageId),
    };
  }

  const syntax = detectUnsupportedSyntax(normalized);
  const nextContentHash = hashContent(normalized);
  await ctx.db.patch(share._id, {
    content: normalized,
    contentHash: nextContentHash,
    sizeBytes: markdownBytes,
    syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
    syntaxSupportReasons: syntax.reasons,
    yjsStateStorageId: nextYjsStateStorageId,
    updatedAt: now,
  });

  return {
    persistPath: 'normal',
    markdownBytes,
    replacedYjsStateStorageId,
    documentVersion: buildDocumentVersion(nextContentHash, nextYjsStateStorageId),
  };
}

export const consumeCreateQuota = mutation({
  args: {
    ipHash: v.string(),
    now: v.number(),
    maxPerDay: v.number(),
  },
  handler: async (ctx, args) => {
    const dayBucket = Math.floor(args.now / DAY_MS);
    const bucket = `create:${args.ipHash}:${dayBucket}`;
    const existing = await ctx.db
      .query('anonRateLimits')
      .withIndex('by_bucket', (q) => q.eq('bucket', bucket))
      .first();
    const resetAt = (dayBucket + 1) * DAY_MS;

    if (!existing) {
      await ctx.db.insert('anonRateLimits', {
        bucket,
        count: 1,
        updatedAt: args.now,
      });
      return {
        ok: true,
        remaining: Math.max(0, args.maxPerDay - 1),
        resetAt,
      };
    }

    if (existing.count >= args.maxPerDay) {
      return { ok: false, remaining: 0, resetAt };
    }

    const nextCount = existing.count + 1;
    await ctx.db.patch(existing._id, {
      count: nextCount,
      updatedAt: args.now,
    });

    return {
      ok: true,
      remaining: Math.max(0, args.maxPerDay - nextCount),
      resetAt,
    };
  },
});

export const create = mutation({
  args: {
    shortId: v.string(),
    title: v.string(),
    content: v.string(),
    editSecret: v.string(),
    createdByIpHash: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('anonShares')
      .withIndex('by_short_id', (q) => q.eq('shortId', args.shortId))
      .first();
    if (existing && !existing.isDeleted) {
      throw new Error('Short ID already exists');
    }

    const normalized = args.content.replace(/\r\n/g, '\n');
    const now = Date.now();
    const syntax = detectUnsupportedSyntax(normalized);
    const sizeBytes = markdownByteLength(normalized);
    const contentHash = hashContent(normalized);
    const editSecretHash = await hashEditSecret(args.editSecret);

    await ctx.db.insert('anonShares', {
      shortId: args.shortId,
      title: args.title,
      content: normalized,
      contentHash,
      sizeBytes,
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
      editSecretHash,
      createdAt: now,
      updatedAt: now,
      expiresAt: args.expiresAt,
      isDeleted: false,
      createdByIpHash: args.createdByIpHash,
    });

    return {
      ok: true,
      shortId: args.shortId,
      createdAt: now,
      expiresAt: args.expiresAt ?? null,
    };
  },
});

export const getPublic = query({
  args: { shortId: v.string() },
  handler: async (ctx, args) => {
    const share = await getActiveShareByShortId(ctx, args.shortId);
    if (!share) return null;
    return {
      shortId: share.shortId,
      title: share.title,
      content: share.content,
      contentHash: share.contentHash,
      sizeBytes: share.sizeBytes,
      syntaxSupportStatus: share.syntaxSupportStatus ?? 'unknown',
      syntaxSupportReasons: share.syntaxSupportReasons ?? [],
      createdAt: share.createdAt,
      updatedAt: share.updatedAt,
      expiresAt: share.expiresAt ?? null,
    };
  },
});

export const canEdit = query({
  args: {
    shortId: v.string(),
    editSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const share = await getActiveShareByShortId(ctx, args.shortId);
    if (!share) return { ok: false, reason: 'missing' as const };
    const allowed = await canEditShare(share, args.editSecret);
    if (!allowed) {
      return { ok: false, reason: 'forbidden' as const };
    }
    return { ok: true };
  },
});

export const authenticate = internalQuery({
  args: {
    documentName: v.string(),
    editSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const shortId = parseShareDocumentName(args.documentName);
    if (!shortId) return { ok: false, reason: 'invalid_name' as const };

    const share = await getActiveShareByShortId(ctx, shortId);
    if (!share) return { ok: false, reason: 'missing' as const };
    const allowed = await canEditShare(share, args.editSecret);
    if (!allowed) {
      return { ok: false, reason: 'forbidden' as const };
    }

    return { ok: true };
  },
});

export const loadDocument = internalQuery({
  args: {
    documentName: v.string(),
  },
  handler: async (ctx, args) => {
    const shortId = parseShareDocumentName(args.documentName);
    if (!shortId) {
      return {
        yjsStateUrl: null,
        yjsStateStorageId: null,
        markdownContent: '',
        syntaxSupportStatus: 'unknown',
        documentVersion: 'missing',
      };
    }

    const share = await getActiveShareByShortId(ctx, shortId);
    if (!share) {
      return {
        yjsStateUrl: null,
        yjsStateStorageId: null,
        markdownContent: '',
        syntaxSupportStatus: 'unknown',
        documentVersion: 'missing',
      };
    }

    const yjsStateUrl = share.yjsStateStorageId
      ? await ctx.storage.getUrl(share.yjsStateStorageId)
      : null;

    return {
      yjsStateUrl,
      yjsStateStorageId: share.yjsStateStorageId ?? null,
      markdownContent: share.content,
      syntaxSupportStatus: share.syntaxSupportStatus ?? 'unknown',
      documentVersion: buildDocumentVersion(share.contentHash, share.yjsStateStorageId),
    };
  },
});

export const storeDocument = internalMutation({
  args: {
    documentName: v.string(),
    markdownContent: v.string(),
    yjsStateStorageId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, args) => persistShareDocument(ctx, args),
});

export const storeDocumentOversized = internalMutation({
  args: {
    documentName: v.string(),
    markdownBytes: v.number(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const shortId = parseShareDocumentName(args.documentName);
    if (!shortId) return { persistPath: 'missing' as const };
    const share = await getActiveShareByShortId(ctx, shortId);
    if (!share) return { persistPath: 'missing' as const };
    await ctx.db.patch(share._id, { updatedAt: Date.now() });
    return {
      persistPath: 'oversized' as const,
      markdownBytes: args.markdownBytes,
      source: args.source ?? 'unknown',
    };
  },
});
