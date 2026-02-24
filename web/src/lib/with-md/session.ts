import { getIronSession, type IronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';

export interface SessionData {
  userId: string;
  githubUserId: number;
  githubLogin: string;
  githubToken: string;
  avatarUrl?: string;
}

const DEV_SESSION_SECRET = randomBytes(32).toString('hex');
let hasWarnedAboutMissingSessionSecret = false;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET is required in production');
    }
    if (!hasWarnedAboutMissingSessionSecret) {
      console.warn('SESSION_SECRET is not set; using an ephemeral dev secret for this process.');
      hasWarnedAboutMissingSessionSecret = true;
    }
    return DEV_SESSION_SECRET;
  }

  if (secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }

  return secret;
}

function getSessionOptions() {
  return {
    password: getSessionSecret(),
    cookieName: 'withmd-session',
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
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
