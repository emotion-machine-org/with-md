import { useCallback, useState } from 'react';

import type { UserMode } from '@/lib/with-md/types';

export function useDocMode(syntaxSupported: boolean) {
  const [userMode, setUserModeState] = useState<UserMode>('document');
  const [editing, setEditing] = useState(false);

  const setUserMode = useCallback(
    (next: UserMode) => {
      setUserModeState(next);
      setEditing(false);
    },
    [],
  );

  const activateEditing = useCallback(() => {
    setUserModeState((current) => {
      if (current === 'document' && !syntaxSupported) {
        // Unsupported syntax: redirect to source editing
        setEditing(true);
        return 'source';
      }
      setEditing(true);
      return current;
    });
  }, [syntaxSupported]);

  const deactivateEditing = useCallback(() => {
    setEditing(false);
  }, []);

  return {
    userMode,
    editing,
    setUserMode,
    activateEditing,
    deactivateEditing,
    canUseRichEdit: syntaxSupported,
  };
}
