'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';
import * as Y from 'yjs';

import FormatToolbar from '@/components/with-md/format-toolbar';
import { buildEditorExtensions } from '@/components/with-md/tiptap/editor-extensions';

type Mode = 'local' | 'repo';

interface InitMessage {
  type: 'init';
  content: string;
  mode: Mode;
  owner?: string;
  repo?: string;
  path?: string;
  githubToken?: string;
}

interface ContentUpdateMessage {
  type: 'contentUpdate';
  content: string;
}

interface GithubTokenMessage {
  type: 'githubToken';
  githubToken: string;
}

type IncomingMessage = InitMessage | ContentUpdateMessage | GithubTokenMessage;

interface UserInfo {
  login: string;
  avatarUrl: string;
}

function getEditorMarkdown(editor: unknown): string | null {
  try {
    const md = (editor as { getMarkdown?: () => string }).getMarkdown?.();
    if (typeof md === 'string') return md;
  } catch {
    // fall through
  }

  try {
    const mgr = (editor as { storage?: { markdown?: { manager?: { serialize?: (doc: unknown) => string } } }; getJSON?: () => unknown }).storage?.markdown?.manager;
    const serialized = mgr?.serialize?.((editor as { getJSON?: () => unknown }).getJSON?.());
    if (typeof serialized === 'string') return serialized;
  } catch {
    // no serializer
  }

  return null;
}

async function exchangeGithubToken(token: string): Promise<UserInfo | null> {
  try {
    const res = await fetch('/api/auth/token-exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ githubToken: token }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; login?: string; avatarUrl?: string };
    if (data.ok && data.login) {
      return { login: data.login, avatarUrl: data.avatarUrl ?? '' };
    }
    return null;
  } catch {
    return null;
  }
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  try { localStorage.setItem('withmd-theme', next); } catch { /* noop */ }
}

function toMarkdownRawUrl(viewUrl: string): string {
  try {
    const url = new URL(viewUrl);
    const trimmedPath = url.pathname.replace(/\/+$/, '');
    url.pathname = `${trimmedPath}/raw`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return `${viewUrl.replace(/\/+$/, '')}/raw`;
  }
}

/** Copy text to clipboard using execCommand fallback (navigator.clipboard is blocked in sandboxed iframes) */
function copyToClipboard(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    return true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function modeClass(active: boolean): string {
  return active ? 'withmd-dock-btn withmd-dock-btn-active' : 'withmd-dock-btn';
}

export default function EmbedPage() {
  const [initialized, setInitialized] = useState(false);
  const [mode, setMode] = useState<Mode>('local');
  const [repoMeta, setRepoMeta] = useState<{ owner: string; repo: string; path: string } | null>(null);
  const [formatBarOpen, setFormatBarOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [repoStatus, setRepoStatus] = useState<'loading' | 'connected' | 'not_found' | 'unauthenticated' | 'error'>('loading');
  const [user, setUser] = useState<UserInfo | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement | null>(null);
  const shareLinkSnapshotRef = useRef<{ viewUrl: string; editUrl: string; markdownUrl: string } | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentContentRef = useRef<string>('');
  const updatingFromParentRef = useRef(false);
  // Tracks whether token exchange is pending so repo resolution waits
  const tokenExchangeRef = useRef<Promise<UserInfo | null> | null>(null);

  // Create a static ydoc for local mode (not connected to any provider)
  const ydoc = useMemo(() => new Y.Doc(), []);
  useEffect(() => () => { ydoc.destroy(); }, [ydoc]);

  const editor = useEditor({
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'withmd-prose',
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
      },
    },
    extensions: buildEditorExtensions({
      ydoc,
      provider: null,
      user: { name: 'vscode-user', color: '#c7d2fe' },
      enableRealtime: false,
    }),
    contentType: 'markdown' as const,
    content: '',
    onUpdate({ editor: nextEditor }) {
      if (updatingFromParentRef.current) return;

      const markdown = getEditorMarkdown(nextEditor);
      if (markdown == null) return;

      setContent(markdown);
      // Invalidate cached share links when content changes
      shareLinkSnapshotRef.current = null;

      // Debounce sending content changes to parent
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        if (markdown === lastSentContentRef.current) return;
        lastSentContentRef.current = markdown;
        window.parent.postMessage({ type: 'contentChanged', content: markdown }, '*');
      }, 300);
    },
  });

  // Listen for messages from the parent (VSCode webview bridge)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data as IncomingMessage | null;
      if (!data || !data.type) return;

      switch (data.type) {
        case 'init': {
          setMode(data.mode);
          setContent(data.content);
          lastSentContentRef.current = data.content;
          if (data.mode === 'repo' && data.owner && data.repo && data.path) {
            setRepoMeta({ owner: data.owner, repo: data.repo, path: data.path });
          }

          // If the extension provided a GitHub token, exchange it for a session
          // BEFORE setting initialized — so repo resolution waits for the cookie
          if (data.githubToken) {
            const exchangePromise = exchangeGithubToken(data.githubToken);
            tokenExchangeRef.current = exchangePromise;
            void exchangePromise.then((userInfo) => {
              tokenExchangeRef.current = null;
              if (userInfo) setUser(userInfo);
              setInitialized(true);
            });
          } else {
            setInitialized(true);
          }

          // Set editor content
          if (editor) {
            updatingFromParentRef.current = true;
            (editor.commands as unknown as { setContent: (value: string, options?: { contentType?: string }) => boolean })
              .setContent(data.content, { contentType: 'markdown' });
            updatingFromParentRef.current = false;
          }
          break;
        }

        case 'contentUpdate': {
          if (!editor) break;

          const currentMd = getEditorMarkdown(editor);
          if (currentMd === data.content) break;

          updatingFromParentRef.current = true;
          lastSentContentRef.current = data.content;
          setContent(data.content);
          (editor.commands as unknown as { setContent: (value: string, options?: { contentType?: string }) => boolean })
            .setContent(data.content, { contentType: 'markdown' });
          updatingFromParentRef.current = false;
          break;
        }

        case 'githubToken': {
          // Token arrived from the extension after user clicked login
          void exchangeGithubToken(data.githubToken).then((userInfo) => {
            if (userInfo) {
              setUser(userInfo);
              setRepoStatus('loading');
              // Re-trigger repo resolution
              setRepoMeta((prev) => prev ? { ...prev } : prev);
            }
          });
          break;
        }
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [editor]);

  // Send 'ready' message to parent on mount
  useEffect(() => {
    window.parent.postMessage({ type: 'ready' }, '*');
  }, []);

  // Repo mode: resolve file via /api/open
  useEffect(() => {
    if (mode !== 'repo' || !repoMeta || !initialized) return;

    let active = true;

    async function resolveRepo() {
      // Wait for any pending token exchange to finish
      if (tokenExchangeRef.current) {
        await tokenExchangeRef.current;
      }

      try {
        const params = new URLSearchParams({
          owner: repoMeta!.owner,
          repo: repoMeta!.repo,
          path: repoMeta!.path,
        });
        const res = await fetch(`/api/open?${params.toString()}`);
        const data = await res.json() as { error?: string; repoId?: string; mdFileId?: string };

        if (!active) return;

        if (data.error === 'unauthenticated') {
          setRepoStatus('unauthenticated');
          return;
        }

        if (data.error || !data.mdFileId) {
          setRepoStatus('not_found');
          return;
        }

        setRepoStatus('connected');
      } catch {
        if (active) setRepoStatus('error');
      }
    }

    void resolveRepo();
    return () => { active = false; };
  }, [mode, repoMeta, initialized]);

  const onLoginClick = useCallback(() => {
    // Ask the VSCode extension to prompt for GitHub auth
    window.parent.postMessage({ type: 'requestLogin' }, '*');
  }, []);

  const onCopyMarkdown = useCallback(() => {
    const md = editor ? (getEditorMarkdown(editor) ?? content) : content;
    if (copyToClipboard(md)) {
      setStatusMessage('Markdown copied.');
    } else {
      setStatusMessage('Could not copy.');
    }
    setTimeout(() => setStatusMessage(null), 2000);
  }, [content, editor]);

  // Share menu dismiss on click-outside and Escape
  useEffect(() => {
    if (!shareMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!shareMenuRef.current?.contains(target)) {
        setShareMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShareMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [shareMenuOpen]);

  useEffect(() => {
    if (!shareBusy) return;
    setShareMenuOpen(false);
  }, [shareBusy]);

  const onShareMenuAction = useCallback(async (mode: 'view' | 'edit' | 'markdown_url') => {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      let snapshot = shareLinkSnapshotRef.current;
      if (!snapshot) {
        setStatusMessage('Creating share link...');
        const md = editor ? (getEditorMarkdown(editor) ?? content) : content;
        const response = await fetch('/api/anon-share/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: 'shared.md', content: md }),
        });
        const data = (await response.json().catch(() => null)) as
          | { viewUrl?: string; editUrl?: string; error?: string }
          | null;
        if (!response.ok || !data?.viewUrl || !data?.editUrl) {
          throw new Error(data?.error ?? 'Could not create share link.');
        }
        snapshot = {
          viewUrl: data.viewUrl,
          editUrl: data.editUrl,
          markdownUrl: toMarkdownRawUrl(data.viewUrl),
        };
        shareLinkSnapshotRef.current = snapshot;
      }

      const url = mode === 'edit'
        ? snapshot.editUrl
        : mode === 'markdown_url'
          ? snapshot.markdownUrl
          : snapshot.viewUrl;

      if (copyToClipboard(url)) {
        setStatusMessage(
          mode === 'edit'
            ? 'Edit share link copied.'
            : mode === 'markdown_url'
              ? 'Raw URL copied.'
              : 'View share link copied.',
        );
      } else {
        setStatusMessage('Could not copy share link.');
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not copy share link.');
    } finally {
      setShareBusy(false);
      setShareMenuOpen(false);
    }
    setTimeout(() => setStatusMessage(null), 3000);
  }, [content, editor, shareBusy]);

  if (!editor) {
    return (
      <main className="withmd-bg withmd-page withmd-stage">
        <section className="withmd-doc-shell">
          <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill withmd-anon-share-panel">
            <div className="withmd-doc-scroll">
              <div className="withmd-landing-inner">
                <p className="withmd-muted-sm">Loading editor...</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!initialized) {
    return (
      <main className="withmd-bg withmd-page withmd-stage">
        <section className="withmd-doc-shell">
          <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill withmd-anon-share-panel">
            <div className="withmd-doc-scroll">
              <div className="withmd-landing-inner">
                <p className="withmd-muted-sm">Waiting for document...</p>
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
        <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill withmd-anon-share-panel">
          <header className="withmd-dock-wrap withmd-anon-share-toolbar">
            <div className="withmd-dock">
              {/* Format */}
              <button
                type="button"
                className={modeClass(formatBarOpen && !sourceMode)}
                onClick={() => setFormatBarOpen(prev => !prev)}
                aria-label="Toggle formatting"
                disabled={sourceMode}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12.9 6.858l4.242 4.243L7.242 21H3v-4.243l9.9-9.9zm1.414-1.414l2.121-2.122a1 1 0 0 1 1.414 0l2.829 2.829a1 1 0 0 1 0 1.414l-2.122 2.121-4.242-4.242z" />
                </svg>
                <span className="withmd-dock-tooltip">Format</span>
              </button>
              {/* Source */}
              <button
                type="button"
                className={modeClass(sourceMode)}
                onClick={() => { setSourceMode(prev => !prev); setFormatBarOpen(false); }}
                aria-label="Toggle source mode"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8.7 16.6 4.1 12l4.6-4.6 1.4 1.4L6.9 12l3.2 3.2-1.4 1.4zm6.6 0-1.4-1.4 3.2-3.2-3.2-3.2 1.4-1.4 4.6 4.6-4.6 4.6z" />
                </svg>
                <span className="withmd-dock-tooltip">Source</span>
              </button>
              {/* Copy */}
              <button
                type="button"
                className="withmd-dock-btn"
                onClick={onCopyMarkdown}
                aria-label="Copy markdown"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M16 1a2 2 0 0 1 2 2v2h1a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h11Zm-8 18v2h11V7H8v12Zm8-16H5v14h1V7a2 2 0 0 1 2-2h8V3Z" />
                </svg>
                <span className="withmd-dock-tooltip">Copy Markdown</span>
              </button>
              {/* Share */}
              <div className="withmd-share-menu-wrap withmd-dock-share-wrap" ref={shareMenuRef}>
                <button
                  type="button"
                  className={`withmd-dock-btn ${shareMenuOpen ? 'withmd-dock-btn-active' : ''}`}
                  aria-label="Share markdown snapshot"
                  aria-haspopup="menu"
                  aria-expanded={shareMenuOpen}
                  onClick={() => setShareMenuOpen((open) => !open)}
                  disabled={shareBusy}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18 16.08a2.92 2.92 0 0 0-1.96.77l-6.12-3.56a3.18 3.18 0 0 0 0-2.58l6.12-3.56A3 3 0 1 0 15 5a2.89 2.89 0 0 0 .04.49L8.9 9.05a3 3 0 1 0 0 5.9l6.14 3.56a2.89 2.89 0 0 0-.04.49 3 3 0 1 0 3-2.92Z" />
                  </svg>
                  <span className="withmd-dock-tooltip">{shareBusy ? 'Creating Share...' : 'Share'}</span>
                </button>
                {shareMenuOpen ? (
                  <div className="withmd-share-menu withmd-dock-share-menu" role="menu" aria-label="Share links">
                    <button
                      type="button"
                      className="withmd-share-menu-item"
                      role="menuitem"
                      onClick={() => void onShareMenuAction('view')}
                      disabled={shareBusy}
                    >
                      Copy View Link
                    </button>
                    <button
                      type="button"
                      className="withmd-share-menu-item"
                      role="menuitem"
                      onClick={() => void onShareMenuAction('edit')}
                      disabled={shareBusy}
                    >
                      Copy Edit Link
                    </button>
                    <button
                      type="button"
                      className="withmd-share-menu-item"
                      role="menuitem"
                      onClick={() => void onShareMenuAction('markdown_url')}
                      disabled={shareBusy}
                    >
                      Copy Raw URL (for Agents)
                    </button>
                  </div>
                ) : null}
              </div>
              {/* Theme */}
              <button type="button" className="withmd-dock-btn" onClick={toggleTheme} aria-label="Toggle theme">
                <svg className="withmd-icon-sun" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 1h2v3h-2V1zm0 19h2v3h-2v-3zM3.515 4.929l1.414-1.414L7.05 5.636 5.636 7.05 3.515 4.93zM16.95 18.364l1.414-1.414 2.121 2.121-1.414 1.414-2.121-2.121zm2.121-14.85 1.414 1.415-2.121 2.121-1.414-1.414 2.121-2.121zM5.636 16.95l1.414 1.414-2.121 2.121-1.414-1.414 2.121-2.121zM23 11v2h-3v-2h3zM4 11v2H1v-2h3z" />
                </svg>
                <svg className="withmd-icon-moon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 7a7 7 0 0 0 12 4.9v.1c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2h.1A6.98 6.98 0 0 0 10 7zm-6 5a8 8 0 0 0 15.062 3.762A9 9 0 0 1 8.238 4.938 7.999 7.999 0 0 0 4 12z" />
                </svg>
                <span className="withmd-dock-tooltip">Theme</span>
              </button>
              {/* Login / Profile */}
              {mode === 'repo' && !user && (
                <button
                  type="button"
                  className="withmd-dock-btn"
                  onClick={onLoginClick}
                  aria-label="Log in with GitHub"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.607.069-.607 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.268 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.026 2.747-1.026.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                  </svg>
                  <span className="withmd-dock-tooltip">Log in with GitHub</span>
                </button>
              )}
              {user && (
                <>
                  <span className="withmd-dock-gap" />
                  <div className="withmd-row" style={{ gap: 6, alignItems: 'center', paddingRight: 4 }}>
                    {user.avatarUrl && (
                      <span className="withmd-avatar-wrap">
                        <img
                          src={user.avatarUrl}
                          alt={user.login}
                          style={{ width: 22, height: 22, borderRadius: '50%' }}
                        />
                      </span>
                    )}
                    <span className="withmd-muted-xs">{user.login}</span>
                  </div>
                </>
              )}
            </div>
            {statusMessage && (
              <div className="withmd-row withmd-gap-2 withmd-mt-2 withmd-dock-meta withmd-anon-share-status-wrap">
                <span className="withmd-muted-xs withmd-dock-status withmd-anon-share-status">{statusMessage}</span>
              </div>
            )}
            {mode === 'repo' && !statusMessage && (
              <div className="withmd-row withmd-gap-2 withmd-mt-2 withmd-dock-meta withmd-anon-share-status-wrap">
                <span className="withmd-muted-xs withmd-dock-status withmd-anon-share-status">
                  {repoStatus === 'loading' && 'Connecting...'}
                  {repoStatus === 'connected' && `${repoMeta?.owner}/${repoMeta?.repo}`}
                  {repoStatus === 'not_found' && 'Repo not connected in with.md'}
                  {repoStatus === 'unauthenticated' && 'Log in for collaboration'}
                  {repoStatus === 'error' && 'Offline — editing locally'}
                </span>
              </div>
            )}
          </header>

          <div className="withmd-doc-stage withmd-fill">
            {sourceMode ? (
              <div className="withmd-column withmd-fill withmd-gap-2">
                <div className="withmd-editor-shell withmd-column withmd-fill">
                  <pre className="withmd-source-readonly withmd-editor-scroll withmd-fill">{content}</pre>
                </div>
              </div>
            ) : (
              <div className="withmd-anon-editor-wrap withmd-fill">
                {formatBarOpen && <FormatToolbar editor={editor} />}
                <div className="withmd-prosemirror-wrap withmd-editor-scroll withmd-fill">
                  <EditorContent editor={editor} />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
