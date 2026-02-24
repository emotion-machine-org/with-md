import type { Id } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';

export const upsert = internalMutation({
  args: {
    githubInstallationId: v.number(),
    githubAccountLogin: v.string(),
    githubAccountType: v.string(),
    connectedBy: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('installations')
      .withIndex('by_github_installation_id', (q) =>
        q.eq('githubInstallationId', args.githubInstallationId),
      )
      .first();

    if (existing) {
      if (
        existing.connectedBy
        && args.connectedBy
        && existing.connectedBy !== args.connectedBy
      ) {
        throw new Error('forbidden_installation_owner_mismatch');
      }

      const patch: {
        githubAccountLogin: string;
        githubAccountType: string;
        connectedBy?: Id<'users'>;
      } = {
        githubAccountLogin: args.githubAccountLogin,
        githubAccountType: args.githubAccountType,
      };
      if (!existing.connectedBy && args.connectedBy) {
        patch.connectedBy = args.connectedBy;
      }

      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert('installations', {
      githubInstallationId: args.githubInstallationId,
      githubAccountLogin: args.githubAccountLogin,
      githubAccountType: args.githubAccountType,
      connectedBy: args.connectedBy,
    });
  },
});

export const get = internalQuery({
  args: { installationId: v.id('installations') },
  handler: async (ctx, args) => {
    return ctx.db.get(args.installationId);
  },
});
