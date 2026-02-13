'use client';

import { useEffect, useMemo } from 'react';

import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

interface Params {
  mdFileId: string;
  token: string;
  enabled: boolean;
}

export function useCollabDoc({ mdFileId, token, enabled }: Params) {
  const ydoc = useMemo(() => new Y.Doc(), [mdFileId]);

  useEffect(() => {
    if (!enabled) return;
    const persistence = new IndexeddbPersistence(`withmd-${mdFileId}`, ydoc);
    return () => {
      persistence.destroy();
    };
  }, [enabled, mdFileId, ydoc]);

  const provider = useMemo(() => {
    if (!enabled) return null;

    const url = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
    if (!url) return null;

    return new HocuspocusProvider({
      url,
      name: mdFileId,
      document: ydoc,
      token,
    });
  }, [enabled, mdFileId, token, ydoc]);

  return {
    ydoc,
    provider,
    connected: provider?.isConnected ?? false,
    reason: enabled ? (provider ? null : 'Missing NEXT_PUBLIC_HOCUSPOCUS_URL.') : null,
  };
}
