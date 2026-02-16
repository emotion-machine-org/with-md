'use client';

import { useCallback, useEffect, useState } from 'react';

import RepoPicker from '@/components/with-md/repo-picker';
import WithMdShell from '@/components/with-md/with-md-shell';
import { useAuth } from '@/hooks/with-md/use-auth';
import { getWithMdApi } from '@/lib/with-md/api';

const api = getWithMdApi();

export default function WithMdPage() {
  const { loading: authLoading } = useAuth();
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(true);

  // Check if there's already a real (non-seed) synced repo
  useEffect(() => {
    let active = true;

    async function check() {
      try {
        const repos = await api.listRepos();
        if (!active) return;
        // Only auto-select repos that came from a real GitHub sync (githubRepoId > 0)
        const realRepo = repos.find((r) => r.githubRepoId && r.githubRepoId > 0);
        if (realRepo) {
          setSelectedRepoId(realRepo.repoId);
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
  }, []);

  const handleRepoSelect = useCallback((result: { repoId: string }) => {
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
