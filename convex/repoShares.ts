import type { Id } from './_generated/dataModel';
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
    const share = await ctx.db
      .query('repoShares')
      .withIndex('by_short_id_hash', (q) => q.eq('shortIdHash', args.shortIdHash))
      .first();
    if (!share) return null;

    const now = Date.now();
    if (!isActiveShare(share as RepoShareDoc, now)) {
      return null;
    }

    return {
      mdFileId: share.mdFileId,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      canEdit: Boolean(args.editSecretHash && args.editSecretHash === share.editSecretHash),
    };
  },
});
