import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const upsertFromGithub = mutation({
  args: {
    githubUserId: v.number(),
    githubLogin: v.string(),
    avatarUrl: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('users')
      .withIndex('by_github_user_id', (q) => q.eq('githubUserId', args.githubUserId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        githubLogin: args.githubLogin,
        avatarUrl: args.avatarUrl,
        email: args.email,
      });
      return existing._id;
    }

    return await ctx.db.insert('users', {
      githubUserId: args.githubUserId,
      githubLogin: args.githubLogin,
      avatarUrl: args.avatarUrl,
      email: args.email,
    });
  },
});

export const get = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    return ctx.db.get(args.userId);
  },
});

export const setBackground = mutation({
  args: {
    userId: v.id('users'),
    bgIndex: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.bgIndex < 0 || args.bgIndex > 11) {
      throw new Error('bgIndex out of range');
    }
    const existing = await ctx.db.get(args.userId);
    if (!existing) throw new Error('User not found');
    await ctx.db.patch(args.userId, {
      bgIndex: args.bgIndex,
    });
    return { ok: true };
  },
});
