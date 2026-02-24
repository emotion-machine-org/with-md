import type { Metadata } from 'next';

import AnonShareShell from '@/components/with-md/anon-share-shell';

interface Props {
  params: Promise<{ shareId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shareId } = await params;
  const path = `/s/${encodeURIComponent(shareId)}`;
  const description = 'Anonymous markdown sharing';

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

export default async function SharePage({ params }: Props) {
  const { shareId } = await params;
  return <AnonShareShell shareId={shareId} />;
}
