import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

import { hashContent, hasMeaningfulDiff } from './lib/markdownDiff';
import { detectUnsupportedSyntax } from './lib/syntax';

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

export const upsertFromSync = mutation({
  args: {
    repoId: v.id('repos'),
    path: v.string(),
    content: v.string(),
    githubSha: v.string(),
    fileCategory: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo_and_path', (q) => q.eq('repoId', args.repoId).eq('path', args.path))
      .first();

    const syntax = detectUnsupportedSyntax(args.content);
    const now = Date.now();

    if (existing) {
      // Only update if the GitHub SHA changed
      if (existing.lastGithubSha === args.githubSha && !existing.isDeleted) {
        return existing._id;
      }

      await ctx.db.patch(existing._id, {
        content: args.content,
        contentHash: hashContent(args.content),
        lastGithubSha: args.githubSha,
        fileCategory: args.fileCategory,
        sizeBytes: args.sizeBytes,
        isDeleted: false,
        deletedAt: undefined,
        lastSyncedAt: now,
        syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
        syntaxSupportReasons: syntax.reasons,
      });
      return existing._id;
    }

    return await ctx.db.insert('mdFiles', {
      repoId: args.repoId,
      path: args.path,
      content: args.content,
      contentHash: hashContent(args.content),
      lastGithubSha: args.githubSha,
      fileCategory: args.fileCategory,
      sizeBytes: args.sizeBytes,
      isDeleted: false,
      lastSyncedAt: now,
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
    });
  },
});

export const markMissingAsDeleted = mutation({
  args: {
    repoId: v.id('repos'),
    existingPaths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const allFiles = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect();

    const pathSet = new Set(args.existingPaths);
    const now = Date.now();

    for (const file of allFiles) {
      if (!file.isDeleted && !pathSet.has(file.path)) {
        await ctx.db.patch(file._id, { isDeleted: true, deletedAt: now });
      }
    }
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

    const now = Date.now();
    const syntax = detectUnsupportedSyntax(args.sourceContent);

    await ctx.db.patch(args.mdFileId, {
      content: args.sourceContent,
      contentHash: hashContent(args.sourceContent),
      // Source mode is canonical markdown; rich snapshot is stale.
      yjsStateStorageId: undefined,
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
      lastSyncedAt: now,
    });

    await ctx.db.insert('pushQueue', {
      repoId: file.repoId,
      mdFileId: file._id,
      path: file.path,
      newContent: args.sourceContent,
      authorLogins: [],
      authorEmails: [],
      status: 'queued',
      createdAt: now,
    });

    await ctx.db.insert('activities', {
      repoId: file.repoId,
      mdFileId: file._id,
      actorId: 'local-user',
      type: 'source_saved',
      summary: `Source saved for ${file.path}`,
      filePath: file.path,
      createdAt: now,
    });

    return { changed: true };
  },
});
