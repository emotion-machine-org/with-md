import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

import { hashContent } from './lib/markdownDiff';
import { detectUnsupportedSyntax } from './lib/syntax';

export const list = query({
  args: {},
  handler: async (ctx) => {
    const repos = await ctx.db.query('repos').collect();
    return repos.sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
  },
});

export const get = query({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    return ctx.db.get(args.repoId);
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

export const ensureSeedData = mutation({
  args: {},
  handler: async (ctx) => {
    const existingRepos = await ctx.db.query('repos').collect();
    if (existingRepos.length > 0) {
      return { created: false, repoId: existingRepos[0]!._id };
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

    const docsFile = `# with.md Architecture Notes

with.md enables markdown collaboration for people and agents.

## Workflow

1. Open file in read mode.
2. Enter rich edit mode when syntax is supported.
3. Fall back to source mode when unsupported.
`;

    const agentsFile = `# AGENTS

Agent instructions here.
`;

    const seedFiles = [
      { path: 'docs/with-md-architecture.md', content: docsFile, fileCategory: 'docs' },
      { path: 'AGENTS.md', content: agentsFile, fileCategory: 'agent' },
    ];

    for (const file of seedFiles) {
      const syntax = detectUnsupportedSyntax(file.content);
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
      });
    }

    await ctx.db.insert('activities', {
      repoId,
      actorId: 'system',
      type: 'sync_completed',
      summary: 'Seeded initial markdown files',
      createdAt: Date.now(),
    });

    return { created: true, repoId };
  },
});
