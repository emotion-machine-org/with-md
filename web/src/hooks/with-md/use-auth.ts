'use client';

import { useCallback, useEffect, useState } from 'react';

interface AuthUser {
  userId: string;
  githubLogin: string;
  avatarUrl?: string;
}

interface AuthState {
  loading: boolean;
  user: AuthUser | null;
  login: () => void;
  logout: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch('/api/auth/me');
        const data = (await res.json()) as {
          authenticated: boolean;
          userId?: string;
          githubLogin?: string;
          avatarUrl?: string;
        };

        if (data.authenticated && data.userId && data.githubLogin) {
          setUser({
            userId: data.userId,
            githubLogin: data.githubLogin,
            avatarUrl: data.avatarUrl,
          });
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    void check();
  }, []);

  const login = useCallback(() => {
    window.location.href = '/api/auth/github';
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    window.location.href = '/';
  }, []);

  return { loading, user, login, logout };
}
