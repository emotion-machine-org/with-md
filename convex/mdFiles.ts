import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

import { hashContent, hasMeaningfulDiff } from './lib/markdownDiff';

export const listByRepo = query({
  args: {
    repoId: v.id('repos'),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeDeleted = args.includeDeleted ?? false;

    const rows = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect();

    return rows
      .filter((row) => includeDeleted || !row.isDeleted)
      .sort((a, b) => a.path.localeCompare(b.path));
  },
});

export const get = query({
  args: { mdFileId: v.id('mdFiles') },
  handler: async (ctx, args) => {
    return ctx.db.get(args.mdFileId);
  },
});

export const resolveByPath = query({
  args: {
    repoId: v.id('repos'),
    path: v.string(),
  },
  handler: async (ctx, args) => {
    const hit = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo_and_path', (q) => q.eq('repoId', args.repoId).eq('path', args.path))
      .first();

    if (!hit || hit.isDeleted) return null;
    return hit;
  },
});

export const saveSource = mutation({
  args: {
    mdFileId: v.id('mdFiles'),
    sourceContent: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) {
      throw new Error('Cannot save source for missing or deleted file');
    }

    if (!hasMeaningfulDiff(args.sourceContent, file.content)) {
      return { changed: false };
    }

    await ctx.db.patch(args.mdFileId, {
      content: args.sourceContent,
      contentHash: hashContent(args.sourceContent),
      // Source mode is canonical markdown; rich snapshot is stale.
      yjsStateStorageId: undefined,
    });

    await ctx.db.insert('pushQueue', {
      repoId: file.repoId,
      mdFileId: file._id,
      path: file.path,
      newContent: args.sourceContent,
      authorLogins: [],
      authorEmails: [],
      status: 'queued',
      createdAt: Date.now(),
    });

    return { changed: true };
  },
});
