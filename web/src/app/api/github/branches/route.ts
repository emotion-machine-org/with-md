import { NextRequest, NextResponse } from 'next/server';

import { listBranches } from '@/lib/with-md/github';
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

  if (!installationId || !owner || !repo || !defaultBranch) {
    return NextResponse.json(
      { error: 'Missing required query params: installationId, owner, repo, defaultBranch' },
      { status: 400 },
    );
  }

  try {
    const branches = await listBranches(installationId, owner, repo, defaultBranch);
    return NextResponse.json(branches);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
