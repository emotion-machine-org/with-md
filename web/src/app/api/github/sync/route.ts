import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex } from '@/lib/with-md/convex-client';
import { fetchBlobContent, fetchMdTree } from '@/lib/with-md/github';
import { getSessionOrNull } from '@/lib/with-md/session';

function categorizeFile(path: string): string {
  const lower = path.toLowerCase();
  const name = lower.split('/').pop() ?? '';
  if (name === 'readme.md') return 'readme';
  if (name.includes('prompt')) return 'prompt';
  if (name.includes('agent')) return 'agent';
  if (name.includes('claude') || name.includes('.cursorrules')) return 'claude';
  if (lower.startsWith('docs/') || lower.startsWith('doc/')) return 'docs';
  return 'other';
}

export async function POST(req: NextRequest) {
  const session = await getSessionOrNull();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as {
    installationId: number;
    owner: string;
    repo: string;
    defaultBranch: string;
    githubRepoId: number;
    accountLogin?: string;
    accountType?: string;
  };

  try {
    // Upsert installation
    const installationId = await mutateConvex<string>(F.mutations.installationsUpsert, {
      githubInstallationId: body.installationId,
      githubAccountLogin: body.accountLogin ?? body.owner,
      githubAccountType: body.accountType ?? 'User',
    });

    // Upsert repo
    const repoId = await mutateConvex<string>(F.mutations.reposUpsertFromGithub, {
      installationId: installationId as never,
      githubRepoId: body.githubRepoId,
      owner: body.owner,
      name: body.repo,
      defaultBranch: body.defaultBranch,
    });

    // Update sync status to syncing
    await mutateConvex(F.mutations.reposUpdateSyncStatus, {
      repoId: repoId as never,
      syncStatus: 'syncing',
    });

    // Fetch .md tree from GitHub
    const tree = await fetchMdTree(body.installationId, body.owner, body.repo, body.defaultBranch);

    // Fetch blob contents in batches of 10
    const BATCH_SIZE = 10;
    let filesCount = 0;

    for (let i = 0; i < tree.files.length; i += BATCH_SIZE) {
      const batch = tree.files.slice(i, i + BATCH_SIZE);
      const contents = await Promise.all(
        batch.map((f) => fetchBlobContent(body.installationId, body.owner, body.repo, f.sha)),
      );

      for (let j = 0; j < batch.length; j++) {
        const file = batch[j]!;
        const content = contents[j]!;

        await mutateConvex(F.mutations.mdFilesUpsertFromSync, {
          repoId: repoId as never,
          path: file.path,
          content,
          githubSha: file.sha,
          fileCategory: categorizeFile(file.path),
          sizeBytes: file.size,
        });
        filesCount++;
      }
    }

    // Mark files not in tree as deleted
    const existingPaths = tree.files.map((f) => f.path);
    const missingResult = await mutateConvex<{
      deletedCount?: number;
      preservedQueuedCount?: number;
      preservedLocalOnlyCount?: number;
    }>(F.mutations.mdFilesMarkMissingAsDeleted, {
      repoId: repoId as never,
      existingPaths,
    });

    // Update sync status
    await mutateConvex(F.mutations.reposUpdateSyncStatus, {
      repoId: repoId as never,
      syncStatus: 'ready',
      lastSyncedCommitSha: tree.commitSha,
    });

    // Create activity
    await mutateConvex(F.mutations.activitiesCreate, {
      repoId: repoId as never,
      actorId: session.githubLogin,
      type: 'sync_completed',
      summary: [
        `Synced ${filesCount} .md files from ${body.owner}/${body.repo}`,
        `(deleted ${missingResult.deletedCount ?? 0},`,
        `kept local ${missingResult.preservedQueuedCount ?? 0} queued + ${missingResult.preservedLocalOnlyCount ?? 0} local-only).`,
      ].join(' '),
    });

    return NextResponse.json({
      repoId,
      filesCount,
      commitSha: tree.commitSha,
      deletedCount: missingResult.deletedCount ?? 0,
      preservedQueuedCount: missingResult.preservedQueuedCount ?? 0,
      preservedLocalOnlyCount: missingResult.preservedLocalOnlyCount ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
