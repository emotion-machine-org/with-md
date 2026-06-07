'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { README_DEMO_FILE_NAME, README_DEMO_MARKDOWN } from '@/lib/with-md/readme-demo';

export default function ReadmeDemoPage() {
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function createDemo() {
      try {
        const response = await fetch('/api/anon-share/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: README_DEMO_FILE_NAME,
            content: README_DEMO_MARKDOWN,
          }),
        });
        const data = (await response.json().catch(() => null)) as
          | { editUrl?: string; error?: string }
          | null;

        if (!response.ok || !data?.editUrl) {
          setError(data?.error ?? 'Could not open the demo.');
          return;
        }

        window.location.replace(data.editUrl);
      } catch (demoError) {
        setError(demoError instanceof Error ? demoError.message : 'Could not open the demo.');
      }
    }

    void createDemo();
  }, []);

  return (
    <main className="withmd-bg withmd-page withmd-landing">
      <section className="withmd-doc-shell">
        <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill">
          <div className="withmd-doc-scroll">
            <div className="withmd-landing-inner withmd-demo-redirect">
              <h1 className="withmd-landing-title">Opening an editable README</h1>
              <p className="withmd-landing-tagline">
                {error ?? 'Creating a safe markdown share you can edit without connecting GitHub.'}
              </p>
              {error ? (
                <p className="withmd-landing-body">
                  <Link href="/" className="withmd-landing-demo-link">
                    Create a markdown share from the homepage
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
