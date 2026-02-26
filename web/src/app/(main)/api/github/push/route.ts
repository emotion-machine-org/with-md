import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex, queryConvex } from '@/lib/with-md/convex-client';
import { canAccessRepoInInstallation } from '@/lib/with-md/github-access';
import { createCommitWithFiles, fetchMdTree, getInstallationToken, getRepoInstallationId } from '@/lib/with-md/github';
import { getSessionOrNull } from '@/lib/with-md/session';

interface RepoDoc {
  _id: string;
  installationId: string;
  githubRepoId: number;
  owner: string;
  name: string;
  defaultBranch: string;
  activeBranch?: string;
}

interface InstallationDoc {
  _id: string;
  githubInstallationId: number;
  connectedBy?: string;
}

interface PushQueueItem {
  _id: string;
  path: string;
  branch?: string;
  newContent: string;
  isDelete?: boolean;
  status: string;
}

export async function POST(req: NextRequest) {
  const session = await getSessionOrNull();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as { repoId: string; branch?: string; paths?: string[]; message?: string };

  try {
    // Get repo details
    const repo = await queryConvex<RepoDoc | null>(F.queries.reposGet, {
      repoId: body.repoId as never,
    });
    if (!repo) {
      return NextResponse.json({ error: 'Repo not found' }, { status: 404 });
    }

    // Get installation; resolve fresh from GitHub if the stored ID is stale
    const installation = await queryConvex<InstallationDoc | null>(F.queries.installationsGet, {
      installationId: repo.installationId as never,
    });
    let ghInstallationId = installation?.githubInstallationId;
    if (ghInstallationId) {
      try {
        await getInstallationToken(ghInstallationId);
      } catch {
        ghInstallationId = await getRepoInstallationId(repo.owner, repo.name);
      }
    } else {
      ghInstallationId = await getRepoInstallationId(repo.owner, repo.name);
    }

    const ownedInApp = installation?.connectedBy === session.userId;
    const hasGithubAccess = await canAccessRepoInInstallation(
      session.githubToken,
      ghInstallationId,
      repo.owner,
      repo.name,
    );
    if (!ownedInApp && !hasGithubAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get queued push items
    const queued = await queryConvex<PushQueueItem[]>(F.queries.pushQueueListByRepo, {
      repoId: body.repoId as never,
    });

    // Determine branch and filter queue items
    const effectiveBranch = body.branch || repo.defaultBranch;
    let branchFiltered = queued.filter((item) =>
      item.branch === effectiveBranch || (!item.branch && effectiveBranch === repo.defaultBranch),
    );

    // If specific paths requested, filter to only those
    if (body.paths && body.paths.length > 0) {
      const pathSet = new Set(body.paths);
      branchFiltered = branchFiltered.filter((item) => pathSet.has(item.path));
    }

    if (branchFiltered.length === 0) {
      return NextResponse.json({ pushed: 0, commitSha: null });
    }

    // Fetch current HEAD to get parent commit and base tree
    const tree = await fetchMdTree(
      ghInstallationId,
      repo.owner,
      repo.name,
      effectiveBranch,
    );

    // Deduplicate: keep latest content per path, tracking deletions
    const fileMap = new Map<string, { content: string; isDelete: boolean }>();
    for (const item of branchFiltered) {
      fileMap.set(item.path, { content: item.newContent, isDelete: Boolean(item.isDelete) });
    }

    const files = Array.from(fileMap.entries()).map(([path, entry]) => ({
      path,
      content: entry.content,
      deleted: entry.isDelete,
    }));
    const updates = files.filter((f) => !f.deleted);
    const deletions = files.filter((f) => f.deleted);
    let message: string;
    if (body.message && body.message.trim()) {
      message = body.message.trim();
    } else if (updates.length === 0 && deletions.length === 1) {
      message = `Delete ${deletions[0]!.path} via with.md`;
    } else if (deletions.length === 0 && updates.length === 1) {
      message = `Update ${updates[0]!.path} via with.md`;
    } else {
      const parts: string[] = [];
      if (updates.length > 0) parts.push(`update ${updates.length} file${updates.length > 1 ? 's' : ''}`);
      if (deletions.length > 0) parts.push(`delete ${deletions.length} file${deletions.length > 1 ? 's' : ''}`);
      const joined = parts.join(', ');
      message = `${joined.charAt(0).toUpperCase()}${joined.slice(1)} via with.md`;
    }

    // Create the commit
    const { commitSha } = await createCommitWithFiles(
      ghInstallationId,
      repo.owner,
      repo.name,
      effectiveBranch,
      tree.commitSha,
      tree.treeSha,
      files,
      message,
    );

    // Mark each push queue item as pushed
    for (const item of branchFiltered) {
      await mutateConvex(F.mutations.pushQueueMarkPushed, {
        pushQueueId: item._id as never,
        commitSha,
      });
    }

    // Update repo sync status
    await mutateConvex(F.mutations.reposUpdateSyncStatus, {
      repoId: body.repoId as never,
      syncStatus: 'ready',
      lastSyncedCommitSha: commitSha,
    });

    // Create activity
    const pushParts: string[] = [];
    if (updates.length > 0) pushParts.push(`${updates.length} updated`);
    if (deletions.length > 0) pushParts.push(`${deletions.length} deleted`);
    const pushSummary = pushParts.length > 0
      ? `Pushed ${files.length} file${files.length > 1 ? 's' : ''} (${pushParts.join(', ')}) to ${repo.owner}/${repo.name}`
      : `Pushed ${files.length} file${files.length > 1 ? 's' : ''} to ${repo.owner}/${repo.name}`;
    await mutateConvex(F.mutations.activitiesCreate, {
      repoId: body.repoId as never,
      actorId: session.githubLogin,
      type: 'push_completed',
      summary: pushSummary,
    });

    return NextResponse.json({ pushed: files.length, commitSha });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('401')) {
      return NextResponse.json(
        { error: 'GitHub token expired', code: 'github_token_expired' },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
