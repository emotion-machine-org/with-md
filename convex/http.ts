import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import { INLINE_REALTIME_MAX_BYTES, markdownByteLength } from './lib/collabPolicy';

const http = httpRouter();

function readBearer(request: Request): string | null {
  const raw = request.headers.get('authorization');
  if (!raw) return null;
  const [scheme, token] = raw.split(' ');
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return token;
}

function validateInternalSecret(request: Request): string | null {
  const expected = process.env.HOCUSPOCUS_CONVEX_SECRET ?? process.env.CONVEX_HOCUSPOCUS_SECRET;
  if (!expected) return 'Server missing HOCUSPOCUS_CONVEX_SECRET';

  const incoming = readBearer(request);
  if (!incoming || incoming !== expected) return 'Unauthorized';
  return null;
}

function isShareDocumentName(value: string): boolean {
  return value.startsWith('share:') && value.length > 'share:'.length;
}

function isWriteConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes('Documents read from or written to the') && error.message.includes('table changed');
}

function decodeBase64ToUint8Array(value: string): Uint8Array | null {
  if (!value) return null;

  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function persistSnapshotFromBase64(
  ctx: { storage: { store: (blob: Blob) => Promise<unknown> } },
  yjsState?: string,
): Promise<{ storageId: string; byteLength: number } | null> {
  const encoded = typeof yjsState === 'string' ? yjsState : '';
  if (!encoded) return null;

  const bytes = decodeBase64ToUint8Array(encoded);
  if (!bytes || bytes.byteLength === 0) return null;

  const storageId = await ctx.storage.store(new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }));
  return {
    storageId: storageId as string,
    byteLength: bytes.byteLength,
  };
}

http.route({
  path: '/api/collab/authenticate',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateInternalSecret(request);
    if (authError) return new Response(authError, { status: authError === 'Unauthorized' ? 401 : 500 });

    const body = (await request.json()) as {
      userToken: string;
      mdFileId: string;
    };

    const documentName = body.mdFileId ?? '';
    const result = isShareDocumentName(documentName)
      ? await ctx.runQuery(internal.anonShares.authenticate, {
        documentName,
        editSecret: body.userToken ?? '',
      })
      : await ctx.runQuery(internal.collab.authenticate, {
        userToken: body.userToken ?? '',
        mdFileId: documentName,
      });

    return Response.json(result);
  }),
});

http.route({
  path: '/api/collab/loadDocument',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateInternalSecret(request);
    if (authError) return new Response(authError, { status: authError === 'Unauthorized' ? 401 : 500 });

    const body = (await request.json()) as {
      mdFileId: string;
    };

    const documentName = body.mdFileId ?? '';
    const result = isShareDocumentName(documentName)
      ? await ctx.runQuery(internal.anonShares.loadDocument, {
        documentName,
      })
      : await ctx.runQuery(internal.collab.loadDocument, {
        mdFileId: documentName as never,
      });

    return Response.json(result);
  }),
});

http.route({
  path: '/api/collab/storeDocument',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateInternalSecret(request);
    if (authError) return new Response(authError, { status: authError === 'Unauthorized' ? 401 : 500 });

    const body = (await request.json()) as {
      mdFileId: string;
      markdownContent: string;
      yjsState?: string;
      normalized?: boolean;
      normalizedRepeats?: number;
      normalizedStrippedLeadingPlaceholders?: boolean;
    };

    const documentName = body.mdFileId ?? '';
    if (isShareDocumentName(documentName)) {
      const persistedSnapshot = await persistSnapshotFromBase64(ctx, body.yjsState);

      try {
        const result = await ctx.runMutation(internal.anonShares.storeDocument, {
          documentName,
          markdownContent: body.markdownContent ?? '',
          yjsStateStorageId: persistedSnapshot?.storageId as never,
        });
        const parsed = (
          result as {
            persistPath?: string;
            replacedYjsStateStorageId?: string;
            documentVersion?: string;
          } | undefined
        ) ?? {};
        const persistPath = parsed.persistPath ?? 'normal';
        const keepSnapshot = persistPath === 'normal' || persistPath === 'unchanged';

        if (!keepSnapshot && persistedSnapshot?.storageId) {
          await ctx.storage.delete(persistedSnapshot.storageId);
        }
        if (parsed.replacedYjsStateStorageId && parsed.replacedYjsStateStorageId !== persistedSnapshot?.storageId) {
          await ctx.storage.delete(parsed.replacedYjsStateStorageId as never);
        }

        return Response.json({
          ok: true,
          persistPath,
          yjsBytes: persistedSnapshot?.byteLength ?? 0,
          documentVersion: parsed.documentVersion ?? null,
        });
      } catch (error) {
        if (persistedSnapshot?.storageId) {
          await ctx.storage.delete(persistedSnapshot.storageId);
        }
        if (isWriteConflictError(error)) {
          return Response.json({ ok: true, persistPath: 'concurrent_conflict_skipped' });
        }
        throw error;
      }
    }

    const markdownContent = body.markdownContent ?? '';
    const markdownBytes = markdownByteLength(markdownContent);
    if (markdownBytes > INLINE_REALTIME_MAX_BYTES) {
      await ctx.runMutation(internal.collab.storeDocumentOversized, {
        mdFileId: documentName as never,
        markdownBytes,
        source: 'http:storeDocument',
      });
      return Response.json({ ok: true, persistPath: 'oversized' });
    }

    const persistedSnapshot = await persistSnapshotFromBase64(ctx, body.yjsState);

    try {
      const result = await ctx.runMutation(internal.collab.storeDocument, {
        mdFileId: documentName as never,
        markdownContent,
        yjsStateStorageId: persistedSnapshot?.storageId as never,
        normalized: body.normalized,
        normalizedRepeats: body.normalizedRepeats,
        normalizedStrippedLeadingPlaceholders: body.normalizedStrippedLeadingPlaceholders,
      });
      const parsed = (
        result as {
          persistPath?: string;
          replacedYjsStateStorageId?: string;
          documentVersion?: string;
        } | undefined
      ) ?? {};
      const persistPath = parsed.persistPath ?? 'normal';
      const keepSnapshot = persistPath === 'normal' || persistPath === 'unchanged';

      if (!keepSnapshot && persistedSnapshot?.storageId) {
        await ctx.storage.delete(persistedSnapshot.storageId);
      }
      if (parsed.replacedYjsStateStorageId && parsed.replacedYjsStateStorageId !== persistedSnapshot?.storageId) {
        await ctx.storage.delete(parsed.replacedYjsStateStorageId as never);
      }

      return Response.json({
        ok: true,
        persistPath,
        yjsBytes: persistedSnapshot?.byteLength ?? 0,
        documentVersion: parsed.documentVersion ?? null,
      });
    } catch (error) {
      if (persistedSnapshot?.storageId) {
        await ctx.storage.delete(persistedSnapshot.storageId);
      }
      if (isWriteConflictError(error)) {
        return Response.json({ ok: true, persistPath: 'concurrent_conflict_skipped' });
      }
      throw error;
    }
  }),
});

http.route({
  path: '/api/collab/storeDocumentOversized',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateInternalSecret(request);
    if (authError) return new Response(authError, { status: authError === 'Unauthorized' ? 401 : 500 });

    const body = (await request.json()) as {
      mdFileId: string;
      markdownBytes: number;
      source?: string;
    };

    const documentName = body.mdFileId ?? '';
    if (isShareDocumentName(documentName)) {
      await ctx.runMutation(internal.anonShares.storeDocumentOversized, {
        documentName,
        markdownBytes: Number.isFinite(body.markdownBytes) ? body.markdownBytes : 0,
        source: body.source,
      });
    } else {
      await ctx.runMutation(internal.collab.storeDocumentOversized, {
        mdFileId: documentName as never,
        markdownBytes: Number.isFinite(body.markdownBytes) ? body.markdownBytes : 0,
        source: body.source,
      });
    }

    return Response.json({ ok: true, persistPath: 'oversized' });
  }),
});

http.route({
  path: '/api/collab/onAllDisconnected',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateInternalSecret(request);
    if (authError) return new Response(authError, { status: authError === 'Unauthorized' ? 401 : 500 });

    const body = (await request.json()) as {
      mdFileId: string;
      markdownContent: string;
      yjsState?: string;
      normalized?: boolean;
      normalizedRepeats?: number;
      normalizedStrippedLeadingPlaceholders?: boolean;
    };

    const documentName = body.mdFileId ?? '';
    if (isShareDocumentName(documentName)) {
      const persistedSnapshot = await persistSnapshotFromBase64(ctx, body.yjsState);

      try {
        const result = await ctx.runMutation(internal.anonShares.storeDocument, {
          documentName,
          markdownContent: body.markdownContent ?? '',
          yjsStateStorageId: persistedSnapshot?.storageId as never,
        });
        const parsed = (
          result as {
            persistPath?: string;
            replacedYjsStateStorageId?: string;
            documentVersion?: string;
          } | undefined
        ) ?? {};
        const persistPath = parsed.persistPath ?? 'normal';
        const keepSnapshot = persistPath === 'normal' || persistPath === 'unchanged';

        if (!keepSnapshot && persistedSnapshot?.storageId) {
          await ctx.storage.delete(persistedSnapshot.storageId);
        }
        if (parsed.replacedYjsStateStorageId && parsed.replacedYjsStateStorageId !== persistedSnapshot?.storageId) {
          await ctx.storage.delete(parsed.replacedYjsStateStorageId as never);
        }

        return Response.json({
          ok: true,
          persistPath,
          yjsBytes: persistedSnapshot?.byteLength ?? 0,
          documentVersion: parsed.documentVersion ?? null,
        });
      } catch (error) {
        if (persistedSnapshot?.storageId) {
          await ctx.storage.delete(persistedSnapshot.storageId);
        }
        if (isWriteConflictError(error)) {
          return Response.json({ ok: true, persistPath: 'concurrent_conflict_skipped' });
        }
        throw error;
      }
    }

    const markdownContent = body.markdownContent ?? '';
    const markdownBytes = markdownByteLength(markdownContent);
    if (markdownBytes > INLINE_REALTIME_MAX_BYTES) {
      await ctx.runMutation(internal.collab.storeDocumentOversized, {
        mdFileId: documentName as never,
        markdownBytes,
        source: 'http:onAllDisconnected',
      });
      return Response.json({ ok: true, persistPath: 'oversized' });
    }

    const persistedSnapshot = await persistSnapshotFromBase64(ctx, body.yjsState);

    try {
      const result = await ctx.runMutation(internal.collab.onAllDisconnected, {
        mdFileId: documentName as never,
        markdownContent,
        yjsStateStorageId: persistedSnapshot?.storageId as never,
        normalized: body.normalized,
        normalizedRepeats: body.normalizedRepeats,
        normalizedStrippedLeadingPlaceholders: body.normalizedStrippedLeadingPlaceholders,
      });
      const parsed = (
        result as {
          persistPath?: string;
          replacedYjsStateStorageId?: string;
          documentVersion?: string;
        } | undefined
      ) ?? {};
      const persistPath = parsed.persistPath ?? 'normal';
      const keepSnapshot = persistPath === 'normal' || persistPath === 'unchanged';

      if (!keepSnapshot && persistedSnapshot?.storageId) {
        await ctx.storage.delete(persistedSnapshot.storageId);
      }
      if (parsed.replacedYjsStateStorageId && parsed.replacedYjsStateStorageId !== persistedSnapshot?.storageId) {
        await ctx.storage.delete(parsed.replacedYjsStateStorageId as never);
      }

      return Response.json({
        ok: true,
        persistPath,
        yjsBytes: persistedSnapshot?.byteLength ?? 0,
        documentVersion: parsed.documentVersion ?? null,
      });
    } catch (error) {
      if (persistedSnapshot?.storageId) {
        await ctx.storage.delete(persistedSnapshot.storageId);
      }
      if (isWriteConflictError(error)) {
        return Response.json({ ok: true, persistPath: 'concurrent_conflict_skipped' });
      }
      throw error;
    }
  }),
});

export default http;
