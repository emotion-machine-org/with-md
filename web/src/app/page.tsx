'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';

import { useAuth } from '@/hooks/with-md/use-auth';

const LANDING_FEATURE_WORDS = ['Human', 'Agent'] as const;
const LANDING_FEATURE_HOLD_MS = 2400;
const LANDING_FEATURE_ERASE_MS = 150;
const LANDING_FEATURE_TYPE_MS = 180;
const LANDING_ANIMATED_CURSOR_NAME = 'claudia';
const LANDING_ANIMATED_CURSOR_COLOR = '#facc15';

function isMarkdownName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

export default function Home() {
  const { loading, user, login } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [anonBusy, setAnonBusy] = useState(false);
  const [anonMessage, setAnonMessage] = useState<string | null>(null);
  const [landingDropActive, setLandingDropActive] = useState(false);
  const [landscapeMode, setLandscapeMode] = useState(false);
  const [animatedFeatureWord, setAnimatedFeatureWord] = useState<string>(LANDING_FEATURE_WORDS[0]);
  const [animatedFeatureTargetIndex, setAnimatedFeatureTargetIndex] = useState(1);

  const createBlankMarkdown = useCallback(async () => {
    if (anonBusy) return;
    setAnonBusy(true);
    setAnonMessage(null);
    try {
      const response = await fetch('/api/anon-share/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'untitled.md',
          content: '\n',
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { editUrl?: string; error?: string }
        | null;
      if (!response.ok || !data?.editUrl) {
        setAnonMessage(data?.error ?? 'Could not create share link.');
        return;
      }
      window.location.href = data.editUrl;
    } catch (error) {
      setAnonMessage(error instanceof Error ? error.message : 'Could not create share link.');
    } finally {
      setAnonBusy(false);
    }
  }, [anonBusy]);

  const uploadAnonymousMarkdown = useCallback(async (file: File) => {
    if (!isMarkdownName(file.name)) {
      setAnonMessage('Only .md and .markdown files are supported.');
      return;
    }

    setAnonBusy(true);
    setAnonMessage(null);
    try {
      const content = await file.text();
      const response = await fetch('/api/anon-share/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          content,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { editUrl?: string; error?: string }
        | null;
      if (!response.ok || !data?.editUrl) {
        setAnonMessage(data?.error ?? 'Could not create share link.');
        return;
      }
      window.location.href = data.editUrl;
    } catch (error) {
      setAnonMessage(error instanceof Error ? error.message : 'Could not create share link.');
    } finally {
      setAnonBusy(false);
    }
  }, []);

  const onFileInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadAnonymousMarkdown(file);
    event.target.value = '';
  }, [uploadAnonymousMarkdown]);

  const onOpenFilePicker = useCallback(() => {
    if (anonBusy) return;
    fileInputRef.current?.click();
  }, [anonBusy]);

  useEffect(() => {
    if (landscapeMode) {
      setLandingDropActive(false);
      return;
    }

    let dragDepth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      setLandingDropActive(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setLandingDropActive(false);
      }
    };

    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      setLandingDropActive(false);
      if (anonBusy) return;
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      void uploadAnonymousMarkdown(file);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [anonBusy, landscapeMode, uploadAnonymousMarkdown]);

  useEffect(() => {
    if (landscapeMode || typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const targetWord = LANDING_FEATURE_WORDS[animatedFeatureTargetIndex];
    const shouldErase = animatedFeatureWord.length > 0 && !targetWord.startsWith(animatedFeatureWord);
    const shouldType = animatedFeatureWord.length < targetWord.length && targetWord.startsWith(animatedFeatureWord);
    const delay = shouldErase
      ? LANDING_FEATURE_ERASE_MS
      : shouldType
        ? LANDING_FEATURE_TYPE_MS
        : LANDING_FEATURE_HOLD_MS;

    const timer = window.setTimeout(() => {
      if (shouldErase) {
        setAnimatedFeatureWord((prev) => prev.slice(0, -1));
        return;
      }
      if (shouldType) {
        const nextLength = Math.min(animatedFeatureWord.length + 1, targetWord.length);
        setAnimatedFeatureWord(targetWord.slice(0, nextLength));
        return;
      }
      setAnimatedFeatureTargetIndex((prev) => (prev + 1) % LANDING_FEATURE_WORDS.length);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [animatedFeatureTargetIndex, animatedFeatureWord, landscapeMode]);

  const authHelper = user
    ? 'Open your workspace to edit markdown files from your GitHub repos'
    : 'Sign in with GitHub to see markdown files in your repos';
  const authSubtitle = 'Collaborate live, and push changes back.';

  return (
    <main className={`withmd-bg withmd-page withmd-landing ${landingDropActive ? 'is-drop-active' : ''}`}>
      {!landscapeMode ? (
        <section className="withmd-doc-shell">
          <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill">
            <div className="withmd-doc-scroll">
              <div className="withmd-landing-inner">
                <h1 className="withmd-landing-title">Collaborate with.md files</h1>
                <p className="withmd-landing-tagline">
                  Markdown-native collaboration for humans and agents.
                </p>

                <hr className="withmd-landing-rule withmd-landing-anon-divider" />

                <div className="withmd-landing-section withmd-landing-anon-section">
                  <h2 className="withmd-landing-h2">Share markdown instantly </h2>
                  <p className="withmd-landing-body withmd-landing-anon-copy">
                    Drag one `.md` file here, or upload manually. You get a read link and an edit
                    link. ... or{' '}
                    <button
                      type="button"
                      className="withmd-landing-create-blank"
                      disabled={anonBusy}
                      onClick={createBlankMarkdown}
                    >
                      create a new file
                    </button>
                    .
                  </p>

                </div>

                <div
                  className={`withmd-landing-drop-zone ${landingDropActive ? 'is-drop-active' : ''} ${anonBusy ? 'is-busy' : ''}`}
                  role="button"
                  tabIndex={anonBusy ? -1 : 0}
                  aria-disabled={anonBusy}
                  aria-label="Upload markdown file"
                  onClick={onOpenFilePicker}
                  onKeyDown={(event) => {
                    if (anonBusy) return;
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onOpenFilePicker();
                  }}
                >
                  <span className="withmd-landing-drop-zone-label" aria-hidden="true">
                    <span>Drag &amp; Drop</span>
                    <span>Your Markdown Files</span>
                    <span>Into This Area</span>
                  </span>
                  <span className="withmd-landing-drop-zone-plus" aria-hidden="true" />
                  <div className="withmd-landing-drop-zone-actions">
                    <span className="withmd-landing-drop-zone-icon" aria-hidden="true">
                      <DocumentIcon />
                    </span>
                    {anonBusy ? <p className="withmd-landing-drop-zone-hint">Creating share link...</p> : null}
                    {anonMessage ? <p className="withmd-landing-anon-message">{anonMessage}</p> : null}
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,text/markdown"
                  className="withmd-hidden-input"
                  onChange={onFileInputChange}
                />

                <hr className="withmd-landing-rule" />

                <div className="withmd-landing-section withmd-landing-signin-section">
                  <p className="withmd-landing-h2 withmd-landing-auth-copy">{authHelper}</p>
                  <p className="withmd-landing-body withmd-landing-auth-subcopy">{authSubtitle}</p>
                  <div className="withmd-landing-cta withmd-landing-auth-cta">
                    {loading ? (
                      <span className="withmd-muted-xs">Loading...</span>
                    ) : user ? (
                      <Link href="/workspace" className="withmd-btn withmd-btn-landing">
                        Open Workspace
                      </Link>
                    ) : (
                      <button type="button" className="withmd-btn withmd-btn-landing" onClick={login}>
                        Login with GitHub
                      </button>
                    )}
                  </div>
                </div>

                <hr className="withmd-landing-rule" />

                <div className="withmd-landing-section">
                  <h2 className="withmd-landing-h2">Your files, your repos</h2>
                  <p className="withmd-landing-body">
                    Edit markdown directly from any GitHub repo. No lock-in, no proprietary formats.
                  </p>
                </div>

                <hr className="withmd-landing-rule" />

                <div className="withmd-landing-section">
                  <h2 className="withmd-landing-h2">Real-time collaboration</h2>
                  <p className="withmd-landing-body">
                    Live cursors, instant sync, and comments anchored to specific passages. Built for
                    teams that think in plain text.
                  </p>
                </div>

                <hr className="withmd-landing-rule" />

                <div className="withmd-landing-section">
                  <h2 className="withmd-landing-h2 withmd-landing-animated-title">
                    <span className="withmd-landing-animated-word">{animatedFeatureWord}</span>
                    <span className="withmd-landing-cursor-inline" style={{ color: LANDING_ANIMATED_CURSOR_COLOR }}>
                      <span className="collaboration-cursor__caret" aria-hidden="true">
                        <span className="collaboration-cursor__label">{LANDING_ANIMATED_CURSOR_NAME}</span>
                      </span>
                    </span>
                    <span>-friendly by design</span>
                  </h2>
                  <p className="withmd-landing-body">
                    Humans and AI agents read, write, and collaborate through the same interface.
                    Markdown as the medium for human-agent teamwork.
                  </p>
                </div>

                <hr className="withmd-landing-rule" />

                <div className="withmd-landing-section withmd-landing-landscape-row">
                  <Link
                    href="https://github.com/emotion-machine-org/with-md"
                    className="withmd-landing-github-inline"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View with.md on GitHub"
                  >
                    <GitHubMarkIcon />
                  </Link>
                  <button
                    type="button"
                    className="withmd-landing-landscape-inline"
                    onClick={() => setLandscapeMode(true)}
                  >
                    Oh, I&apos;m just here to enjoy the landscape.
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}
      {landscapeMode ? (
        <button
          type="button"
          className="withmd-landing-landscape-toggle"
          onClick={() => setLandscapeMode(false)}
        >
          Go back.
        </button>
      ) : null}
    </main>
  );
}

function GitHubMarkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.66.5 12.03c0 5.1 3.3 9.42 7.88 10.95.58.1.79-.25.79-.56 0-.28-.01-1.2-.02-2.17-3.21.7-3.89-1.38-3.89-1.38-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.29-5.25-5.72 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.73 0c2.18-1.49 3.14-1.18 3.14-1.18.63 1.59.24 2.76.12 3.05.73.81 1.17 1.84 1.17 3.1 0 4.44-2.69 5.42-5.26 5.71.41.36.78 1.06.78 2.14 0 1.54-.01 2.78-.01 3.15 0 .31.21.67.79.56A11.54 11.54 0 0 0 23.5 12.03C23.5 5.66 18.35.5 12 .5Z" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 7L11 2.5H19.5V21.5H6.5V7Z" />
      <path d="M6.5 7H11V2.5" />
      <path d="M9 11.5H15.5" />
      <path d="M9 15.5H15.5" />
    </svg>
  );
}
