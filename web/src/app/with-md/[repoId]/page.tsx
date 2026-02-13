import WithMdShell from '@/components/with-md/with-md-shell';

interface Props {
  params: Promise<{ repoId: string }>;
}

export default async function WithMdRepoPage({ params }: Props) {
  const { repoId } = await params;
  return <WithMdShell repoId={repoId} />;
}
