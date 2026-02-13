import { internalMutation, internalQuery, mutation } from './_generated/server';
import { v } from 'convex/values';

import { hashContent, hasMeaningfulDiff } from './lib/markdownDiff';

export const authenticate = internalQuery({
  args: {
    userToken: v.string(),
    mdFileId: v.string(),
  },
  handler: async (_ctx, _args) => {
    // TODO: validate Clerk/GitHub identity and repo access.
    return { ok: true };
  },
});

export const loadDocument = internalQuery({
  args: {
    mdFileId: v.id('mdFiles'),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file) throw new Error('File not found');

    return {
      yjsState: null,
      markdownContent: file.content,
      syntaxSupportStatus: file.syntaxSupportStatus ?? 'unknown',
    };
  },
});

export const storeDocument = internalMutation({
  args: {
    mdFileId: v.id('mdFiles'),
    markdownContent: v.string(),
    yjsState: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) return;

    if (hasMeaningfulDiff(args.markdownContent, file.content)) {
      await ctx.db.patch(file._id, {
        content: args.markdownContent,
        contentHash: hashContent(args.markdownContent),
        editHeartbeat: Date.now(),
      });
    } else {
      await ctx.db.patch(file._id, {
        editHeartbeat: Date.now(),
      });
    }

    // TODO: persist yjsState into _storage and set yjsStateStorageId.
    void args.yjsState;
  },
});

export const onAllDisconnected = internalMutation({
  args: {
    mdFileId: v.id('mdFiles'),
    markdownContent: v.string(),
    yjsState: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) return;

    await ctx.db.patch(file._id, {
      content: args.markdownContent,
      contentHash: hashContent(args.markdownContent),
      editHeartbeat: Date.now(),
    });

    // TODO: persist yjsState and process queued suggestions.
    void args.yjsState;
  },
});

export const tombstoneFile = mutation({
  args: {
    mdFileId: v.id('mdFiles'),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file) return;

    await ctx.db.patch(file._id, {
      isDeleted: true,
      deletedAt: Date.now(),
      yjsStateStorageId: undefined,
    });
  },
});

export const reviveByPath = mutation({
  args: {
    repoId: v.id('repos'),
    path: v.string(),
    content: v.string(),
    fileCategory: v.string(),
    lastGithubSha: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo_and_path', (q) => q.eq('repoId', args.repoId).eq('path', args.path))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isDeleted: false,
        deletedAt: undefined,
        content: args.content,
        contentHash: hashContent(args.content),
        fileCategory: args.fileCategory,
        lastGithubSha: args.lastGithubSha,
        lastSyncedAt: Date.now(),
      });
      return existing._id;
    }

    return ctx.db.insert('mdFiles', {
      repoId: args.repoId,
      path: args.path,
      content: args.content,
      contentHash: hashContent(args.content),
      lastGithubSha: args.lastGithubSha,
      fileCategory: args.fileCategory,
      sizeBytes: args.content.length,
      isDeleted: false,
      lastSyncedAt: Date.now(),
    });
  },
});
