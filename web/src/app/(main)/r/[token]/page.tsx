import { Suspense } from 'react';
import type { Metadata } from 'next';

import RepoShareShell from '@/components/with-md/repo-share-shell';
import { getRepoShareLinkPreview, LINK_PREVIEW_IMAGE_SIZE } from '@/lib/with-md/link-preview';

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const path = `/r/${encodeURIComponent(token)}`;
  const preview = await getRepoShareLinkPreview(token);

  return {
    title: preview.metaTitle,
    description: preview.description,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      type: 'website',
      title: preview.metaTitle,
      description: preview.description,
      url: path,
      images: [
        {
          url: preview.imagePath,
          width: LINK_PREVIEW_IMAGE_SIZE.width,
          height: LINK_PREVIEW_IMAGE_SIZE.height,
          alt: preview.imageAlt,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: preview.metaTitle,
      description: preview.description,
      images: [preview.imagePath],
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
