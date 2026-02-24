'use client';

import { useEffect, useState } from 'react';

import type { HocuspocusProvider } from '@hocuspocus/provider';

/**
 * Hook that listens to awareness changes and returns the number of
 * remote peers (excluding the local user) currently in the document.
 */
export function usePeerCount(
  provider: HocuspocusProvider | null,
  connected: boolean,
  localUserName: string,
): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness) {
      setCount(0);
      return;
    }

    const update = () => {
      const seen = new Set<string>();
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const user = state.user as { name?: string } | undefined;
        if (!user?.name) return;
        if (user.name === localUserName) return;
        seen.add(user.name);
      });
      setCount(seen.size);
    };

    update();
    awareness.on('change', update);
    return () => {
      awareness.off('change', update);
    };
  }, [provider, connected, localUserName]);

  return count;
}
