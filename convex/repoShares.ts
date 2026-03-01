import type { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';

interface RepoShareDoc {
  _id: Id<'repoShares'>;
  shortIdHash: string;
  editSecretHash: string;
  mdFileId: Id<'mdFiles'>;
  createdByUserId: Id<'users'>;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
}

function isActiveShare(share: RepoShareDoc, now: number): boolean {
  if (typeof share.revokedAt === 'number') return false;
  if (share.expiresAt <= now) return false;
  return true;
}

async function getActiveShareByShortIdHash(
  ctx: {
    db: {
      query: (table: 'repoShares') => any;
    };
  },
  shortIdHash: string,
): Promise<RepoShareDoc | null> {
  const share = await ctx.db
    .query('repoShares')
    .withIndex('by_short_id_hash', (q: any) => q.eq('shortIdHash', shortIdHash))
    .first();
  if (!share) return null;

  const now = Date.now();
  if (!isActiveShare(share as RepoShareDoc, now)) {
    return null;
  }
  return share as RepoShareDoc;
}

export const create = internalMutation({
  args: {
    shortIdHash: v.string(),
    editSecretHash: v.string(),
    mdFileId: v.id('mdFiles'),
    createdByUserId: v.id('users'),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('repoShares')
      .withIndex('by_short_id_hash', (q) => q.eq('shortIdHash', args.shortIdHash))
      .first();
    if (existing) {
      throw new Error('Short ID already exists');
    }

    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) {
      throw new Error('Document not found');
    }

    const now = Date.now();
    await ctx.db.insert('repoShares', {
      shortIdHash: args.shortIdHash,
      editSecretHash: args.editSecretHash,
      mdFileId: args.mdFileId,
      createdByUserId: args.createdByUserId,
      createdAt: now,
      expiresAt: args.expiresAt,
    });

    return { ok: true as const };
  },
});

export const resolve = internalQuery({
  args: {
    shortIdHash: v.string(),
    editSecretHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const share = await getActiveShareByShortIdHash(ctx as never, args.shortIdHash);
    if (!share) return null;

    return {
      mdFileId: share.mdFileId,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      canEdit: Boolean(args.editSecretHash && args.editSecretHash === share.editSecretHash),
    };
  },
});

export const updateViaApi = internalMutation({
  args: {
    shortIdHash: v.string(),
    editSecretHash: v.string(),
    content: v.string(),
    expectedContentHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const share = await getActiveShareByShortIdHash(ctx as never, args.shortIdHash);
    if (!share) return { ok: false as const, reason: 'missing' as const };
    if (share.editSecretHash !== args.editSecretHash) {
      return { ok: false as const, reason: 'forbidden' as const };
    }

    const file = await ctx.db.get(share.mdFileId);
    if (!file || file.isDeleted) {
      return { ok: false as const, reason: 'missing' as const };
    }

    if (typeof args.expectedContentHash === 'string' && args.expectedContentHash.trim()) {
      const expectedContentHash = args.expectedContentHash.trim();
      if (expectedContentHash !== file.contentHash) {
        return {
          ok: false as const,
          reason: 'version_mismatch' as const,
          currentContentHash: file.contentHash,
        };
      }
    }

    const normalizedContent = args.content.replace(/\r\n/g, '\n');
    await ctx.runMutation(internal.mdFiles.saveSource, {
      mdFileId: share.mdFileId,
      sourceContent: normalizedContent,
    });

    const updatedFile = await ctx.db.get(share.mdFileId);
    if (!updatedFile || updatedFile.isDeleted) {
      return { ok: false as const, reason: 'missing' as const };
    }

    return {
      ok: true as const,
      mdFileId: updatedFile._id,
      path: updatedFile.path,
      contentHash: updatedFile.contentHash,
      updatedAt: updatedFile.lastSyncedAt,
    };
  },
});
