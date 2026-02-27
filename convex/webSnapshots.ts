import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

export const getByUrlHash = internalQuery({
  args: { urlHash: v.string() },
  handler: async (ctx, { urlHash }) => {
    return ctx.db
      .query('webSnapshots')
      .withIndex('by_url_hash', q => q.eq('urlHash', urlHash))
      .first();
  },
});

export const upsert = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('webSnapshots')
      .withIndex('by_url_hash', q => q.eq('urlHash', args.urlHash))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert('webSnapshots', args);
  },
});

export const createVersion = internalMutation({
  args: {
    snapshotId: v.id('webSnapshots'),
    urlHash: v.string(),
    version: v.number(),
    normalizedUrl: v.string(),
    markdown: v.string(),
    markdownHash: v.string(),
    sourceEngine: v.string(),
    trigger: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert('webSnapshotVersions', args);
  },
});

export const listVersions = internalQuery({
  args: { snapshotId: v.id('webSnapshots') },
  handler: async (ctx, { snapshotId }) => {
    return ctx.db
      .query('webSnapshotVersions')
      .withIndex('by_snapshot', q => q.eq('snapshotId', snapshotId))
      .order('desc')
      .take(20);
  },
});

export const listVersionsByUrlHash = internalQuery({
  args: { urlHash: v.string() },
  handler: async (ctx, { urlHash }) => {
    return ctx.db
      .query('webSnapshotVersions')
      .withIndex('by_url_hash', q => q.eq('urlHash', urlHash))
      .order('desc')
      .take(20);
  },
});
