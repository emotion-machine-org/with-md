import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex } from '@/lib/with-md/convex-client';
import { getSession } from '@/lib/with-md/session';

/**
 * Exchange a GitHub access token for a with.md session.
 * Used by the VSCode extension to authenticate without a browser popup —
 * the extension gets a GitHub token from VSCode's built-in auth provider
 * and the embed page sends it here to create a session cookie.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { githubToken?: string } | null;
  const githubToken = body?.githubToken;

  if (!githubToken || typeof githubToken !== 'string') {
    return NextResponse.json({ error: 'Missing githubToken' }, { status: 400 });
  }

  // Validate the token by fetching the GitHub user
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${githubToken}` },
  });

  if (!userRes.ok) {
    return NextResponse.json({ error: 'Invalid GitHub token' }, { status: 401 });
  }

  const ghUser = (await userRes.json()) as {
    id: number;
    login: string;
    avatar_url: string;
    email: string | null;
  };

  // Upsert user in Convex
  const userId = await mutateConvex<string>(F.mutations.usersUpsertFromGithub, {
    githubUserId: ghUser.id,
    githubLogin: ghUser.login,
    avatarUrl: ghUser.avatar_url,
    email: ghUser.email ?? undefined,
  });

  // Create session
  const session = await getSession();
  session.userId = userId;
  session.githubUserId = ghUser.id;
  session.githubLogin = ghUser.login;
  session.githubToken = githubToken;
  session.avatarUrl = ghUser.avatar_url;
  await session.save();

  return NextResponse.json({
    ok: true,
    login: ghUser.login,
    avatarUrl: ghUser.avatar_url,
  });
}
