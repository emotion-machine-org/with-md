import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DocMode } from '@/lib/with-md/types';

export function useDocMode(syntaxSupported: boolean, initialMode: DocMode = 'read') {
  const [mode, setMode] = useState<DocMode>(initialMode);

  useEffect(() => {
    if (!syntaxSupported && mode === 'edit') {
      setMode('source');
    }
  }, [mode, syntaxSupported]);

  const requestMode = useCallback(
    (nextMode: DocMode) => {
      if (nextMode === 'edit' && !syntaxSupported) {
        setMode('source');
        return;
      }
      setMode(nextMode);
    },
    [syntaxSupported],
  );

  return {
    mode,
    setMode: requestMode,
    canUseEditMode: useMemo(() => syntaxSupported, [syntaxSupported]),
  };
}
