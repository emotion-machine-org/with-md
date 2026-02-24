'use client';

import { useEffect, useMemo, useState } from 'react';

import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

interface Params {
  mdFileId: string;
  contentHash: string;
  token: string;
  enabled: boolean;
}

const ENABLE_INDEXEDDB_CACHE = process.env.NEXT_PUBLIC_WITHMD_ENABLE_INDEXEDDB_CACHE === '1';
const ENABLE_COLLAB_LOGS = process.env.NEXT_PUBLIC_WITHMD_COLLAB_LOGS !== '0';

function logCollab(message: string) {
  if (!ENABLE_COLLAB_LOGS) return;
  console.info(`[with-md:collab-client] ${message}`);
}

function maybeResetIndexedDb(mdFileId: string, contentHash: string) {
  const markerKey = `withmd-hash-${mdFileId}`;
  const prevHash = window.localStorage.getItem(markerKey);
  if (!prevHash || prevHash === contentHash) {
    window.localStorage.setItem(markerKey, contentHash);
    return;
  }

  // Canonical markdown changed (resync/push/etc). Drop stale local CRDT cache.
  window.localStorage.setItem(markerKey, contentHash);
  if (typeof indexedDB === 'undefined') return;
  indexedDB.deleteDatabase(`withmd-${mdFileId}`);
}

function clearIndexedDbCache(mdFileId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(`withmd-hash-${mdFileId}`);
  if (typeof indexedDB === 'undefined') return;
  indexedDB.deleteDatabase(`withmd-${mdFileId}`);
}

export function useCollabDoc({ mdFileId, contentHash, token, enabled }: Params) {
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const ydoc = useMemo(() => new Y.Doc(), [mdFileId]);
  useEffect(() => () => {
    ydoc.destroy();
  }, [ydoc]);

  useEffect(() => {
    if (!enabled) return;
    if (!ENABLE_INDEXEDDB_CACHE) {
      // Deterministic bootstrap: no local Yjs cache until remote Yjs snapshots are persisted.
      clearIndexedDbCache(mdFileId);
      return;
    }
    maybeResetIndexedDb(mdFileId, contentHash);
    const persistence = new IndexeddbPersistence(`withmd-${mdFileId}`, ydoc);
    return () => {
      persistence.destroy();
    };
  }, [contentHash, enabled, mdFileId, ydoc]);

  const provider = useMemo(() => {
    if (!enabled) return null;

    const url = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
    if (!url) return null;

    logCollab(`provider:init doc=${mdFileId} token=${token ? 'set' : 'missing'}`);
    const websocketProvider = new HocuspocusProviderWebsocket({
      url,
      // Awareness heartbeats keep the connection alive; use the Hocuspocus default.
      messageReconnectTimeout: 30_000,
    });

    return new HocuspocusProvider({
      websocketProvider,
      name: mdFileId,
      document: ydoc,
      token,
      preserveConnection: false,
      onStatus({ status }) {
        setConnected(status === 'connected');
        if (status !== 'connected') {
          setSynced(false);
        }
        logCollab(`provider:status doc=${mdFileId} status=${status}`);
      },
      onConnect() {
        logCollab(`provider:connect doc=${mdFileId}`);
      },
      onOpen() {
        logCollab(`provider:open doc=${mdFileId}`);
      },
      onAuthenticated() {
        logCollab(`provider:authenticated doc=${mdFileId}`);
      },
      onAuthenticationFailed({ reason }) {
        setConnected(false);
        setSynced(false);
        logCollab(`provider:auth_failed doc=${mdFileId} reason=${reason}`);
      },
      onSynced({ state }) {
        setSynced(Boolean(state));
        logCollab(`provider:synced doc=${mdFileId} state=${state ? 'true' : 'false'}`);
      },
      onDisconnect({ event }) {
        setConnected(false);
        setSynced(false);
        logCollab(`provider:disconnect doc=${mdFileId} code=${event.code}`);
      },
      onClose({ event }) {
        setConnected(false);
        setSynced(false);
        logCollab(`provider:close doc=${mdFileId} code=${event.code}`);
      },
    });
  }, [enabled, mdFileId, token, ydoc]);

  useEffect(() => {
    setConnected(provider?.isConnected ?? false);
    setSynced(false);
  }, [provider]);

  useEffect(() => () => {
    if (!provider) return;
    logCollab(`provider:destroy doc=${mdFileId}`);
    provider.destroy();
  }, [mdFileId, provider]);

  return {
    ydoc,
    provider,
    connected,
    synced,
    reason: enabled ? (provider ? null : 'Missing NEXT_PUBLIC_HOCUSPOCUS_URL.') : null,
  };
}
