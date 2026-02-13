import { getIronSession, type IronSession } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  userId: string;
  githubUserId: number;
  githubLogin: string;
  githubToken: string;
  avatarUrl?: string;
}

const SESSION_OPTIONS = {
  password: process.env.SESSION_SECRET ?? 'fallback-dev-secret-must-be-32-chars!!',
  cookieName: 'withmd-session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS);
}

export async function getSessionOrNull(): Promise<SessionData | null> {
  const session = await getSession();
  if (!session.userId) return null;
  return {
    userId: session.userId,
    githubUserId: session.githubUserId,
    githubLogin: session.githubLogin,
    githubToken: session.githubToken,
    avatarUrl: session.avatarUrl,
  };
}
