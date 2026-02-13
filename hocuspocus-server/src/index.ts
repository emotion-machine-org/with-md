import { Server } from '@hocuspocus/server';
import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import * as Y from 'yjs';

function normalizeConvexHttpUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('.convex.cloud')) {
    return trimmed.replace('.convex.cloud', '.convex.site');
  }
  return trimmed;
}

const CONVEX_HTTP =
  normalizeConvexHttpUrl(process.env.CONVEX_HTTP_URL) ??
  normalizeConvexHttpUrl(process.env.CONVEX_SITE_URL) ??
  normalizeConvexHttpUrl(process.env.CONVEX_URL) ??
  normalizeConvexHttpUrl(process.env.NEXT_PUBLIC_CONVEX_URL);

const INTERNAL_SECRET = process.env.HOCUSPOCUS_CONVEX_SECRET ?? process.env.CONVEX_HOCUSPOCUS_SECRET;

if (!CONVEX_HTTP || !INTERNAL_SECRET) {
  // Keep startup explicit to avoid silent misconfiguration.
  console.warn('[with-md:hocuspocus] Missing Convex env. Set CONVEX_HTTP_URL (or CONVEX_URL/CONVEX_SITE_URL) and HOCUSPOCUS_CONVEX_SECRET.');
}

async function convexCall(path: string, body: unknown) {
  if (!CONVEX_HTTP || !INTERNAL_SECRET) {
    throw new Error('Convex endpoint env vars are not configured');
  }

  const response = await fetch(`${CONVEX_HTTP}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${INTERNAL_SECRET}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Convex ${path} failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function bootstrapFromMarkdown(ydoc: Y.Doc, markdown: string): void {
  const editor = new Editor({
    extensions: [StarterKit, Markdown],
    content: markdown,
    contentType: 'markdown',
  });

  // TODO: convert editor.getJSON() into y-prosemirror document fragment.
  // For now, keep raw text to avoid crashes in development setup.
  const text = ydoc.getText('raw');
  text.delete(0, text.length);
  text.insert(0, editor.getText());
  editor.destroy();
}

function serializeToMarkdown(ydoc: Y.Doc): string {
  const raw = ydoc.getText('raw').toString();
  if (raw) return raw;

  const editor = new Editor({
    extensions: [StarterKit, Markdown],
    content: '',
  });
  const markdown = editor.getText();
  editor.destroy();

  return markdown;
}

const server = Server.configure({
  port: Number(process.env.PORT ?? 3001),
  debounce: 3000,
  maxDebounce: 10000,

  async onAuthenticate({ token, documentName }) {
    return convexCall('/api/collab/authenticate', {
      userToken: token,
      mdFileId: documentName,
    });
  },

  async onLoadDocument({ documentName, document }) {
    const data = await convexCall('/api/collab/loadDocument', {
      mdFileId: documentName,
    });

    if (data.syntaxSupportStatus === 'unsupported') {
      bootstrapFromMarkdown(document, data.markdownContent ?? '');
      return;
    }

    if (data.yjsState) {
      const update = Uint8Array.from(Buffer.from(data.yjsState, 'base64'));
      Y.applyUpdate(document, update);
      return;
    }

    bootstrapFromMarkdown(document, data.markdownContent ?? '');
  },

  async onStoreDocument({ documentName, document }) {
    await convexCall('/api/collab/storeDocument', {
      mdFileId: documentName,
      markdownContent: serializeToMarkdown(document),
      yjsState: Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64'),
    });
  },

  async onDisconnect({ documentName, document }) {
    if (document.getConnectionsCount() > 0) return;

    await convexCall('/api/collab/onAllDisconnected', {
      mdFileId: documentName,
      markdownContent: serializeToMarkdown(document),
      yjsState: Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64'),
    });
  },
});

server.listen();
