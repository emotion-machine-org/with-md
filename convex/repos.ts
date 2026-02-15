import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';

import { hashContent } from './lib/markdownDiff';
import { detectUnsupportedSyntax } from './lib/syntax';
import { fallbackSeedFiles } from './seed/fallbackFiles';

async function applyFallbackFiles(ctx: MutationCtx, repoId: Id<'repos'>, overwrite: boolean) {
  for (const file of fallbackSeedFiles) {
    const existing = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo_and_path', (q) => q.eq('repoId', repoId).eq('path', file.path))
      .first();

    const syntax = detectUnsupportedSyntax(file.content);
    if (!existing) {
      await ctx.db.insert('mdFiles', {
        repoId,
        path: file.path,
        content: file.content,
        contentHash: hashContent(file.content),
        lastGithubSha: 'seed',
        fileCategory: file.fileCategory,
        sizeBytes: file.content.length,
        isDeleted: false,
        lastSyncedAt: Date.now(),
        syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
        syntaxSupportReasons: syntax.reasons,
        isOversized: false,
      });
      continue;
    }

    if (overwrite) {
      await ctx.db.patch(existing._id, {
        content: file.content,
        contentHash: hashContent(file.content),
        lastGithubSha: 'seed',
        fileCategory: file.fileCategory,
        sizeBytes: file.content.length,
        isDeleted: false,
        deletedAt: undefined,
        lastSyncedAt: Date.now(),
        syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
        syntaxSupportReasons: syntax.reasons,
        pendingGithubContent: undefined,
        pendingGithubSha: undefined,
        yjsStateStorageId: undefined,
        isOversized: false,
        lastOversizeBytes: undefined,
        oversizeUpdatedAt: undefined,
      });
      continue;
    }

    if (existing.isDeleted) {
      await ctx.db.patch(existing._id, { isDeleted: false, deletedAt: undefined });
    }
  }
}

async function ensureSeedActivity(ctx: MutationCtx, repoId: Id<'repos'>, summary: string) {
  const existing = await ctx.db
    .query('activities')
    .withIndex('by_repo_and_type', (q) => q.eq('repoId', repoId).eq('type', 'sync_completed'))
    .first();
  if (existing) return;

  await ctx.db.insert('activities', {
    repoId,
    actorId: 'system',
    type: 'sync_completed',
    summary,
    createdAt: Date.now(),
  });
}

async function findOrCreateFallbackRepo(ctx: MutationCtx) {
  const existingRepos = await ctx.db.query('repos').collect();
  const fallbackRepo = existingRepos.find(
    (repo) => repo.owner === 'emotion-machine' && repo.name === 'with-md' && repo.githubRepoId === 0,
  );
  if (fallbackRepo) return { repoId: fallbackRepo._id, created: false as const };

  if (existingRepos.length > 0) {
    return { repoId: existingRepos[0]!._id, created: false as const };
  }

  const installationId = await ctx.db.insert('installations', {
    githubInstallationId: 0,
    githubAccountLogin: 'local',
    githubAccountType: 'User',
  });

  const repoId = await ctx.db.insert('repos', {
    installationId,
    githubRepoId: 0,
    owner: 'emotion-machine',
    name: 'with-md',
    defaultBranch: 'main',
    syncStatus: 'ready',
  });

  return { repoId, created: true as const };
}

export const ensureSeedData = mutation({
  args: {},
  handler: async (ctx) => {
    const { repoId, created } = await findOrCreateFallbackRepo(ctx);
    await applyFallbackFiles(ctx, repoId, false);
    await ensureSeedActivity(ctx, repoId, 'Seeded initial markdown files');
    return { created, repoId };
  },
});

export const restoreFallbackFiles = mutation({
  args: {},
  handler: async (ctx) => {
    const { repoId } = await findOrCreateFallbackRepo(ctx);
    await applyFallbackFiles(ctx, repoId, true);
    await ctx.db.insert('activities', {
      repoId,
      actorId: 'system',
      type: 'sync_completed',
      summary: 'Restored fallback markdown files from seed',
      createdAt: Date.now(),
    });
    return { ok: true, repoId };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const repos = await ctx.db.query('repos').collect();
    const enriched = await Promise.all(
      repos.map(async (repo) => {
        const installation = await ctx.db.get(repo.installationId);
        return {
          ...repo,
          githubInstallationId: installation?.githubInstallationId ?? null,
        };
      }),
    );
    return enriched.sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
  },
});

export const get = query({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    return ctx.db.get(args.repoId);
  },
});

export const upsertFromGithub = mutation({
  args: {
    installationId: v.id('installations'),
    githubRepoId: v.number(),
    owner: v.string(),
    name: v.string(),
    defaultBranch: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('repos')
      .withIndex('by_github_repo_id', (q) => q.eq('githubRepoId', args.githubRepoId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        installationId: args.installationId,
        owner: args.owner,
        name: args.name,
        defaultBranch: args.defaultBranch,
      });
      return existing._id;
    }

    return await ctx.db.insert('repos', {
      installationId: args.installationId,
      githubRepoId: args.githubRepoId,
      owner: args.owner,
      name: args.name,
      defaultBranch: args.defaultBranch,
      syncStatus: 'syncing',
    });
  },
});

export const updateSyncStatus = mutation({
  args: {
    repoId: v.id('repos'),
    syncStatus: v.string(),
    lastSyncedCommitSha: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { syncStatus: args.syncStatus };
    if (args.lastSyncedCommitSha !== undefined) {
      patch.lastSyncedCommitSha = args.lastSyncedCommitSha;
    }
    await ctx.db.patch(args.repoId, patch);
  },
});

export const resync = mutation({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repoId);
    if (!repo) throw new Error('Repo not found');

    const now = Date.now();
    await ctx.db.patch(args.repoId, {
      syncStatus: 'resync_requested',
    });

    await ctx.db.insert('activities', {
      repoId: repo._id,
      actorId: 'local-user',
      type: 'sync_completed',
      summary: `Re-sync requested for ${repo.owner}/${repo.name}`,
      createdAt: now,
    });

    return { ok: true };
  },
});
