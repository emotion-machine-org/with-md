import { NextRequest, NextResponse } from 'next/server';

import { canAccessRepoInInstallation } from '@/lib/with-md/github-access';
import { getRepoInstallationId, listBranches } from '@/lib/with-md/github';
import { getSessionOrNull } from '@/lib/with-md/session';

export async function GET(req: NextRequest) {
  const session = await getSessionOrNull();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const installationId = Number(searchParams.get('installationId'));
  const owner = searchParams.get('owner');
  const repo = searchParams.get('repo');
  const defaultBranch = searchParams.get('defaultBranch');

  if (!owner || !repo || !defaultBranch) {
    return NextResponse.json(
      { error: 'Missing required query params: owner, repo, defaultBranch' },
      { status: 400 },
    );
  }

  try {
    // Try with client-provided installationId first; if stale, resolve fresh from GitHub
    let effectiveId = installationId;
    if (effectiveId) {
      try {
        const hasAccess = await canAccessRepoInInstallation(
          session.githubToken,
          effectiveId,
          owner,
          repo,
        );
        if (!hasAccess) {
          throw new Error('stale_or_forbidden_installation');
        }
        const branches = await listBranches(effectiveId, owner, repo, defaultBranch);
        return NextResponse.json(branches);
      } catch {
        // Stale installation ID – fall through to resolve fresh
      }
    }

    effectiveId = await getRepoInstallationId(owner, repo);
    const hasAccess = await canAccessRepoInInstallation(
      session.githubToken,
      effectiveId,
      owner,
      repo,
    );
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const branches = await listBranches(effectiveId, owner, repo, defaultBranch);
    return NextResponse.json(branches);
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
