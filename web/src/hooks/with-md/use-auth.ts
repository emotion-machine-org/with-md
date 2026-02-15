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
    const controller = new AbortController();
    let active = true;

    async function check() {
      try {
        const res = await fetch('/api/auth/me', { signal: controller.signal });
        const data = (await res.json()) as {
          authenticated: boolean;
          userId?: string;
          githubLogin?: string;
          avatarUrl?: string;
        };

        if (!active) return;
        if (data.authenticated && data.userId && data.githubLogin) {
          setUser({
            userId: data.userId,
            githubLogin: data.githubLogin,
            avatarUrl: data.avatarUrl,
          });
        } else {
          setUser(null);
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setUser(null);
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }

    void check();

    return () => {
      active = false;
      controller.abort();
    };
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
