import { internalMutation, internalQuery, mutation } from './_generated/server';
import { v } from 'convex/values';

import { hashContent, hasMeaningfulDiff } from './lib/markdownDiff';
import { detectUnsupportedSyntax } from './lib/syntax';

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

    const now = Date.now();
    if (hasMeaningfulDiff(args.markdownContent, file.content)) {
      const syntax = detectUnsupportedSyntax(args.markdownContent);
      await ctx.db.patch(file._id, {
        content: args.markdownContent,
        contentHash: hashContent(args.markdownContent),
        editHeartbeat: now,
        syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
        syntaxSupportReasons: syntax.reasons,
        pendingGithubContent: args.markdownContent,
        pendingGithubSha: hashContent(args.markdownContent),
      });

      const queued = await ctx.db
        .query('pushQueue')
        .withIndex('by_md_file', (q) => q.eq('mdFileId', file._id))
        .collect();
      const pending = queued.find((item) => item.status === 'queued');

      if (pending) {
        await ctx.db.patch(pending._id, {
          newContent: args.markdownContent,
          createdAt: now,
        });
      } else {
        await ctx.db.insert('pushQueue', {
          repoId: file.repoId,
          mdFileId: file._id,
          path: file.path,
          newContent: args.markdownContent,
          authorLogins: [],
          authorEmails: [],
          status: 'queued',
          createdAt: now,
        });
      }
    } else {
      await ctx.db.patch(file._id, {
        editHeartbeat: now,
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

    const now = Date.now();
    const syntax = detectUnsupportedSyntax(args.markdownContent);

    await ctx.db.patch(file._id, {
      content: args.markdownContent,
      contentHash: hashContent(args.markdownContent),
      editHeartbeat: now,
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
      pendingGithubContent: args.markdownContent,
      pendingGithubSha: hashContent(args.markdownContent),
    });

    await ctx.db.insert('activities', {
      repoId: file.repoId,
      mdFileId: file._id,
      actorId: 'local-user',
      type: 'source_saved',
      summary: `Collaborative edits persisted for ${file.path}`,
      filePath: file.path,
      createdAt: now,
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
