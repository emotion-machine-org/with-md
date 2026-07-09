import { getRepoShareLinkPreview } from '@/lib/with-md/link-preview';
import { renderLinkPreviewImage } from '@/lib/with-md/link-preview-image';

interface Params {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const preview = await getRepoShareLinkPreview(token);
  return renderLinkPreviewImage(preview);
}
