'use client';

import Link from 'next/link';

import { useAuth } from '@/hooks/with-md/use-auth';

export default function Home() {
  const { loading, user, login } = useAuth();

  return (
    <main className="withmd-bg withmd-page">
      <div className="withmd-home-wrap">
        <div className="withmd-panel withmd-home-panel">
          <h1 className="withmd-title">with.md</h1>
          <p className="withmd-muted-sm withmd-mt-3">
            Markdown-native collaboration for humans and agents.
          </p>
          <div className="withmd-mt-6">
            {loading ? (
              <span className="withmd-muted-xs">Loading...</span>
            ) : user ? (
              <Link href="/with-md" className="withmd-btn withmd-btn-primary">
                Open Workspace
              </Link>
            ) : (
              <button type="button" className="withmd-btn withmd-btn-primary" onClick={login}>
                Login with GitHub
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
