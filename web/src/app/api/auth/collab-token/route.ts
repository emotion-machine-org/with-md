import { NextResponse } from 'next/server';

import { signCollabToken } from '@/lib/with-md/collab-token';
import { getSessionOrNull } from '@/lib/with-md/session';

export async function POST() {
  const session = await getSessionOrNull();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = await signCollabToken(session.userId);
  return NextResponse.json({ token });
}
