import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';

import { markdownByteLength } from './lib/collabPolicy';

export const listByRepo = internalQuery({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    const queued = await ctx.db
      .query('pushQueue')
      .withIndex('by_repo_and_status', (q) => q.eq('repoId', args.repoId).eq('status', 'queued'))
      .collect();

    return queued.sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime);
  },
});

export const listByRepoMeta = internalQuery({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    const queued = await ctx.db
      .query('pushQueue')
      .withIndex('by_repo_and_status', (q) => q.eq('repoId', args.repoId).eq('status', 'queued'))
      .collect();

    return queued
      .map((item) => ({
        pushQueueId: item._id,
        mdFileId: item.mdFileId,
        path: item.path,
        status: item.status,
        createdAt: item.createdAt,
        newContentBytes: markdownByteLength(item.newContent),
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const unpushedCount = internalQuery({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    const queued = await ctx.db
      .query('pushQueue')
      .withIndex('by_repo_and_status', (q) => q.eq('repoId', args.repoId).eq('status', 'queued'))
      .collect();

    return queued.length;
  },
});

export const markPushed = internalMutation({
  args: {
    pushQueueId: v.id('pushQueue'),
    commitSha: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.pushQueueId, {
      status: 'pushed',
      pushedAt: Date.now(),
      commitSha: args.commitSha,
    });
  },
});

export const pushNow = internalMutation({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repoId);
    if (!repo) throw new Error('Repo not found');

    const queued = await ctx.db
      .query('pushQueue')
      .withIndex('by_repo_and_status', (q) => q.eq('repoId', args.repoId).eq('status', 'queued'))
      .collect();

    const now = Date.now();
    for (const item of queued) {
      await ctx.db.patch(item._id, {
        status: 'pushed',
        pushedAt: now,
        commitSha: item.commitSha ?? `local_${now}`,
      });
    }

    await ctx.db.insert('activities', {
      repoId: repo._id,
      actorId: 'local-user',
      type: 'push_completed',
      summary: `Push requested for ${repo.owner}/${repo.name} (${queued.length} files)`,
      createdAt: now,
    });

    return { ok: true, pushed: queued.length };
  },
});
