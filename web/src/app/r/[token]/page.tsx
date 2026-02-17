import { Suspense } from 'react';

import RepoShareShell from '@/components/with-md/repo-share-shell';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function RepoSharePage({ params }: PageProps) {
  const { token } = await params;
  return (
    <Suspense>
      <RepoShareShell token={token} />
    </Suspense>
  );
}

