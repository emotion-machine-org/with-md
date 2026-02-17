import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex, queryConvex } from '@/lib/with-md/convex-client';
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
}

interface PushQueueItem {
  _id: string;
  path: string;
  branch?: string;
  newContent: string;
  status: string;
}

export async function POST(req: NextRequest) {
  const session = await getSessionOrNull();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as { repoId: string; branch?: string };

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

    // Get queued push items
    const queued = await queryConvex<PushQueueItem[]>(F.queries.pushQueueListByRepo, {
      repoId: body.repoId as never,
    });

    // Determine branch and filter queue items
    const effectiveBranch = body.branch || repo.defaultBranch;
    const branchFiltered = queued.filter((item) =>
      item.branch === effectiveBranch || (!item.branch && effectiveBranch === repo.defaultBranch),
    );

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

    // Deduplicate: keep latest content per path
    const fileMap = new Map<string, string>();
    for (const item of branchFiltered) {
      fileMap.set(item.path, item.newContent);
    }

    const files = Array.from(fileMap.entries()).map(([path, content]) => ({ path, content }));
    const message =
      files.length === 1
        ? `Update ${files[0]!.path} via with.md`
        : `Update ${files.length} files via with.md`;

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
    await mutateConvex(F.mutations.activitiesCreate, {
      repoId: body.repoId as never,
      actorId: session.githubLogin,
      type: 'push_completed',
      summary: `Pushed ${files.length} file${files.length > 1 ? 's' : ''} to ${repo.owner}/${repo.name}`,
    });

    return NextResponse.json({ pushed: files.length, commitSha });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
