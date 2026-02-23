import { NextRequest, NextResponse } from 'next/server';

import { verifyCollabToken } from '@/lib/with-md/collab-token';
import { F, queryConvex } from '@/lib/with-md/convex-client';
import { getSessionOrNull } from '@/lib/with-md/session';

interface RepoRecord {
  _id: string;
  owner: string;
  name: string;
}

interface MdFileRecord {
  _id: string;
  contentHash: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const owner = searchParams.get('owner');
  const repo = searchParams.get('repo');
  const filePath = searchParams.get('path');

  if (!owner || !repo || !filePath) {
    return NextResponse.json({ error: 'Missing owner, repo, or path' }, { status: 400 });
  }

  // Try session cookie first; fall back to signed auth token in Authorization
  // header.  VSCode webview iframes block third-party cookies, so the session
  // cookie set by the token-exchange endpoint may not be sent.
  let userId: string | undefined;

  const session = await getSessionOrNull();
  if (session) {
    userId = session.userId;
  } else {
    const bearer = req.headers.get('authorization')?.replace('Bearer ', '');
    if (bearer) {
      const result = await verifyCollabToken(bearer);
      if (result) userId = result.userId;
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  try {
    // Find the repo by owner + name
    const repos = await queryConvex<RepoRecord[]>(F.queries.reposList, { userId });
    const matchedRepo = repos.find(
      (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === repo.toLowerCase(),
    );

    if (!matchedRepo) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // Resolve the file by path within the repo
    const mdFile = await queryConvex<MdFileRecord | null>(F.queries.mdFilesResolveByPath, {
      repoId: matchedRepo._id,
      path: filePath,
    });

    if (!mdFile) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({ repoId: matchedRepo._id, mdFileId: mdFile._id, contentHash: mdFile.contentHash });
  } catch (err) {
    console.error('[api/open] Error resolving repo file:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
