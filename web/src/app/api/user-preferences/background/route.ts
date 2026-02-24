import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex } from '@/lib/with-md/convex-client';
import { getSession } from '@/lib/with-md/session';

const MIN_BG_INDEX = 0;
const MAX_BG_INDEX = 10;

function normalizeBgIndex(value: unknown): number | null {
  if (!Number.isFinite(value)) return null;
  const n = Number(value);
  if (n < MIN_BG_INDEX || n > MAX_BG_INDEX) return null;
  return Math.floor(n);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { bgIndex?: unknown } | null;
  const bgIndex = normalizeBgIndex(body?.bgIndex);
  if (bgIndex == null) {
    return NextResponse.json({ error: 'Invalid bgIndex.' }, { status: 400 });
  }

  try {
    await mutateConvex(F.mutations.usersSetBackground, {
      userId: session.userId,
      bgIndex,
    });
  } catch (error) {
    // Best-effort self-heal for stale session user IDs, then degrade gracefully.
    try {
      if (typeof session.githubUserId === 'number' && typeof session.githubLogin === 'string') {
        const repairedUserId = await mutateConvex<string>(F.mutations.usersUpsertFromGithub, {
          githubUserId: session.githubUserId,
          githubLogin: session.githubLogin,
          avatarUrl: session.avatarUrl,
        });
        if (repairedUserId !== session.userId) {
          session.userId = repairedUserId;
          await session.save();
        }
        await mutateConvex(F.mutations.usersSetBackground, {
          userId: repairedUserId,
          bgIndex,
        });
        return NextResponse.json({ ok: true, bgIndex });
      }
    } catch (retryError) {
      console.error('user-preferences/background: retry failed', retryError);
    }

    console.error('user-preferences/background: persist failed', error);
    return NextResponse.json({
      ok: false,
      bgIndex,
      warning: 'Background preference could not be persisted.',
    });
  }

  return NextResponse.json({ ok: true, bgIndex });
}
