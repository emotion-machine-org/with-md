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

    const filtered = includeResolved ? rows : rows.filter((c) => !c.resolvedAt);
    return filtered.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  },
});

export const create = mutation({
  args: {
    mdFileId: v.id('mdFiles'),
    authorId: v.string(),
    body: v.string(),
    commentMarkId: v.optional(v.string()),
    textQuote: v.optional(v.string()),
    anchorPrefix: v.optional(v.string()),
    anchorSuffix: v.optional(v.string()),
    anchorHeadingPath: v.optional(v.array(v.string())),
    fallbackLine: v.optional(v.number()),
    rangeStart: v.optional(v.number()),
    rangeEnd: v.optional(v.number()),
    parentCommentId: v.optional(v.id('comments')),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) {
      throw new Error('Cannot comment on missing or deleted file');
    }

    const now = Date.now();
    const id = await ctx.db.insert('comments', {
      mdFileId: args.mdFileId,
      authorId: args.authorId,
      body: args.body,
      commentMarkId: args.commentMarkId ?? `cmark_${now}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      textQuote: args.textQuote,
      anchorPrefix: args.anchorPrefix,
      anchorSuffix: args.anchorSuffix,
      anchorHeadingPath: args.anchorHeadingPath,
      fallbackLine: args.fallbackLine,
      rangeStart: args.rangeStart,
      rangeEnd: args.rangeEnd,
      parentCommentId: args.parentCommentId,
    });

    await ctx.db.insert('activities', {
      repoId: file.repoId,
      mdFileId: file._id,
      actorId: args.authorId,
      type: 'comment_created',
      summary: `Comment added on ${file.path}`,
      filePath: file.path,
      createdAt: now,
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
    resolvedBy: v.string(),
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
