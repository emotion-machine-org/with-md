'use client';

import Link from 'next/link';

import { useAuth } from '@/hooks/with-md/use-auth';

export default function Home() {
  const { loading, user, login } = useAuth();

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
