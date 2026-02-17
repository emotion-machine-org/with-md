import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex } from '@/lib/with-md/convex-client';
import { getSessionOrNull } from '@/lib/with-md/session';

const MIN_BG_INDEX = 0;
const MAX_BG_INDEX = 10;

function normalizeBgIndex(value: unknown): number | null {
  if (!Number.isFinite(value)) return null;
  const n = Number(value);
  if (n < MIN_BG_INDEX || n > MAX_BG_INDEX) return null;
  return Math.floor(n);
}

export async function POST(request: NextRequest) {
  const session = await getSessionOrNull();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { bgIndex?: unknown } | null;
  const bgIndex = normalizeBgIndex(body?.bgIndex);
  if (bgIndex == null) {
    return NextResponse.json({ error: 'Invalid bgIndex.' }, { status: 400 });
  }

  await mutateConvex(F.mutations.usersSetBackground, {
    userId: session.userId,
    bgIndex,
  });

  return NextResponse.json({ ok: true, bgIndex });
}
