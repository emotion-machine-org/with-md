import type { Metadata } from 'next';

import AnonShareShell from '@/components/with-md/anon-share-shell';
import { getAnonShareLinkPreview, LINK_PREVIEW_IMAGE_SIZE } from '@/lib/with-md/link-preview';

interface Props {
  params: Promise<{ shareId: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shareId } = await params;
  const path = `/s/${encodeURIComponent(shareId)}`;
  const preview = await getAnonShareLinkPreview(shareId);

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

export default async function SharePage({ params }: Props) {
  const { shareId } = await params;
  return <AnonShareShell shareId={shareId} />;
}
