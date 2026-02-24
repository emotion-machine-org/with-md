import { useMemo } from 'react';

import { detectUnsupportedSyntax } from '@/lib/with-md/syntax';

export function useSyntaxSupport(content: string) {
  return useMemo(() => detectUnsupportedSyntax(content), [content]);
}
