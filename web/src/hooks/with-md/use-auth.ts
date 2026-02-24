'use client';

import { useCallback, useEffect, useState } from 'react';

interface AuthUser {
  userId: string;
  githubLogin: string;
  avatarUrl?: string;
  bgIndex?: number | null;
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
          bgIndex?: number | null;
        };

        if (!active) return;
        if (data.authenticated && data.userId && data.githubLogin) {
          const isValidBg = Number.isFinite(data.bgIndex)
            && typeof data.bgIndex === 'number'
            && data.bgIndex >= 0
            && data.bgIndex <= 10;
          if (isValidBg) {
            const bg = String(Math.floor(data.bgIndex as number));
            document.documentElement.setAttribute('data-bg', bg);
            try {
              window.localStorage.setItem('withmd-bg', bg);
            } catch {
              // noop
            }
          } else {
            // Preserve current local background when user has no server preference yet,
            // then promote that local value to server once after login.
            try {
              const raw = window.localStorage.getItem('withmd-bg');
              const localBg = raw == null ? NaN : Number.parseInt(raw, 10);
              if (Number.isFinite(localBg) && localBg >= 0 && localBg <= 10) {
                void fetch('/api/user-preferences/background', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ bgIndex: localBg }),
                  keepalive: true,
                });
              }
            } catch {
              // noop
            }
          }

          setUser({
            userId: data.userId,
            githubLogin: data.githubLogin,
            avatarUrl: data.avatarUrl,
            bgIndex: data.bgIndex ?? null,
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
