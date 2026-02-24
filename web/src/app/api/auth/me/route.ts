import { NextResponse } from 'next/server';

import { F, queryConvex } from '@/lib/with-md/convex-client';
import { getSessionOrNull } from '@/lib/with-md/session';

export async function GET() {
  const session = await getSessionOrNull();

  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  let bgIndex: number | null = null;
  try {
    const user = await queryConvex<{
      _id: string;
      bgIndex?: number;
    } | null>(F.queries.usersGet, {
      userId: session.userId,
    });
    bgIndex = typeof user?.bgIndex === 'number' ? user.bgIndex : null;
  } catch {
    bgIndex = null;
  }

  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    githubLogin: session.githubLogin,
    avatarUrl: session.avatarUrl,
    bgIndex,
  });
}
