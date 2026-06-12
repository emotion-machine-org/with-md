import { getAnonShareLinkPreview } from '@/lib/with-md/link-preview';
import { renderLinkPreviewImage } from '@/lib/with-md/link-preview-image';

interface Params {
  params: Promise<{ shareId: string }>;
}

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export async function GET(_request: Request, { params }: Params) {
  const { shareId } = await params;
  const preview = await getAnonShareLinkPreview(shareId);
  return renderLinkPreviewImage(preview);
}
