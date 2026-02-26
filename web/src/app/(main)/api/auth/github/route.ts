import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Missing GITHUB_CLIENT_ID' }, { status: 500 });
  }

  const isPopup = req.nextUrl.searchParams.get('popup') === '1';
  const nonce = crypto.randomUUID();
  // Encode the popup flag into the state so the callback can detect it
  const state = isPopup ? `${nonce}:popup` : nonce;

  const cookieStore = await cookies();
  cookieStore.set('github_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  const host = req.headers.get('host') ?? 'localhost:4040';
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  const redirectUri = `${protocol}://${host}/api/auth/github/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: '',
  });

  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}
