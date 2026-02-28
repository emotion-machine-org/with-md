import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import WebPageShell from '@/components/with-md/web-page-shell';
import { parseWebTargetSegments } from '@/lib/with-md/web2md/route-target';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ webTarget: string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { webTarget } = await params;
  const parsed = parseWebTargetSegments(webTarget);

  if (!parsed) {
    return {
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  return {
    title: `${parsed.targetUrl} - with.md`,
    description: `Website to Markdown snapshot for ${parsed.targetUrl}`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function WebTargetPage({ params }: Props) {
  const { webTarget } = await params;
  const parsed = parseWebTargetSegments(webTarget);

  if (!parsed) {
    notFound();
  }

  return (
    <WebPageShell
      targetUrl={parsed.targetUrl}
      initialMode={parsed.mode}
      initialTrigger={parsed.suffix ?? undefined}
    />
  );
}
