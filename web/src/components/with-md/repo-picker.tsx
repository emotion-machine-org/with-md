'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { RepoInfo } from '@/lib/with-md/github';

interface Props {
  onSelect: (result: { repoId: string; owner: string; name: string }) => void;
}

export default function RepoPicker({ onSelect }: Props) {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      try {
        const res = await fetch('/api/github/repos', { signal: controller.signal });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? `Failed to load repos (${res.status})`);
        }
        const data = (await res.json()) as RepoInfo[];
        if (!active) return;
        setRepos(data);
      } catch (err) {
        if (!active) return;
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load repos');
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const handleSelect = useCallback(
    async (repo: RepoInfo) => {
      setSyncing(repo.fullName);
      setError(null);

      try {
        const res = await fetch('/api/github/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            installationId: repo.installationId,
            owner: repo.owner,
            repo: repo.name,
            defaultBranch: repo.defaultBranch,
            githubRepoId: repo.githubRepoId,
          }),
        });

        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? 'Sync failed');
        }

        const data = (await res.json()) as { repoId: string };
        onSelect({ repoId: data.repoId, owner: repo.owner, name: repo.name });
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Sync failed');
        setSyncing(null);
      }
    },
    [onSelect],
  );

  if (loading) {
    return (
      <div className="withmd-repo-picker-panel">
        <div className="withmd-repo-picker-loading">
          <div className="withmd-repo-picker-spinner" />
          <p className="withmd-muted-sm">Loading repositories...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="withmd-repo-picker-panel">
      <h2 className="withmd-sidebar-title">Select a repository</h2>
      <p className="withmd-muted-sm withmd-mt-2">
        Choose a repo to sync its .md files into with.md
      </p>

      {error && (
        <p className="withmd-warning withmd-mt-3">{error}</p>
      )}

      {repos.length === 0 ? (
        <div className="withmd-mt-6">
          <p className="withmd-muted-sm">
            No repositories found. Make sure the GitHub App is installed on at least one repo.
          </p>
          <div className="withmd-mt-3">
            <a
              href="https://github.com/apps/with-md/installations/new"
              target="_blank"
              rel="noopener noreferrer"
              className="withmd-btn withmd-btn-primary"
            >
              Install GitHub App
            </a>
          </div>
        </div>
      ) : (
        <div className="withmd-repo-picker-list">
          {repos.map((repo) => {
            const isSyncing = syncing === repo.fullName;
            return (
              <button
                key={repo.githubRepoId}
                type="button"
                className="withmd-repo-row"
                disabled={syncing !== null}
                onClick={() => void handleSelect(repo)}
                style={{
                  opacity: syncing && !isSyncing ? 0.4 : 1,
                  cursor: syncing ? 'wait' : 'pointer',
                }}
              >
                <span className="withmd-repo-name">{repo.fullName}</span>
                {repo.isPrivate && (
                  <span className="withmd-repo-badge">private</span>
                )}
                {isSyncing && (
                  <span className="withmd-muted-xs" style={{ marginLeft: 'auto' }}>
                    Syncing...
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
