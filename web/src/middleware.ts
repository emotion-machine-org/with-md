import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const sessionCookie = req.cookies.get('withmd-session');

  if (!sessionCookie) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/with-md/:path*'],
};
