import { NextRequest, NextResponse } from 'next/server';

import { F, queryConvex } from '@/lib/with-md/convex-client';
import { canAccessRepoInInstallation } from '@/lib/with-md/github-access';
import { fetchBlobContent, getInstallationToken, getRepoInstallationId } from '@/lib/with-md/github';
import { getSessionOrNull } from '@/lib/with-md/session';

interface RepoDoc {
  _id: string;
  installationId: string;
  githubRepoId: number;
  owner: string;
  name: string;
  defaultBranch: string;
}

interface InstallationDoc {
  _id: string;
  githubInstallationId: number;
  connectedBy?: string;
}

interface GithubShaResult {
  lastGithubSha: string;
  repoId: string;
}

export async function POST(req: NextRequest) {
  const session = await getSessionOrNull();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as { mdFileId: string };

  try {
    const shaResult = await queryConvex<GithubShaResult | null>(F.queries.mdFilesGetGithubSha, {
      mdFileId: body.mdFileId as never,
    });
    if (!shaResult) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const { lastGithubSha, repoId } = shaResult;

    if (!lastGithubSha || lastGithubSha.startsWith('local_') || lastGithubSha === 'seed') {
      return NextResponse.json({ error: 'No GitHub version', code: 'NO_GITHUB_VERSION' }, { status: 404 });
    }

    const repo = await queryConvex<RepoDoc | null>(F.queries.reposGet, {
      repoId: repoId as never,
    });
    if (!repo) {
      return NextResponse.json({ error: 'Repo not found' }, { status: 404 });
    }

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

    const content = await fetchBlobContent(ghInstallationId, repo.owner, repo.name, lastGithubSha);
    return NextResponse.json({ content, sha: lastGithubSha });
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
