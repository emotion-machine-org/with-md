'use client';

import { useCallback, useEffect, useState } from 'react';

import RepoPicker from '@/components/with-md/repo-picker';
import WithMdShell from '@/components/with-md/with-md-shell';
import { useAuth } from '@/hooks/with-md/use-auth';
import { getWithMdApi } from '@/lib/with-md/api';

const api = getWithMdApi();

export default function WithMdPage() {
  const { loading: authLoading, user } = useAuth();
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(true);

  // Check if there's already a real (non-seed) synced repo for this user
  useEffect(() => {
    if (authLoading || !user) return;
    let active = true;

    async function check() {
      try {
        const repos = await api.listRepos(user!.userId);
        if (!active) return;
        const realRepos = repos.filter((r) => r.githubRepoId && r.githubRepoId > 0);
        if (realRepos.length > 0) {
          const storedRepoId = localStorage.getItem('withmd-repo');
          const storedRepo = storedRepoId
            ? realRepos.find((r) => r.repoId === storedRepoId)
            : undefined;
          const repoId = storedRepo ? storedRepo.repoId : realRepos[0].repoId;
          localStorage.setItem('withmd-repo', repoId);
          setSelectedRepoId(repoId);
        }
      } catch {
        // No existing repos, show picker
      } finally {
        if (!active) return;
        setCheckingExisting(false);
      }
    }

    void check();

    return () => {
      active = false;
    };
  }, [authLoading, user]);

  const handleRepoSelect = useCallback((result: { repoId: string }) => {
    localStorage.setItem('withmd-repo', result.repoId);
    setSelectedRepoId(result.repoId);
  }, []);

  if (authLoading || checkingExisting) {
    return (
      <main className="withmd-bg withmd-page withmd-initial-picker-center">
        <div className="withmd-repo-picker-panel">
          <div className="withmd-repo-picker-loading">
            <div className="withmd-repo-picker-spinner" />
            <p className="withmd-muted-sm">Loading...</p>
          </div>
        </div>
      </main>
    );
  }

  if (!selectedRepoId) {
    return (
      <main className="withmd-bg withmd-page withmd-initial-picker-center">
        <RepoPicker onSelect={handleRepoSelect} />
      </main>
    );
  }

  return <WithMdShell repoId={selectedRepoId} />;
}
