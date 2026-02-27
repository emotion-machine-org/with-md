import type { IncomingMessage } from 'http';
import { Server } from '@hocuspocus/server';
import { getSchema } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

import { TableBlock } from './table-block.js';

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
const DEFAULT_INLINE_REALTIME_MAX_BYTES = 900 * 1024;
const INLINE_REALTIME_MAX_BYTES = (() => {
  const raw = process.env.WITHMD_INLINE_REALTIME_MAX_BYTES;
  if (!raw) return DEFAULT_INLINE_REALTIME_MAX_BYTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INLINE_REALTIME_MAX_BYTES;
  return parsed;
})();
const OVERSIZE_REPORT_INTERVAL_MS = 15_000;
const OVERSIZE_REPORT_DELTA_BYTES = 8 * 1024;
const LOG_THROTTLE_MS = 10_000;
const textEncoder = new TextEncoder();
const lastLogAtByKey = new Map<string, number>();
const oversizedReportByDoc = new Map<string, { bytes: number; reportedAt: number }>();
const bootstrapInFlightByDoc = new Map<string, Promise<void>>();
const loadedVersionByDoc = new Map<string, string>();
const bootstrapMarkdownByDoc = new Map<string, string>();

interface LoadDocumentResponse {
  yjsStateUrl?: string | null;
  markdownContent?: string | null;
  documentVersion?: string | null;
}

interface PersistResponse {
  persistPath?: string;
  yjsBytes?: number;
  documentVersion?: string;
}

interface PersistNormalizationMetadata {
  normalized: boolean;
  repeats: number;
  strippedLeadingPlaceholders: boolean;
}

if (!CONVEX_HTTP || !INTERNAL_SECRET) {
  // Keep startup explicit to avoid silent misconfiguration.
  console.warn(
    '[with-md:hocuspocus] Missing Convex env. Set CONVEX_HTTP_URL (or CONVEX_URL/CONVEX_SITE_URL) and HOCUSPOCUS_CONVEX_SECRET.',
  );
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

const MARKDOWN_EXTENSIONS = [StarterKit.configure({ undoRedo: false }), TableBlock, TaskList, TaskItem];
const MARKDOWN_MANAGER = new MarkdownManager({
  extensions: MARKDOWN_EXTENSIONS,
});
const PM_SCHEMA = getSchema(MARKDOWN_EXTENSIONS);

interface SanitizedRealtimeMarkdown {
  content: string;
  repeats: number;
  strippedLeadingPlaceholders: boolean;
  strippedTrailingPlaceholders: boolean;
}

function stripLeadingPlaceholderParagraphs(markdown: string): { content: string; stripped: boolean } {
  if (!markdown) return { content: markdown, stripped: false };

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  while (start < lines.length) {
    const normalized = lines[start].replace(/\u00A0/g, ' ').trim();
    if (normalized === '' || normalized === '&nbsp;') {
      start += 1;
      continue;
    }
    break;
  }

  if (start === 0) {
    return { content: lines.join('\n'), stripped: false };
  }
  return { content: lines.slice(start).join('\n'), stripped: true };
}

function stripTrailingPlaceholderParagraphs(markdown: string): { content: string; stripped: boolean } {
  if (!markdown) return { content: markdown, stripped: false };
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let end = lines.length;
  while (end > 0) {
    const normalized = lines[end - 1].replace(/\u00A0/g, ' ').trim();
    if (normalized === '' || normalized === '&nbsp;') {
      end -= 1;
      continue;
    }
    break;
  }
  if (end >= lines.length) return { content: lines.join('\n'), stripped: false };
  if (end === 0) return { content: '', stripped: true };
  return { content: lines.slice(0, end).join('\n') + '\n', stripped: true };
}

function collapseExactRepetition(content: string): SanitizedRealtimeMarkdown | null {
  const totalLength = content.length;
  if (totalLength < 1024) return null;

  const lps = new Array<number>(totalLength).fill(0);
  let prefixLength = 0;
  for (let i = 1; i < totalLength; i += 1) {
    while (prefixLength > 0 && content[i] !== content[prefixLength]) {
      prefixLength = lps[prefixLength - 1] ?? 0;
    }
    if (content[i] === content[prefixLength]) {
      prefixLength += 1;
      lps[i] = prefixLength;
    }
  }

  const period = totalLength - (lps[totalLength - 1] ?? 0);
  if (period <= 0 || period >= totalLength) return null;
  if (totalLength % period !== 0) return null;

  const repeats = totalLength / period;
  if (repeats < 2) return null;

  const deduped = content.slice(0, period);
  if (!deduped.trim()) return null;
  return { content: deduped, repeats, strippedLeadingPlaceholders: false, strippedTrailingPlaceholders: false };
}

function collapseTopHeadingRepetition(content: string): SanitizedRealtimeMarkdown | null {
  if (content.length < 2048) return null;

  const firstLineEnd = content.indexOf('\n');
  if (firstLineEnd <= 0) return null;
  const firstLine = content.slice(0, firstLineEnd).trim();
  if (!firstLine.startsWith('# ')) return null;

  const marker = `\n${firstLine}\n`;
  const firstRepeat = content.indexOf(marker, firstLineEnd + 1);
  if (firstRepeat < 0) return null;

  let repeats = 1;
  let cursor = firstRepeat;
  while (cursor >= 0) {
    repeats += 1;
    cursor = content.indexOf(marker, cursor + marker.length);
  }
  if (repeats < 2) return null;

  const deduped = `${content.slice(0, firstRepeat).trimEnd()}\n`;
  if (!deduped.trim()) return null;
  if (deduped.length < 800) return null;
  if (content.length - deduped.length < 512) return null;
  return { content: deduped, repeats, strippedLeadingPlaceholders: false, strippedTrailingPlaceholders: false };
}

function sanitizeRealtimeMarkdown(markdown: string): SanitizedRealtimeMarkdown {
  const leading = stripLeadingPlaceholderParagraphs(markdown);
  const trailing = stripTrailingPlaceholderParagraphs(leading.content);
  const normalized = trailing.content;

  const exact = collapseExactRepetition(normalized);
  if (exact) {
    return {
      ...exact,
      strippedLeadingPlaceholders: leading.stripped,
      strippedTrailingPlaceholders: trailing.stripped,
    };
  }

  const byHeading = collapseTopHeadingRepetition(normalized);
  if (byHeading) {
    return {
      ...byHeading,
      strippedLeadingPlaceholders: leading.stripped,
      strippedTrailingPlaceholders: trailing.stripped,
    };
  }

  return {
    content: normalized,
    repeats: 1,
    strippedLeadingPlaceholders: leading.stripped,
    strippedTrailingPlaceholders: trailing.stripped,
  };
}

function extractTextFromJson(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const content = (node as { content?: unknown[] }).content;
  const text = (node as { text?: string }).text;
  const type = (node as { type?: string }).type;

  if (type === 'text' && typeof text === 'string') {
    return text;
  }
  if (!Array.isArray(content)) return '';
  return content.map(extractTextFromJson).join('');
}

function bootstrapFromMarkdown(ydoc: Y.Doc, markdown: string): boolean {
  try {
    const json = MARKDOWN_MANAGER.parse(markdown ?? '');
    const seeded = prosemirrorJSONToYDoc(PM_SCHEMA, json, 'default');
    const update = Y.encodeStateAsUpdate(seeded);
    Y.applyUpdate(ydoc, update);
    seeded.destroy();
    return true;
  } catch (error) {
    console.error('[with-md:hocuspocus] Failed to bootstrap markdown into Yjs document.', error);
    return false;
  }
}

function serializeToMarkdown(ydoc: Y.Doc): string {
  try {
    const json = yDocToProsemirrorJSON(ydoc, 'default');
    return MARKDOWN_MANAGER.serialize(json as never);
  } catch (error) {
    console.error('[with-md:hocuspocus] Failed to serialize Yjs document, falling back to plain text.', error);
    try {
      const json = yDocToProsemirrorJSON(ydoc, 'default');
      return extractTextFromJson(json);
    } catch {
      return '';
    }
  }
}

function hasDocumentContent(ydoc: Y.Doc): boolean {
  try {
    return sanitizeRealtimeMarkdown(serializeToMarkdown(ydoc)).content.trim().length > 0;
  } catch {
    return false;
  }
}

function clearDocumentState(ydoc: Y.Doc): void {
  try {
    const fragment = ydoc.getXmlFragment('default');
    if (fragment.length > 0) {
      fragment.delete(0, fragment.length);
    }
  } catch (error) {
    console.warn('[with-md:hocuspocus] Failed to clear document state before bootstrap.', error);
  }
}

function markdownByteLength(markdown: string): number {
  return textEncoder.encode(markdown).byteLength;
}

const MAX_REQUEST_BODY_BYTES = 1024 * 1024; // 1MB

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        req.destroy();
        const err = new Error('Payload too large');
        (err as NodeJS.ErrnoException).code = 'PAYLOAD_TOO_LARGE';
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function shouldLog(key: string, throttleMs: number): boolean {
  const now = Date.now();
  const prev = lastLogAtByKey.get(key) ?? 0;
  if (now - prev < throttleMs) return false;
  lastLogAtByKey.set(key, now);
  return true;
}

function logInfoThrottled(key: string, message: string, throttleMs = LOG_THROTTLE_MS) {
  if (!shouldLog(key, throttleMs)) return;
  console.info(message);
}

function logErrorThrottled(key: string, message: string, error: unknown, throttleMs = LOG_THROTTLE_MS) {
  if (!shouldLog(key, throttleMs)) return;
  console.error(message, error);
}

function shouldReportOversized(documentName: string, markdownBytes: number, force = false): boolean {
  const now = Date.now();
  const previous = oversizedReportByDoc.get(documentName);
  if (!previous || force) {
    oversizedReportByDoc.set(documentName, { bytes: markdownBytes, reportedAt: now });
    return true;
  }

  if (Math.abs(previous.bytes - markdownBytes) >= OVERSIZE_REPORT_DELTA_BYTES) {
    oversizedReportByDoc.set(documentName, { bytes: markdownBytes, reportedAt: now });
    return true;
  }

  if (now - previous.reportedAt >= OVERSIZE_REPORT_INTERVAL_MS) {
    oversizedReportByDoc.set(documentName, { bytes: markdownBytes, reportedAt: now });
    return true;
  }

  return false;
}

function clearOversizedReport(documentName: string) {
  oversizedReportByDoc.delete(documentName);
}

function clearBootstrapState(documentName: string) {
  bootstrapInFlightByDoc.delete(documentName);
  loadedVersionByDoc.delete(documentName);
  bootstrapMarkdownByDoc.delete(documentName);
}

function encodeUpdateSnapshot(update: Uint8Array): { base64: string; bytes: number } {
  return {
    base64: Buffer.from(update).toString('base64'),
    bytes: update.byteLength,
  };
}

function encodeYjsSnapshot(ydoc: Y.Doc): { base64: string; bytes: number } {
  const update = Y.encodeStateAsUpdate(ydoc);
  return encodeUpdateSnapshot(update);
}

function updateHasDocumentContent(update: Uint8Array): boolean {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
    return hasDocumentContent(probe);
  } catch {
    return false;
  } finally {
    probe.destroy();
  }
}

async function loadYjsSnapshot(url: string, documentName: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`snapshot fetch failed with ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    logErrorThrottled(
      `bootstrap-remote-state-error:${documentName}`,
      `[with-md:hocuspocus] bootstrap doc=${documentName} path=remote_state_fetch_error`,
      error,
    );
    return null;
  }
}

function preparePersistPayload(documentName: string, document: Y.Doc) {
  const serialized = serializeToMarkdown(document);
  const sanitized = sanitizeRealtimeMarkdown(serialized);
  const sanitizedChanged = sanitized.content !== serialized;

  if (!sanitizedChanged) {
    return {
      markdownContent: sanitized.content,
      markdownBytes: markdownByteLength(sanitized.content),
      yjsSnapshot: encodeYjsSnapshot(document),
      normalized: false,
      repeats: sanitized.repeats,
      strippedLeadingPlaceholders: sanitized.strippedLeadingPlaceholders,
    };
  }

  // Only rebuild the live Yjs document for actual corruption (leading placeholders,
  // repetitions). Trailing &nbsp; is a normal ProseMirror artifact — strip it from
  // persisted content but never mutate the live doc, which would cause a feedback
  // loop: ProseMirror re-adds the trailing paragraph → onStoreDocument strips it →
  // Yjs rebuild propagates to clients → re-render → repeat every 3 seconds.
  const needsYjsRebuild = sanitized.strippedLeadingPlaceholders || sanitized.repeats > 1;

  if (!needsYjsRebuild) {
    return {
      markdownContent: sanitized.content,
      markdownBytes: markdownByteLength(sanitized.content),
      yjsSnapshot: encodeYjsSnapshot(document),
      normalized: false,
      repeats: sanitized.repeats,
      strippedLeadingPlaceholders: sanitized.strippedLeadingPlaceholders,
    };
  }

  const repaired = new Y.Doc();
  try {
    const repairedOk = bootstrapFromMarkdown(repaired, sanitized.content);
    if (!repairedOk && sanitized.content.trim().length > 0) {
      logErrorThrottled(
        `persist-normalize-failed:${documentName}`,
        `[with-md:hocuspocus] persist doc=${documentName} path=normalize_failed_fallback_original`,
        new Error('Failed to rebuild normalized markdown before persisting'),
        2_000,
      );
      return {
        markdownContent: serialized,
        markdownBytes: markdownByteLength(serialized),
        yjsSnapshot: encodeYjsSnapshot(document),
        normalized: false,
        repeats: 1,
        strippedLeadingPlaceholders: false,
      };
    }

    const repairedUpdate = Y.encodeStateAsUpdate(repaired);
    clearDocumentState(document);
    Y.applyUpdate(document, repairedUpdate);
    return {
      markdownContent: sanitized.content,
      markdownBytes: markdownByteLength(sanitized.content),
      yjsSnapshot: encodeUpdateSnapshot(repairedUpdate),
      normalized: true,
      repeats: sanitized.repeats,
      strippedLeadingPlaceholders: sanitized.strippedLeadingPlaceholders,
    };
  } finally {
    repaired.destroy();
  }
}

function toPersistNormalizationMetadata(payload: {
  normalized: boolean;
  repeats: number;
  strippedLeadingPlaceholders: boolean;
}): PersistNormalizationMetadata {
  return {
    normalized: payload.normalized,
    repeats: payload.repeats,
    strippedLeadingPlaceholders: payload.strippedLeadingPlaceholders,
  };
}

const server = Server.configure({
  port: Number(process.env.PORT ?? 3001),
  debounce: 3000,
  maxDebounce: 10000,

  async onRequest({ request, response, instance }) {
    const urlPath = (() => {
      try {
        return new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
      } catch {
        return request.url ?? '/';
      }
    })();

    if (request.method !== 'POST' || urlPath !== '/api/agent/edit') {
      return;
    }

    const sendJson = (status: number, data: unknown): void => {
      if (!response.headersSent) {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(data));
      }
    };

    let body: Record<string, unknown>;
    try {
      const raw = await readBody(request);
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'PAYLOAD_TOO_LARGE') {
        sendJson(413, { ok: false, error: `Payload too large. Maximum body size is ${MAX_REQUEST_BODY_BYTES / 1024}KB.` });
        throw undefined;
      }
      sendJson(400, { ok: false, error: 'Invalid JSON body' });
      throw undefined;
    }

    const documentName = typeof body.documentName === 'string' ? body.documentName.trim() : '';
    const editSecret = typeof body.editSecret === 'string' ? body.editSecret.trim() : '';
    const content = typeof body.content === 'string' ? body.content : null;

    if (!documentName || !editSecret || content === null) {
      sendJson(400, { ok: false, error: 'Missing documentName, editSecret, or content' });
      throw undefined;
    }

    // Validate edit permission via Convex
    let authResult: { ok?: boolean; reason?: string };
    try {
      authResult = (await convexCall('/api/collab/authenticate', {
        userToken: editSecret,
        mdFileId: documentName,
      })) as { ok?: boolean; reason?: string };
    } catch {
      sendJson(503, { ok: false, error: 'Auth service unavailable' });
      throw undefined;
    }

    if (!authResult.ok) {
      const status = authResult.reason === 'missing' ? 404 : 403;
      sendJson(status, { ok: false, error: authResult.reason ?? 'forbidden' });
      throw undefined;
    }

    // Apply the edit via direct server-side connection (no WebSocket needed)
    const normalizedContent = content.replace(/\r\n/g, '\n');
    try {
      const connection = await instance.openDirectConnection(documentName);
      try {
        await connection.transact((doc) => {
          clearDocumentState(doc);
          bootstrapFromMarkdown(doc, normalizedContent);
        });
      } finally {
        await connection.disconnect();
      }
    } catch (err) {
      logErrorThrottled(
        `agent-edit-error:${documentName}`,
        `[with-md:hocuspocus] agent-edit doc=${documentName} path=error`,
        err,
      );
      sendJson(500, { ok: false, error: 'Failed to apply edit' });
      throw undefined;
    }

    const bytes = markdownByteLength(normalizedContent);
    console.info(`[with-md:hocuspocus] agent-edit doc=${documentName} bytes=${bytes}`);
    sendJson(200, { ok: true, documentName, bytes });
    throw undefined;
  },

  async onAuthenticate({ token, documentName }) {
    const result = (await convexCall('/api/collab/authenticate', {
      userToken: token,
      mdFileId: documentName,
    })) as { ok?: boolean; reason?: string };

    console.info(
      `[with-md:hocuspocus] auth doc=${documentName} ok=${result.ok ? 'true' : 'false'} reason=${result.reason ?? 'ok'}`,
    );
    return result;
  },

  async onLoadDocument({ documentName, document }) {
    const inFlight = bootstrapInFlightByDoc.get(documentName);
    if (inFlight) {
      await inFlight;
      console.info(`[with-md:hocuspocus] bootstrap doc=${documentName} path=waited_for_inflight`);
      return;
    }

    const bootstrapTask = (async () => {
      try {
        const data = (await convexCall('/api/collab/loadDocument', {
          mdFileId: documentName,
        })) as LoadDocumentResponse;

        const rawMarkdown = typeof data.markdownContent === 'string' ? data.markdownContent : '';
        const sanitized = sanitizeRealtimeMarkdown(rawMarkdown);
        const markdown = sanitized.content;
        const markdownBytes = markdownByteLength(markdown);
        const version = typeof data.documentVersion === 'string' ? data.documentVersion : `fallback:${markdownBytes}`;
        const previousVersion = loadedVersionByDoc.get(documentName);
        const localHasContent = hasDocumentContent(document);
        const hasMatchingLoadedVersion = Boolean(localHasContent && previousVersion && previousVersion === version);
        const shouldRebootstrapExisting = Boolean(localHasContent && !hasMatchingLoadedVersion);

        if (hasMatchingLoadedVersion) {
          console.info(
            `[with-md:hocuspocus] bootstrap doc=${documentName} bytes=${markdownBytes} path=server_existing_state version=${previousVersion ?? version}`,
          );
          loadedVersionByDoc.set(documentName, version);
          return;
        }

        if (localHasContent && shouldRebootstrapExisting) {
          const driftDescriptor = previousVersion ? `${previousVersion}->${version}` : `unknown->${version}`;
          logInfoThrottled(
            `bootstrap-version-drift:${documentName}`,
            `[with-md:hocuspocus] bootstrap doc=${documentName} path=server_existing_state version_drift=${driftDescriptor} action=rebootstrap`,
            2_000,
          );
        }

        // Ensure deterministic, idempotent bootstrap even after reconnect races.
        clearDocumentState(document);

        let bootstrapPath:
          | 'remote_state'
          | 'remote_state_ignored_normalized_markdown'
          | 'markdown_bootstrap'
          | 'remote_state_unavailable_markdown'
          | 'remote_state_empty_markdown'
          | 'markdown_bootstrap_failed' = 'markdown_bootstrap';
        let markdownBootstrapped = false;
        const preferMarkdownBootstrap = sanitized.repeats > 1 || sanitized.strippedLeadingPlaceholders;
        if (!preferMarkdownBootstrap && typeof data.yjsStateUrl === 'string' && data.yjsStateUrl.length > 0) {
          const update = await loadYjsSnapshot(data.yjsStateUrl, documentName);
          if (update && update.byteLength > 0) {
            const remoteHasContent = updateHasDocumentContent(update);
            if (remoteHasContent || markdownBytes === 0) {
              Y.applyUpdate(document, update);
              bootstrapPath = 'remote_state';
            } else {
              bootstrapPath = 'remote_state_empty_markdown';
            }
          } else {
            bootstrapPath = 'remote_state_unavailable_markdown';
          }
        } else if (preferMarkdownBootstrap && typeof data.yjsStateUrl === 'string' && data.yjsStateUrl.length > 0) {
          bootstrapPath = 'remote_state_ignored_normalized_markdown';
        }

        if (bootstrapPath !== 'remote_state') {
          markdownBootstrapped = bootstrapFromMarkdown(document, markdown);
          if (!markdownBootstrapped && markdownBytes > 0) {
            bootstrapPath = 'markdown_bootstrap_failed';
          }
        }

        // Capture the round-tripped markdown so onStoreDocument can detect no-op persists.
        if (markdownBootstrapped) {
          const roundTripped = sanitizeRealtimeMarkdown(serializeToMarkdown(document)).content;
          bootstrapMarkdownByDoc.set(documentName, roundTripped);
        }

        loadedVersionByDoc.set(documentName, version);
        const pathSuffix = localHasContent && shouldRebootstrapExisting ? '_version_drift_reload' : '';
        console.info(
          `[with-md:hocuspocus] bootstrap doc=${documentName} bytes=${markdownBytes} path=${bootstrapPath}${pathSuffix} version=${version}`,
        );
      } catch (error) {
        logErrorThrottled(
          `bootstrap-error:${documentName}`,
          `[with-md:hocuspocus] bootstrap doc=${documentName} path=load_error`,
          error,
        );
      }
    })();

    bootstrapInFlightByDoc.set(documentName, bootstrapTask);
    try {
      await bootstrapTask;
    } finally {
      bootstrapInFlightByDoc.delete(documentName);
    }
  },

  async onStoreDocument({ documentName, document }) {
    try {
      const payload = preparePersistPayload(documentName, document);
      const markdownContent = payload.markdownContent;
      const markdownBytes = payload.markdownBytes;

      // Skip persisting if the content is identical to the bootstrap round-trip (no user edits).
      const bootstrapMd = bootstrapMarkdownByDoc.get(documentName);
      if (bootstrapMd !== undefined) {
        bootstrapMarkdownByDoc.delete(documentName);
        if (markdownContent === bootstrapMd) {
          logInfoThrottled(
            `persist-bootstrap-skip:${documentName}`,
            `[with-md:hocuspocus] persist doc=${documentName} bytes=${markdownBytes} path=bootstrap_roundtrip_no_change`,
          );
          return;
        }
      }

      if (markdownBytes > INLINE_REALTIME_MAX_BYTES) {
        if (shouldReportOversized(documentName, markdownBytes)) {
          await convexCall('/api/collab/storeDocumentOversized', {
            mdFileId: documentName,
            markdownBytes,
            source: 'hocuspocus:onStoreDocument',
          });
        }

        logInfoThrottled(
          `persist-oversized:${documentName}`,
          `[with-md:hocuspocus] persist doc=${documentName} bytes=${markdownBytes} path=oversized_fallback`,
        );
        return;
      }

      const yjsSnapshot = payload.yjsSnapshot;
      const normalization = toPersistNormalizationMetadata(payload);
      clearOversizedReport(documentName);
      const response = (await convexCall('/api/collab/storeDocument', {
        mdFileId: documentName,
        markdownContent,
        yjsState: yjsSnapshot.base64,
        normalized: normalization.normalized,
        normalizedRepeats: normalization.repeats,
        normalizedStrippedLeadingPlaceholders: normalization.strippedLeadingPlaceholders,
      })) as PersistResponse;
      const persistPath = typeof response?.persistPath === 'string' ? response.persistPath : 'normal';
      const persistedYjsBytes = Number.isFinite(response?.yjsBytes) ? Number(response.yjsBytes) : yjsSnapshot.bytes;
      if (typeof response?.documentVersion === 'string') {
        loadedVersionByDoc.set(documentName, response.documentVersion);
      }
      const normalizedTag = payload.normalized
        ? ` normalized=true repeats=${payload.repeats} strippedPlaceholders=${payload.strippedLeadingPlaceholders ? 'true' : 'false'}`
        : '';

      logInfoThrottled(
        `persist-normal:${documentName}`,
        `[with-md:hocuspocus] persist doc=${documentName} bytes=${markdownBytes} yjsBytes=${persistedYjsBytes} path=${persistPath}${normalizedTag}`,
      );
    } catch (error) {
      logErrorThrottled(
        `persist-error:${documentName}`,
        `[with-md:hocuspocus] persist doc=${documentName} path=error`,
        error,
      );
    }
  },

  async onDisconnect({ documentName, document }) {
    if (document.getConnectionsCount() > 0) return;

    // Let Hocuspocus run the canonical final onStoreDocument flush and unload lifecycle.
    // A second manual store/clear here can race with that path and corrupt state.
    console.info(`[with-md:hocuspocus] disconnect doc=${documentName} path=all_disconnected awaiting_core_store_flush`);
  },

  async afterUnloadDocument({ documentName }) {
    clearOversizedReport(documentName);
    clearBootstrapState(documentName);
    console.info(`[with-md:hocuspocus] unload doc=${documentName} path=cleared_bootstrap_state`);
  },
});

server.listen();
