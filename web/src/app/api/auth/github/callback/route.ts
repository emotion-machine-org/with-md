import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex } from '@/lib/with-md/convex-client';
import { getSession } from '@/lib/with-md/session';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
  }

  // Validate state
  const cookieStore = await cookies();
  const savedState = cookieStore.get('github_oauth_state')?.value;
  cookieStore.delete('github_oauth_state');

  if (state !== savedState) {
    return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 });
  }

  // Exchange code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 });
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    return NextResponse.json({ error: tokenData.error ?? 'No access token' }, { status: 400 });
  }

  // Fetch GitHub user
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch GitHub user' }, { status: 500 });
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

  // Save session
  const session = await getSession();
  session.userId = userId;
  session.githubUserId = ghUser.id;
  session.githubLogin = ghUser.login;
  session.githubToken = tokenData.access_token;
  session.avatarUrl = ghUser.avatar_url;
  await session.save();

  // Redirect to workspace — use Host header since req.nextUrl.origin can reflect
  // the bind address (0.0.0.0) rather than the actual hostname the user is on
  const host = req.headers.get('host') ?? 'localhost:4040';
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  return NextResponse.redirect(`${protocol}://${host}/workspace`);
}
