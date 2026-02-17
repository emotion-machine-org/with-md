import type { Metadata } from 'next';

import AnonShareShell from '@/components/with-md/anon-share-shell';

export const metadata: Metadata = {
  title: 'Shared Markdown · with.md',
  description: 'Anonymous markdown sharing',
  robots: {
    index: false,
    follow: false,
  },
};

interface Props {
  params: Promise<{ shareId: string }>;
}

export default async function SharePage({ params }: Props) {
  const { shareId } = await params;
  return <AnonShareShell shareId={shareId} />;
}
