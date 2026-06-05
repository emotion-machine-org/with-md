'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const README_DEMO_MARKDOWN = `# with.md README demo

This is a safe sample README for trying editable markdown collaboration.

## What to try

- Change this checklist into your own launch notes.
- Add a comment for the next person.
- Copy the edit link and send it to someone else.

## Why this stays safe

This demo creates a standalone markdown share. It does not connect to your GitHub account, request repository access, or touch a real README.

## Source stays clean

The content remains markdown. You can switch to source mode, edit the raw text, and copy the updated markdown back out when you are done.
`;

type DemoResponse = {
  editUrl?: string;
  error?: string;
};

export default function ReadmeDemoPage() {
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const startDemo = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/anon-share/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'with-md-readme-demo.md',
          content: README_DEMO_MARKDOWN,
        }),
      });
      const data = (await response.json().catch(() => null)) as DemoResponse | null;
      if (!response.ok || !data?.editUrl) {
        setError(data?.error ?? 'Could not create the demo share.');
        return;
      }
      window.location.href = data.editUrl;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the demo share.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void startDemo();
  }, [startDemo]);

  return (
    <main className="withmd-bg withmd-page withmd-landing">
      <section className="withmd-doc-shell">
        <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill">
          <div className="withmd-doc-scroll">
            <div className="withmd-landing-inner">
              <h1 className="withmd-landing-title">Opening an editable README demo</h1>
              <p className="withmd-landing-tagline">
                This creates a safe sample markdown share. It does not connect to GitHub or touch a real repository.
              </p>

              <hr className="withmd-landing-rule withmd-landing-anon-divider" />

              <div className="withmd-landing-section withmd-landing-anon-section">
                <h2 className="withmd-landing-h2">{busy ? 'Creating the demo link...' : 'Demo link did not open'}</h2>
                <p className="withmd-landing-body withmd-landing-anon-copy">
                  {error
                    ? error
                    : 'You will land in an editable markdown document with sample README content.'}
                </p>
                {error ? (
                  <button type="button" className="withmd-btn withmd-btn-landing" onClick={() => void startDemo()}>
                    Try again
                  </button>
                ) : null}
              </div>

              <hr className="withmd-landing-rule" />

              <div className="withmd-landing-section">
                <p className="withmd-landing-body">
                  <Link href="/" className="withmd-landing-landscape-inline">
                    Back to with.md
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
