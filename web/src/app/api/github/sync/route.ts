import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex } from '@/lib/with-md/convex-client';
import { canAccessRepoInInstallation } from '@/lib/with-md/github-access';
import { fetchBlobContent, fetchMdTree, getInstallationToken, getRepoInstallationId } from '@/lib/with-md/github';
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
    activeBranch?: string;
    forcePaths?: string[];
  };

  const isForceSync = Array.isArray(body.forcePaths) && body.forcePaths.length > 0;

  try {
    // Validate the provided installationId; resolve fresh from GitHub if stale
    let ghInstallationId = body.installationId;
    if (ghInstallationId) {
      try {
        await getInstallationToken(ghInstallationId);
      } catch {
        ghInstallationId = await getRepoInstallationId(body.owner, body.repo);
      }
    } else {
      ghInstallationId = await getRepoInstallationId(body.owner, body.repo);
    }

    const hasGithubAccess = await canAccessRepoInInstallation(
      session.githubToken,
      ghInstallationId,
      body.owner,
      body.repo,
    );
    if (!hasGithubAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Upsert installation
    const installationId = await mutateConvex<string>(F.mutations.installationsUpsert, {
      githubInstallationId: ghInstallationId,
      githubAccountLogin: body.accountLogin ?? body.owner,
      githubAccountType: body.accountType ?? 'User',
      connectedBy: session.userId,
    });

    // Upsert repo
    const repoId = await mutateConvex<string>(F.mutations.reposUpsertFromGithub, {
      installationId: installationId as never,
      githubRepoId: body.githubRepoId,
      owner: body.owner,
      name: body.repo,
      defaultBranch: body.defaultBranch,
      activeBranch: body.activeBranch,
    });

    const effectiveBranch = body.activeBranch || body.defaultBranch;

    // Fetch .md tree from GitHub
    const tree = await fetchMdTree(ghInstallationId, body.owner, body.repo, effectiveBranch);

    // Force sync: only process the requested paths
    if (isForceSync) {
      const forceSet = new Set(body.forcePaths);
      const forceFiles = tree.files.filter((f) => forceSet.has(f.path));

      const BATCH_SIZE = 10;
      for (let i = 0; i < forceFiles.length; i += BATCH_SIZE) {
        const batch = forceFiles.slice(i, i + BATCH_SIZE);
        const contents = await Promise.all(
          batch.map((f) => fetchBlobContent(ghInstallationId, body.owner, body.repo, f.sha)),
        );
        for (let j = 0; j < batch.length; j++) {
          const file = batch[j]!;
          const content = contents[j]!;
          await mutateConvex(F.mutations.mdFilesUpsertFromSync, {
            repoId: repoId as never,
            path: file.path,
            branch: effectiveBranch,
            content,
            githubSha: file.sha,
            fileCategory: categorizeFile(file.path),
            sizeBytes: file.size,
            force: true,
          });
        }
      }

      return NextResponse.json({
        repoId,
        filesCount: forceFiles.length,
        skippedPaths: [],
      });
    }

    // Normal sync: update sync status
    await mutateConvex(F.mutations.reposUpdateSyncStatus, {
      repoId: repoId as never,
      syncStatus: 'syncing',
    });

    // Fetch blob contents in batches of 10
    const BATCH_SIZE = 10;
    let filesCount = 0;
    const skippedPaths: string[] = [];

    for (let i = 0; i < tree.files.length; i += BATCH_SIZE) {
      const batch = tree.files.slice(i, i + BATCH_SIZE);
      const contents = await Promise.all(
        batch.map((f) => fetchBlobContent(ghInstallationId, body.owner, body.repo, f.sha)),
      );

      for (let j = 0; j < batch.length; j++) {
        const file = batch[j]!;
        const content = contents[j]!;

        const result = await mutateConvex<{ id: string; skipped: boolean }>(F.mutations.mdFilesUpsertFromSync, {
          repoId: repoId as never,
          path: file.path,
          branch: effectiveBranch,
          content,
          githubSha: file.sha,
          fileCategory: categorizeFile(file.path),
          sizeBytes: file.size,
        });
        if (result.skipped) {
          skippedPaths.push(file.path);
        } else {
          filesCount++;
        }
      }
    }

    // Mark files not in tree as deleted
    const existingPaths = tree.files.map((f) => f.path);
    const missingResult = await mutateConvex<{
      deletedCount?: number;
      cancelledQueueCount?: number;
      preservedLocalOnlyCount?: number;
    }>(F.mutations.mdFilesMarkMissingAsDeleted, {
      repoId: repoId as never,
      branch: effectiveBranch,
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
        `Synced ${filesCount} .md files from ${body.owner}/${body.repo}@${effectiveBranch}`,
        `(deleted ${missingResult.deletedCount ?? 0},`,
        `cancelled ${missingResult.cancelledQueueCount ?? 0} queued + ${missingResult.preservedLocalOnlyCount ?? 0} local-only).`,
      ].join(' '),
    });

    return NextResponse.json({
      repoId,
      filesCount,
      commitSha: tree.commitSha,
      deletedCount: missingResult.deletedCount ?? 0,
      cancelledQueueCount: missingResult.cancelledQueueCount ?? 0,
      preservedLocalOnlyCount: missingResult.preservedLocalOnlyCount ?? 0,
      skippedPaths,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('forbidden_installation_owner_mismatch')) {
      return NextResponse.json(
        { error: 'Installation is already linked to another user.', code: 'installation_owner_mismatch' },
        { status: 403 },
      );
    }
    if (message.includes('401')) {
      return NextResponse.json(
        { error: 'GitHub token expired', code: 'github_token_expired' },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
