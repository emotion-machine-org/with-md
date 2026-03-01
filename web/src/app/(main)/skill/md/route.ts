import { NextResponse } from 'next/server';

import { WITH_MD_SHARE_SKILL_MD } from '@/lib/with-md/skill-install-prompt';

export const dynamic = 'force-static';

export async function GET() {
  return new NextResponse(WITH_MD_SHARE_SKILL_MD, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}
