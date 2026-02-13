import { NextResponse } from 'next/server';

import { getSessionOrNull } from '@/lib/with-md/session';

export async function GET() {
  const session = await getSessionOrNull();

  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    githubLogin: session.githubLogin,
    avatarUrl: session.avatarUrl,
  });
}
