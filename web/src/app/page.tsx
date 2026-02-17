'use client';

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import Link from 'next/link';

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

  const onDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (anonBusy) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await uploadAnonymousMarkdown(file);
  }, [anonBusy, uploadAnonymousMarkdown]);

  const onOpenFilePicker = useCallback(() => {
    if (anonBusy) return;
    fileInputRef.current?.click();
  }, [anonBusy]);

  return (
    <main className="withmd-bg withmd-page withmd-landing">
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
                  <Link href="/with-md" className="withmd-btn-landing">
                    Open Workspace
                  </Link>
                ) : (
                  <button type="button" className="withmd-btn-landing" onClick={login}>
                    Login with GitHub
                  </button>
                )}
              </div>

              <div
                className={`withmd-anon-upload-zone ${anonBusy ? 'is-busy' : ''}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop}
              >
                <p className="withmd-anon-upload-title">No login? Share markdown instantly.</p>
                <p className="withmd-anon-upload-sub">
                  Drag one `.md` file here or upload it. You get a read link and an edit link.
                </p>
                <button type="button" className="withmd-anon-upload-btn" onClick={onOpenFilePicker} disabled={anonBusy}>
                  {anonBusy ? 'Creating Share Link...' : 'Upload Markdown'}
                </button>
                {anonMessage ? <p className="withmd-anon-upload-message">{anonMessage}</p> : null}
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
                  Edit markdown directly from any GitHub repo. Changes push back — no lock-in, no
                  proprietary formats.
                </p>
              </div>

              <hr className="withmd-landing-rule" />

              <div className="withmd-landing-section">
                <h2 className="withmd-landing-h2">Three ways to write</h2>
                <p className="withmd-landing-body">
                  Rich editing, source mode, and a clean reading view. Frontmatter, GFM tables, code
                  blocks — rendered faithfully.
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
