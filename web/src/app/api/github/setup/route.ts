import { NextRequest, NextResponse } from 'next/server';

import { getSessionOrNull } from '@/lib/with-md/session';

/**
 * GitHub App post-installation redirect.
 * GitHub sends users here after they install (or update) the app,
 * with ?installation_id=…&setup_action=install|update.
 *
 * If the user already has a session we drop them straight into the app;
 * otherwise we kick off the OAuth login flow first.
 */
export async function GET(req: NextRequest) {
  const host = req.headers.get('host') ?? 'localhost:4040';
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  const origin = `${protocol}://${host}`;

  const session = await getSessionOrNull();
  if (session) {
    return NextResponse.redirect(`${origin}/workspace`);
  }

  // Not logged in yet — send through OAuth, which redirects to /workspace on success.
  return NextResponse.redirect(`${origin}/api/auth/github`);
}
