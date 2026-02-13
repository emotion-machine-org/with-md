import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const upsert = mutation({
  args: {
    githubInstallationId: v.number(),
    githubAccountLogin: v.string(),
    githubAccountType: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('installations')
      .withIndex('by_github_installation_id', (q) =>
        q.eq('githubInstallationId', args.githubInstallationId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        githubAccountLogin: args.githubAccountLogin,
        githubAccountType: args.githubAccountType,
      });
      return existing._id;
    }

    return await ctx.db.insert('installations', {
      githubInstallationId: args.githubInstallationId,
      githubAccountLogin: args.githubAccountLogin,
      githubAccountType: args.githubAccountType,
    });
  },
});

export const get = query({
  args: { installationId: v.id('installations') },
  handler: async (ctx, args) => {
    return ctx.db.get(args.installationId);
  },
});
