'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';

import ImportDropOverlay from '@/components/with-md/import-drop-overlay';
import { useAuth } from '@/hooks/with-md/use-auth';

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
  }, [anonBusy, uploadAnonymousMarkdown]);

  return (
    <main className={`withmd-bg withmd-page withmd-landing ${landingDropActive ? 'is-drop-active' : ''}`}>
      <ImportDropOverlay
        visible={landingDropActive}
        processing={false}
        idleTitle="Drag & drop markdown here"
        idleSubtitle="Drop anywhere on this page to create a share link."
      />
      <div className="withmd-landing-drop-hints" aria-hidden="true">
        <span className="withmd-landing-drop-hint withmd-landing-drop-hint-label withmd-landing-drop-hint-tl">
          <span>Drag &amp; Drop</span>
          <span>Your Markdown Files</span>
          <span>Into This Area</span>
        </span>
        <span className="withmd-landing-drop-hint withmd-landing-drop-hint-tr">+</span>
        <span className="withmd-landing-drop-hint withmd-landing-drop-hint-bl">+</span>
        <span className="withmd-landing-drop-hint withmd-landing-drop-hint-label withmd-landing-drop-hint-br">
          <span>Drag &amp; Drop</span>
          <span>Your Markdown Files</span>
          <span>Into This Area</span>
        </span>
      </div>
      <section className="withmd-doc-shell">
        <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill">
          <div className="withmd-doc-scroll">
            <div className="withmd-landing-inner">
              <h1 className="withmd-landing-title">Do it with.md</h1>
              <p className="withmd-landing-tagline">
                Markdown-native collaboration for humans and agents.
              </p>
              <div className="withmd-landing-cta">
                {loading ? (
                  <span className="withmd-muted-xs">Loading...</span>
                ) : user ? (
                  <Link href="/with-md" className="withmd-btn-landing withmd-btn-landing-bright">
                    Open Workspace
                  </Link>
                ) : (
                  <button type="button" className="withmd-btn-landing" onClick={login}>
                    Login with GitHub
                  </button>
                )}
              </div>

              <hr className="withmd-landing-rule" />

              <div className="withmd-landing-section withmd-landing-anon-section">
                <h2 className="withmd-landing-h2">No login? Share markdown instantly.</h2>
                <p className="withmd-landing-body withmd-landing-anon-copy">
                  Drag one `.md` file anywhere on this page, or upload it manually. You get a read
                  link and an edit link.
                </p>
                <div className="withmd-landing-cta withmd-landing-anon-cta">
                  <button
                    type="button"
                    className="withmd-btn-landing withmd-btn-landing-upload"
                    onClick={onOpenFilePicker}
                    disabled={anonBusy}
                  >
                    {anonBusy ? 'Creating Share Link...' : 'Upload Markdown'}
                  </button>
                </div>
                {anonMessage ? <p className="withmd-landing-anon-message">{anonMessage}</p> : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,text/markdown"
                  className="withmd-hidden-input"
                  onChange={onFileInputChange}
                />
              </div>

              <hr className="withmd-landing-rule" />

              <div className="withmd-landing-section">
                <h2 className="withmd-landing-h2">Your files, your repos</h2>
                <p className="withmd-landing-body">
                  Edit markdown directly from any GitHub repo. No lock-in, no
                  proprietary formats.
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
                <h2 className="withmd-landing-h2">Agent-friendly by design</h2>
                <p className="withmd-landing-body">
                  AI agents read, write, and collaborate through the same interface. Markdown as the
                  medium for human-agent teamwork.
                </p>
              </div>

            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
