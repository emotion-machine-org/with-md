'use client';

import { useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Snapshot } from '@/lib/web-to-md/resolve';
import type { SnapshotVersion } from '@/app/api/web-to-md/versions/route';

interface Props {
  snapshot: Snapshot;
}

function formatAge(ms: number): string {
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'light' ? 'dark' : 'light');
  try { localStorage.setItem('withmd-theme', current === 'light' ? 'dark' : 'light'); } catch { /* noop */ }
}

export default function WebSnapshotShell({ snapshot }: Props) {
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<SnapshotVersion[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snapshot.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* noop */ }
  }, [snapshot.markdown]);

  const onDownload = useCallback(() => {
    const blob = new Blob([snapshot.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${snapshot.displayUrl.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 60)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [snapshot]);

  const onRevalidate = useCallback(() => {
    const url = new URL(window.location.href);
    if (!url.pathname.endsWith('/revalidate')) {
      window.location.href = url.pathname + '/revalidate';
    }
  }, []);

  const onToggleHistory = useCallback(() => {
    setHistoryOpen(open => !open);
  }, []);

  // Lazy-load version history when panel is opened
  useEffect(() => {
    if (!historyOpen || versions !== null || versionsLoading) return;
    setVersionsLoading(true);
    fetch(`/api/web-to-md/versions?urlHash=${encodeURIComponent(snapshot.urlHash)}`)
      .then(r => r.json())
      .then((data: { ok: boolean; versions?: SnapshotVersion[] }) => {
        if (data.ok && data.versions) setVersions(data.versions);
        else setVersions([]);
      })
      .catch(() => setVersions([]))
      .finally(() => setVersionsLoading(false));
  }, [historyOpen, versions, versionsLoading, snapshot.urlHash]);

  const cacheAge = formatAge(snapshot.fetchedAt);

  return (
    <main className="withmd-bg withmd-page">
      <section className="withmd-doc-shell">
        <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill">

          {/* Toolbar */}
          <div className="withmd-toolbar withmd-doc-toolbar" role="toolbar" aria-label="Document actions">
            <div className="withmd-toolbar-left">
              <a
                href={snapshot.normalizedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="withmd-toolbar-source-link"
                title={snapshot.normalizedUrl}
              >
                <span className="withmd-toolbar-source-label">{snapshot.displayUrl}</span>
                <ExternalLinkIcon />
              </a>
              {snapshot.isStale && (
                <span className="withmd-badge withmd-badge-warning">stale</span>
              )}
            </div>
            <div className="withmd-toolbar-right">
              <span className="withmd-toolbar-meta">
                {cacheAge} · {snapshot.sourceEngine}
                {snapshot.version > 1 && ` · v${snapshot.version}`}
              </span>
              <button
                type="button"
                className="withmd-dock-btn"
                onClick={onToggleHistory}
                title="Version history"
                aria-expanded={historyOpen}
              >
                <HistoryIcon />
              </button>
              <button
                type="button"
                className="withmd-dock-btn"
                onClick={onRevalidate}
                title="Force refresh"
              >
                <RefreshIcon />
              </button>
              <button
                type="button"
                className="withmd-dock-btn"
                onClick={onCopy}
                title={copied ? 'Copied!' : 'Copy markdown'}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
              <button
                type="button"
                className="withmd-dock-btn"
                onClick={onDownload}
                title="Download .md"
              >
                <DownloadIcon />
              </button>
              <button
                type="button"
                className="withmd-dock-btn"
                onClick={toggleTheme}
                title="Toggle theme"
              >
                <ThemeIcon />
              </button>
            </div>
          </div>

          {/* Version History Panel */}
          {historyOpen && (
            <div className="withmd-version-panel" role="complementary" aria-label="Version history">
              <div className="withmd-version-panel-header">
                <span className="withmd-version-panel-title">Snapshot history</span>
                <button
                  type="button"
                  className="withmd-dock-btn"
                  onClick={onToggleHistory}
                  title="Close history"
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="withmd-version-list">
                {versionsLoading && (
                  <div className="withmd-version-loading">Loading…</div>
                )}
                {!versionsLoading && versions && versions.length === 0 && (
                  <div className="withmd-version-empty">No version history yet.</div>
                )}
                {!versionsLoading && versions && versions.map((v, i) => (
                  <div key={v.markdownHash + i} className="withmd-version-entry">
                    <span className="withmd-version-number">v{v.version}</span>
                    <span className="withmd-version-date">{formatDate(v.createdAt)}</span>
                    <span className="withmd-version-engine">{v.sourceEngine}</span>
                    <span className="withmd-version-trigger withmd-badge">{v.trigger}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Document */}
          <div className="withmd-doc-scroll">
            <div className="withmd-doc-body withmd-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {snapshot.markdown}
              </ReactMarkdown>
            </div>
          </div>

        </div>
      </section>
    </main>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M5 2H2v8h8V7M7 1h4m0 0v4M11 1 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 7a5 5 0 0 1 8.66-2.5M12 7a5 5 0 0 1-8.66 2.5M12 2v3h-3M2 9v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M7 4v3l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 7H1m1-3L1 5m1 5-1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="4" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M4 4V2a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 7l4 4 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 1v8M4 6l3 3 3-3M1 10v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ThemeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M7 1v1M7 12v1M1 7h1M12 7h1M2.93 2.93l.7.7M10.37 10.37l.7.7M2.93 11.07l.7-.7M10.37 3.63l.7-.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}
