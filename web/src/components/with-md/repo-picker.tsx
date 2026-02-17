'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { BranchInfo } from '@/lib/with-md/github';
import type { RepoInfo } from '@/lib/with-md/github';

interface Props {
  onSelect: (result: { repoId: string; owner: string; name: string }) => void;
}

export default function RepoPicker({ onSelect }: Props) {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRepo, setExpandedRepo] = useState<RepoInfo | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
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

  const handleRepoClick = useCallback(
    async (repo: RepoInfo) => {
      if (expandedRepo?.githubRepoId === repo.githubRepoId) {
        setExpandedRepo(null);
        setBranches([]);
        return;
      }

      setExpandedRepo(repo);
      setBranches([]);
      setLoadingBranches(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          installationId: String(repo.installationId),
          owner: repo.owner,
          repo: repo.name,
          defaultBranch: repo.defaultBranch,
        });
        const res = await fetch(`/api/github/branches?${params}`);
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? 'Failed to load branches');
        }
        const data = (await res.json()) as BranchInfo[];
        if (!mountedRef.current) return;
        setBranches(data);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load branches');
      } finally {
        if (!mountedRef.current) return;
        setLoadingBranches(false);
      }
    },
    [expandedRepo],
  );

  const handleSelectBranch = useCallback(
    async (repo: RepoInfo, branchName: string) => {
      setSyncing(repo.fullName);
      setError(null);

      try {
        const activeBranch = branchName === repo.defaultBranch ? undefined : branchName;
        const res = await fetch('/api/github/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            installationId: repo.installationId,
            owner: repo.owner,
            repo: repo.name,
            defaultBranch: repo.defaultBranch,
            githubRepoId: repo.githubRepoId,
            activeBranch,
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
        Choose a repo and branch to sync its .md files into with.md
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
        <>
          <div className="withmd-repo-picker-list">
            {repos.map((repo) => {
              const isSyncing = syncing === repo.fullName;
              const isExpanded = expandedRepo?.githubRepoId === repo.githubRepoId;
              return (
                <div key={repo.githubRepoId}>
                  <button
                    type="button"
                    className={`withmd-repo-row ${isExpanded ? 'withmd-repo-row-expanded' : ''}`}
                    disabled={syncing !== null}
                    onClick={() => void handleRepoClick(repo)}
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
                    <span
                      className={`withmd-branch-picker-chevron ${isExpanded ? 'is-open' : ''}`}
                      style={{ marginLeft: isSyncing ? '0' : 'auto' }}
                    >
                      <svg viewBox="0 0 12 12" aria-hidden="true" width="10" height="10">
                        <path d="M4 2.5L8 6L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="withmd-branch-picker">
                      {loadingBranches ? (
                        <div className="withmd-branch-picker-loading">
                          <div className="withmd-repo-picker-spinner" style={{ width: 16, height: 16, borderWidth: 1.5 }} />
                          <span className="withmd-muted-xs">Loading branches...</span>
                        </div>
                      ) : (
                        <div className="withmd-branch-list">
                          {branches.map((branch) => (
                            <button
                              key={branch.name}
                              type="button"
                              className="withmd-branch-row"
                              disabled={syncing !== null}
                              onClick={() => void handleSelectBranch(repo, branch.name)}
                            >
                              <BranchIcon />
                              <span className="withmd-branch-row-name">{branch.name}</span>
                              {branch.isDefault && (
                                <span className="withmd-branch-default-badge">default</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="withmd-repo-picker-footer">
            <a
              href="https://github.com/apps/with-md/installations/new"
              target="_blank"
              rel="noopener noreferrer"
              className="withmd-btn withmd-btn-green"
            >
              Missing repos?
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function BranchIcon() {
  return (
    <svg className="withmd-branch-icon" viewBox="0 0 16 16" aria-hidden="true" width="14" height="14">
      <path
        d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z"
        fill="currentColor"
      />
    </svg>
  );
}
