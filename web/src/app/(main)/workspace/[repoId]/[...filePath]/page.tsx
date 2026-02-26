import WithMdShell from '@/components/with-md/with-md-shell';

interface Props {
  params: Promise<{
    repoId: string;
    filePath: string[];
  }>;
}

export default async function WithMdFilePage({ params }: Props) {
  const { repoId, filePath } = await params;
  const decoded = filePath.map((segment) => decodeURIComponent(segment)).join('/');

  return <WithMdShell repoId={repoId} filePath={decoded} />;
}
