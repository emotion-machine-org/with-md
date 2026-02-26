import { NextResponse } from 'next/server';

import { getSession } from '@/lib/with-md/session';

export async function POST() {
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}
