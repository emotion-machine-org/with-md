import { Suspense } from 'react';
import type { Metadata } from 'next';

import RepoShareShell from '@/components/with-md/repo-share-shell';

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const path = `/r/${encodeURIComponent(token)}`;
  const description = 'Shared markdown workspace collaboration';

  return {
    title: 'with.md',
    description,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      type: 'website',
      title: 'with.md',
      description,
      url: path,
      images: [
        {
          url: '/with-md.jpg',
          width: 1174,
          height: 654,
          alt: 'with.md',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'with.md',
      description,
      images: ['/with-md.jpg'],
    },
  };
}

export default async function RepoSharePage({ params }: PageProps) {
  const { token } = await params;
  return (
    <Suspense>
      <RepoShareShell token={token} />
    </Suspense>
  );
}
