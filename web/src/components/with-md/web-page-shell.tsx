'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useScrollbarWidth } from '@/hooks/with-md/use-scrollbar-width';

interface Props {
  targetUrl: string;
  initialMode: 'normal' | 'revalidate';
  initialTrigger?: string;
}

interface SnapshotPayload {
  urlHash: string;
  normalizedUrl: string;
  displayUrl: string;
  title: string;
  markdown: string;
  sourceEngine: string;
  sourceDetail?: string;
  httpStatus?: number;
  contentType?: string;
  fetchedAt: number;
  staleAt: number;
  version: number;
  tokenEstimate?: number;
  isStale: boolean;
  lastError?: string;
}

interface ResolveResponse {
  snapshot?: SnapshotPayload;
  fromCache?: boolean;
  fallbackToCache?: boolean;
  warning?: string;
  error?: string;
}

function modeClass(active: boolean): string {
  return active ? 'withmd-dock-btn withmd-dock-btn-active' : 'withmd-dock-btn';
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  try {
    localStorage.setItem('withmd-theme', next);
  } catch {
    /* noop */
  }
}

function formatAge(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return 'just now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function toDownloadFileName(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/[^a-z0-9.-]+/gi, '-');
    const pathLeaf = parsed.pathname.split('/').filter(Boolean).at(-1) || 'page';
    const file = `${host}-${pathLeaf}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-');
    return file.endsWith('.md') ? file : `${file}.md`;
  } catch {
    return 'webpage.md';
  }
}

export default function WebPageShell({ targetUrl, initialMode, initialTrigger }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [userMode, setUserMode] = useState<'document' | 'source'>('document');
  const [hideImages, setHideImages] = useState(false);
  const [metaNoticeClosed, setMetaNoticeClosed] = useState(false);
  const [statusNoticeClosed, setStatusNoticeClosed] = useState(false);
  const { ref: markdownScrollRef, scrollbarWidth: markdownScrollbarWidth } = useScrollbarWidth<HTMLDivElement>();
  const { ref: sourceScrollRef, scrollbarWidth: sourceScrollbarWidth } = useScrollbarWidth<HTMLPreElement>();

  const resolveSnapshot = useCallback(async (mode: 'normal' | 'revalidate', trigger?: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/web-md/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetUrl,
          mode,
          trigger,
        }),
      });

      const data = (await response.json().catch(() => null)) as ResolveResponse | null;
      if (!response.ok || !data?.snapshot) {
        throw new Error(data?.error ?? `Failed to resolve URL (${response.status}).`);
      }

      setSnapshot(data.snapshot);
      setFromCache(Boolean(data.fromCache));
      if (data.warning) {
        setStatusMessage(data.warning);
      } else if (mode === 'revalidate') {
        setStatusMessage('Snapshot refreshed.');
      } else if (data.fromCache) {
        setStatusMessage('Loaded cached snapshot.');
      } else {
        setStatusMessage('Generated new snapshot.');
      }
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : 'Failed to convert URL.');
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [targetUrl]);

  useEffect(() => {
    void resolveSnapshot(initialMode, initialTrigger);
  }, [initialMode, initialTrigger, resolveSnapshot]);

  useEffect(() => {
    if (!statusMessage) return;
    setStatusNoticeClosed(false);
    const timer = window.setTimeout(() => {
      setStatusMessage((current) => (current === statusMessage ? null : current));
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  const markdown = snapshot?.markdown ?? '';
  const isSource = userMode === 'source';
  const downloadName = useMemo(() => toDownloadFileName(snapshot?.normalizedUrl || targetUrl), [snapshot?.normalizedUrl, targetUrl]);

  const onCopyMarkdown = useCallback(async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setStatusMessage('Markdown copied.');
    } catch (copyError) {
      setStatusMessage(copyError instanceof Error ? copyError.message : 'Could not copy markdown.');
    }
  }, [markdown]);

  const onDownload = useCallback(() => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName;
    link.click();
    URL.revokeObjectURL(url);
  }, [downloadName, markdown]);

  if (loading) {
    return (
      <main className="withmd-bg withmd-page withmd-stage">
        <section className="withmd-doc-shell">
          <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill withmd-anon-share-panel">
            <div className="withmd-doc-scroll">
              <div className="withmd-landing-inner">
                <p className="withmd-muted-sm">Converting website to markdown...</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (error || !snapshot) {
    return (
      <main className="withmd-bg withmd-page withmd-stage">
        <section className="withmd-doc-shell">
          <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill withmd-anon-share-panel">
            <div className="withmd-doc-scroll">
              <div className="withmd-landing-inner">
                <h1 className="withmd-landing-title">Conversion failed</h1>
                <p className="withmd-landing-body">{error ?? 'Could not convert this website right now.'}</p>
                <p className="withmd-landing-body">
                  <a className="withmd-btn withmd-btn-primary" href={targetUrl} rel="noreferrer" target="_blank">Open original URL</a>
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="withmd-bg withmd-page withmd-stage">
      <section className="withmd-doc-shell">
        <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill withmd-anon-share-panel withmd-web2md-panel">
          <header className="withmd-dock-wrap withmd-anon-share-toolbar">
            <div className="withmd-dock">
              <button
                type="button"
                className={modeClass(isSource)}
                aria-label="Toggle source mode"
                onClick={() => setUserMode((current) => (current === 'source' ? 'document' : 'source'))}
              >
                <CodeIcon />
                <span className="withmd-dock-tooltip">Source</span>
              </button>
              <button type="button" className="withmd-dock-btn" aria-label="Download markdown" onClick={onDownload}>
                <DownloadIcon />
                <span className="withmd-dock-tooltip">Download</span>
              </button>
              <button type="button" className="withmd-dock-btn" aria-label="Copy markdown" onClick={() => void onCopyMarkdown()}>
                <CopyIcon />
                <span className="withmd-dock-tooltip">Copy Markdown</span>
              </button>
              <button
                type="button"
                className={modeClass(hideImages)}
                aria-label={hideImages ? 'Show images' : 'Hide images'}
                onClick={() => setHideImages((current) => !current)}
              >
                <ImageIcon />
                <span className="withmd-dock-tooltip">{hideImages ? 'Show Images' : 'Hide Images'}</span>
              </button>
              <button
                type="button"
                className="withmd-dock-btn"
                aria-label="Revalidate snapshot"
                onClick={() => void resolveSnapshot('revalidate', 'revalidate')}
              >
                <RefreshIcon />
                <span className="withmd-dock-tooltip">Revalidate</span>
              </button>
              <a className="withmd-dock-btn" href={snapshot.normalizedUrl} target="_blank" rel="noreferrer" aria-label="Open original URL">
                <ExternalIcon />
                <span className="withmd-dock-tooltip">Open Source</span>
              </a>
              <button type="button" className="withmd-dock-btn" onClick={toggleTheme} aria-label="Toggle theme">
                <SunIcon />
                <MoonIcon />
                <span className="withmd-dock-tooltip">Theme</span>
              </button>
            </div>
          </header>

          <div className="withmd-filepath-bar">
            <span className="withmd-filepath-dir">{snapshot.normalizedUrl}</span>
          </div>

          <aside className="withmd-web2md-notice-stack" aria-live="polite">
            {!metaNoticeClosed ? (
              <section className="withmd-web2md-notice">
                <span>
                  {fromCache ? 'cached' : 'fresh'}
                  {' · '}
                  v{snapshot.version}
                  {' · '}
                  {snapshot.sourceEngine}
                  {' · '}
                  {formatAge(snapshot.fetchedAt)}
                  {snapshot.isStale ? ' · stale' : ''}
                  {snapshot.httpStatus ? ` · HTTP ${snapshot.httpStatus}` : ''}
                </span>
                <button
                  type="button"
                  className="withmd-web2md-notice-close"
                  aria-label="Dismiss metadata notice"
                  onClick={() => setMetaNoticeClosed(true)}
                >
                  ×
                </button>
              </section>
            ) : null}

            {statusMessage && !statusNoticeClosed ? (
              <section className="withmd-web2md-notice withmd-web2md-notice-accent">
                <span>{statusMessage}</span>
                <button
                  type="button"
                  className="withmd-web2md-notice-close"
                  aria-label="Dismiss status notice"
                  onClick={() => setStatusNoticeClosed(true)}
                >
                  ×
                </button>
              </section>
            ) : null}
          </aside>

          <div className="withmd-doc-stage withmd-fill">
            {isSource ? (
              <div className="withmd-column withmd-fill withmd-gap-2">
                <div className="withmd-editor-shell withmd-column withmd-fill">
                  <pre
                    ref={sourceScrollRef}
                    className="withmd-source-readonly withmd-editor-scroll withmd-fill"
                    style={{ '--withmd-editor-scrollbar-width': `${sourceScrollbarWidth}px` } as CSSProperties}
                  >
                    {markdown}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="withmd-column withmd-fill withmd-gap-2">
                <div className="withmd-editor-shell withmd-column withmd-fill">
                  <div
                    ref={markdownScrollRef}
                    className="withmd-prosemirror-wrap withmd-editor-scroll withmd-fill"
                    style={{ '--withmd-editor-scrollbar-width': `${markdownScrollbarWidth}px` } as CSSProperties}
                  >
                    <article className={`withmd-prose withmd-markdown withmd-anon-markdown${hideImages ? ' withmd-hide-images' : ''}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                    </article>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 1a2 2 0 0 1 2 2v2h1a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h11Zm-8 18v2h11V7H8v12Zm8-16H5v14h1V7a2 2 0 0 1 2-2h8V3Z" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.7 16.6 4.1 12l4.6-4.6 1.4 1.4L6.9 12l3.2 3.2-1.4 1.4zm6.6 0-1.4-1.4 3.2-3.2-3.2-3.2 1.4-1.4 4.6 4.6-4.6 4.6z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v12h16V6H4Zm11 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-9 8 4-4 3 3 2-2 3 3H6Z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3h7v7h-2V6.414l-8.293 8.293-1.414-1.414L17.586 5H14V3ZM5 5h6v2H7v10h10v-4h2v6H5V5Z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4a8 8 0 0 1 7.75 6h-2.1A6 6 0 1 0 18 13h-3l4 4 4-4h-3a8 8 0 1 1-8-9Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="withmd-icon-sun" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 1h2v3h-2V1zm0 19h2v3h-2v-3zM3.515 4.929l1.414-1.414L7.05 5.636 5.636 7.05 3.515 4.93zM16.95 18.364l1.414-1.414 2.121 2.121-1.414 1.414-2.121-2.121zm2.121-14.85 1.414 1.415-2.121 2.121-1.414-1.414 2.121-2.121zM5.636 16.95l1.414 1.414-2.121 2.121-1.414-1.414 2.121-2.121zM23 11v2h-3v-2h3zM4 11v2H1v-2h3z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="withmd-icon-moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 7a7 7 0 0 0 12 4.9v.1c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2h.1A6.98 6.98 0 0 0 10 7zm-6 5a8 8 0 0 0 15.062 3.762A9 9 0 0 1 8.238 4.938 7.999 7.999 0 0 0 4 12z" />
    </svg>
  );
}
