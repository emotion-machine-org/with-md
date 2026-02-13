import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const listByFile = query({
  args: { mdFileId: v.id('mdFiles') },
  handler: async (ctx, args) => {
    return ctx.db
      .query('suggestions')
      .withIndex('by_md_file', (q) => q.eq('mdFileId', args.mdFileId))
      .collect();
  },
});

export const create = mutation({
  args: {
    mdFileId: v.id('mdFiles'),
    authorId: v.id('users'),
    originalText: v.string(),
    suggestedText: v.string(),
    baseContentHash: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert('suggestions', {
      mdFileId: args.mdFileId,
      authorId: args.authorId,
      status: 'pending',
      originalText: args.originalText,
      suggestedText: args.suggestedText,
      baseContentHash: args.baseContentHash,
    });
  },
});

export const accept = mutation({
  args: { suggestionId: v.id('suggestions'), resolvedBy: v.id('users') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.suggestionId, {
      status: 'accepted',
      resolvedBy: args.resolvedBy,
      resolvedAt: Date.now(),
    });
  },
});

export const reject = mutation({
  args: { suggestionId: v.id('suggestions'), resolvedBy: v.id('users') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.suggestionId, {
      status: 'rejected',
      resolvedBy: args.resolvedBy,
      resolvedAt: Date.now(),
    });
  },
});
