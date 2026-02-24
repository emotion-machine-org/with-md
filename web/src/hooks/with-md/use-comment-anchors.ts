import { useMemo } from 'react';

import { recoverAnchor } from '@/lib/with-md/anchor';
import type { AnchorMatch, CommentRecord } from '@/lib/with-md/types';

export function useCommentAnchors(markdown: string, comments: CommentRecord[]) {
  return useMemo(() => {
    const map = new Map<string, AnchorMatch | null>();
    for (const comment of comments) {
      map.set(comment.id, recoverAnchor(markdown, comment.anchor));
    }
    return map;
  }, [comments, markdown]);
}
