'use client';

import { useEffect, useRef, useState } from 'react';

import type { BranchInfo } from '@/lib/with-md/github';
import { handleGitHubResponse } from '@/lib/with-md/github-fetch';

interface Props {
  installationId: number;
  owner: string;
  repo: string;
  defaultBranch: string;
  currentBranch: string;
  onSwitch: (branchName: string) => void;
  onClose: () => void;
}

export default function BranchSwitcher({
  installationId,
  owner,
  repo,
  defaultBranch,
  currentBranch,
  onSwitch,
  onClose,
}: Props) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const params = new URLSearchParams({
          installationId: String(installationId),
          owner,
          repo,
          defaultBranch,
        });
        const res = await fetch(`/api/github/branches?${params}`);
        handleGitHubResponse(res);
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? 'Failed to load branches');
        }
        const data = (await res.json()) as BranchInfo[];
        if (!active) return;
        setBranches(data);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load branches');
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, [installationId, owner, repo, defaultBranch]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      onClose();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div ref={containerRef} className="withmd-branch-dropdown">
      <div className="withmd-branch-dropdown-header">
        <span className="withmd-muted-xs">Switch branch</span>
      </div>
      {loading ? (
        <div className="withmd-branch-dropdown-loading">
          <div className="withmd-repo-picker-spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
          <span className="withmd-muted-xs">Loading...</span>
        </div>
      ) : error ? (
        <div className="withmd-branch-dropdown-loading">
          <span className="withmd-warning" style={{ fontSize: 12 }}>{error}</span>
        </div>
      ) : (
        <div className="withmd-branch-dropdown-list">
          {branches.map((branch) => {
            const isCurrent = branch.name === currentBranch;
            return (
              <button
                key={branch.name}
                type="button"
                className={`withmd-branch-dropdown-item ${isCurrent ? 'is-current' : ''}`}
                onClick={() => {
                  if (!isCurrent) onSwitch(branch.name);
                  onClose();
                }}
              >
                <span className="withmd-branch-dropdown-check">
                  {isCurrent && (
                    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                      <path d="M2 6l3 3 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="withmd-branch-dropdown-name">{branch.name}</span>
                {branch.isDefault && (
                  <span className="withmd-branch-default-badge">default</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
