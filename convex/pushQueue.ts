import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const listByRepo = query({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    return ctx.db
      .query('pushQueue')
      .withIndex('by_repo_and_status', (q) => q.eq('repoId', args.repoId).eq('status', 'queued'))
      .collect();
  },
});

export const unpushedCount = query({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    const queued = await ctx.db
      .query('pushQueue')
      .withIndex('by_repo_and_status', (q) => q.eq('repoId', args.repoId).eq('status', 'queued'))
      .collect();

    return queued.length;
  },
});

export const pushNow = mutation({
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
