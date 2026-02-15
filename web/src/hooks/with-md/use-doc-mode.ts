import { useCallback, useEffect, useState } from 'react';

import type { UserMode } from '@/lib/with-md/types';

export function useDocMode(syntaxSupported: boolean) {
  const [userMode, setUserModeState] = useState<UserMode>(syntaxSupported ? 'document' : 'source');

  useEffect(() => {
    if (!syntaxSupported) {
      setUserModeState('source');
    }
  }, [syntaxSupported]);

  const setUserMode = useCallback((next: UserMode) => {
    if (next === 'document' && !syntaxSupported) {
      setUserModeState('source');
      return;
    }
    setUserModeState(next);
  }, [syntaxSupported]);

  return {
    userMode,
    setUserMode,
    canUseRichEdit: syntaxSupported,
  };
}
