import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

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
