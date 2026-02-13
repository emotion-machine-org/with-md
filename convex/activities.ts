import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const create = mutation({
  args: {
    repoId: v.id('repos'),
    mdFileId: v.optional(v.id('mdFiles')),
    actorId: v.string(),
    type: v.string(),
    summary: v.string(),
    filePath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('activities', {
      repoId: args.repoId,
      mdFileId: args.mdFileId,
      actorId: args.actorId,
      type: args.type,
      summary: args.summary,
      filePath: args.filePath,
      createdAt: Date.now(),
    });
  },
});

export const listByRepo = query({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('activities')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect();

    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const unreadCount = query({
  args: {
    repoId: v.id('repos'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const cursor = await ctx.db
      .query('activityReadCursors')
      .withIndex('by_user_and_repo', (q) => q.eq('userId', args.userId).eq('repoId', args.repoId))
      .first();

    const lastReadAt = cursor?.lastReadAt ?? 0;

    const rows = await ctx.db
      .query('activities')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect();

    return rows.filter((row) => row.createdAt > lastReadAt).length;
  },
});

export const markAsRead = mutation({
  args: {
    repoId: v.id('repos'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('activityReadCursors')
      .withIndex('by_user_and_repo', (q) => q.eq('userId', args.userId).eq('repoId', args.repoId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastReadAt: Date.now() });
      return;
    }

    await ctx.db.insert('activityReadCursors', {
      userId: args.userId,
      repoId: args.repoId,
      lastReadAt: Date.now(),
    });
  },
});
