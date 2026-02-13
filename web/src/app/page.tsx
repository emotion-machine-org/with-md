import Link from 'next/link';

export default function Home() {
  return (
    <main className="withmd-bg withmd-page">
      <div className="withmd-home-wrap">
        <div className="withmd-panel withmd-home-panel">
          <h1 className="withmd-title">with.md</h1>
          <p className="withmd-muted-sm withmd-mt-3">
            Markdown-native collaboration for humans and agents.
          </p>
          <div className="withmd-mt-6">
            <Link href="/with-md" className="withmd-btn withmd-btn-primary">
              Open Workspace
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
