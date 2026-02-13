import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const listByFile = query({
  args: {
    mdFileId: v.id('mdFiles'),
    includeResolved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeResolved = args.includeResolved ?? true;

    const rows = await ctx.db
      .query('comments')
      .withIndex('by_md_file', (q) => q.eq('mdFileId', args.mdFileId))
      .collect();

    return includeResolved ? rows : rows.filter((c) => !c.resolvedAt);
  },
});

export const create = mutation({
  args: {
    mdFileId: v.id('mdFiles'),
    authorId: v.id('users'),
    body: v.string(),
    commentMarkId: v.string(),
    textQuote: v.optional(v.string()),
    anchorPrefix: v.optional(v.string()),
    anchorSuffix: v.optional(v.string()),
    anchorHeadingPath: v.optional(v.array(v.string())),
    fallbackLine: v.optional(v.number()),
    parentCommentId: v.optional(v.id('comments')),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('comments', {
      mdFileId: args.mdFileId,
      authorId: args.authorId,
      body: args.body,
      commentMarkId: args.commentMarkId,
      textQuote: args.textQuote,
      anchorPrefix: args.anchorPrefix,
      anchorSuffix: args.anchorSuffix,
      anchorHeadingPath: args.anchorHeadingPath,
      fallbackLine: args.fallbackLine,
      parentCommentId: args.parentCommentId,
    });

    return ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    commentId: v.id('comments'),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.commentId, { body: args.body });
  },
});

export const resolve = mutation({
  args: {
    commentId: v.id('comments'),
    resolvedBy: v.id('users'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.commentId, {
      resolvedAt: Date.now(),
      resolvedBy: args.resolvedBy,
    });
  },
});

export const remove = mutation({
  args: {
    commentId: v.id('comments'),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.commentId);
  },
});
