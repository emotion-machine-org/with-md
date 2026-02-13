import { mutation } from './_generated/server';
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
