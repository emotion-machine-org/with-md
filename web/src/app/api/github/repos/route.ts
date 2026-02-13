import { NextResponse } from 'next/server';

import { listInstallationRepos, listUserInstallations } from '@/lib/with-md/github';
import { getSessionOrNull } from '@/lib/with-md/session';

export async function GET() {
  const session = await getSessionOrNull();
  if (!session) {
    console.error('[repos] No session found');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[repos] Fetching installations for user:', session.githubLogin);
    const installations = await listUserInstallations(session.githubToken);
    console.log('[repos] Found installations:', installations.length, installations);

    const allRepos = [];
    for (const inst of installations) {
      console.log('[repos] Fetching repos for installation:', inst.installationId, inst.accountLogin);
      const repos = await listInstallationRepos(inst.installationId);
      console.log('[repos] Found repos:', repos.length);
      allRepos.push(...repos);
    }

    return NextResponse.json(allRepos);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[repos] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
