import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query('repos').collect();
  },
});

export const get = query({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    return ctx.db.get(args.repoId);
  },
});

export const resync = mutation({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.repoId, {
      syncStatus: 'resync_requested',
    });
    return { ok: true };
  },
});
