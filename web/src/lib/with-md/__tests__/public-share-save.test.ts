import { describe, expect, it, vi } from 'vitest';

import {
  savePublicShareContent,
  ShareVersionConflictError,
  type PublicShareFetch,
} from '../public-share-save';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('savePublicShareContent', () => {
  it('retries a stale version mismatch when the saved share still matches the edit baseline', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl: PublicShareFetch = vi.fn(async (input, init) => {
      calls.push([input, init]);

      if (calls.length === 1) {
        return jsonResponse({ error: 'Version mismatch.' }, 409);
      }

      if (calls.length === 2) {
        return jsonResponse({
          canEdit: true,
          share: {
            content: 'old content',
            contentHash: 'fresh-hash',
            sizeBytes: 11,
            updatedAt: 10,
          },
        });
      }

      return jsonResponse({
        version: 'saved-hash',
        sizeBytes: 16,
        updatedAt: 20,
      });
    });

    const result = await savePublicShareContent({
      shareId: 'abc123',
      editSecret: 'secret',
      nextContent: 'updated content',
      baselineContent: 'old content',
      currentVersion: 'stale-hash',
      fetchImpl,
    });

    expect(result).toMatchObject({
      content: 'updated content',
      version: 'saved-hash',
      retried: true,
    });
    expect(calls).toHaveLength(3);
    expect(calls[0][0]).toBe('/api/public/share/abc123');
    expect(JSON.parse(String(calls[0][1]?.body))).toMatchObject({
      ifMatch: 'stale-hash',
    });
    expect(calls[1][0]).toBe('/api/anon-share/abc123?edit=secret');
    expect(JSON.parse(String(calls[2][1]?.body))).toMatchObject({
      ifMatch: 'fresh-hash',
      content: 'updated content',
    });
  });

  it('does not overwrite a share when the latest content changed from the edit baseline', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl: PublicShareFetch = vi.fn(async (input, init) => {
      calls.push([input, init]);

      if (calls.length === 1) {
        return jsonResponse({ error: 'Version mismatch.' }, 409);
      }

      return jsonResponse({
        canEdit: true,
        share: {
          content: 'someone else edited this',
          contentHash: 'fresh-hash',
        },
      });
    });

    await expect(
      savePublicShareContent({
        shareId: 'abc123',
        editSecret: 'secret',
        nextContent: 'updated content',
        baselineContent: 'old content',
        currentVersion: 'stale-hash',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(ShareVersionConflictError);

    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('/api/public/share/abc123');
    expect(calls[1][0]).toBe('/api/anon-share/abc123?edit=secret');
  });
});
