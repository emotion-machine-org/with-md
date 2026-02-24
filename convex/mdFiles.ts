import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';

import { markdownByteLength } from './lib/collabPolicy';
import { hashContent, hasMeaningfulDiff } from './lib/markdownDiff';
import { shouldRejectSuspiciousShrink } from './lib/shrinkGuard';
import { detectUnsupportedSyntax } from './lib/syntax';

const REPEAT_DEDUPE_MIN_BYTES = 1024;
const HEADING_REPEAT_DEDUPE_MIN_BYTES = 2048;
const HEADING_REPEAT_MIN_SECTION_BYTES = 800;
const HEADING_REPEAT_MIN_DUPLICATED_BYTES = 512;
const UNDO_WINDOW_MS = 60_000;
const UNDO_MAX_RESTORABLE_CONTENT_BYTES = 256 * 1024;

type ConflictMode = 'keep_both' | 'replace';

interface ImportUndoInsertedEntry {
  kind: 'inserted';
  mdFileId: string;
}

interface ImportUndoReplacedEntry {
  kind: 'replaced';
  mdFileId: string;
  previousContent: string;
}

interface PathUndoEntry {
  kind: 'path';
  mdFileId: string;
  fromPath: string;
  toPath: string;
}

type UndoEntry = ImportUndoInsertedEntry | ImportUndoReplacedEntry | PathUndoEntry;

interface UndoPayload {
  repoId: string;
  createdAt: number;
  expiresAt: number;
  entries: UndoEntry[];
}

const CLAW_MESSENGER_CANONICAL_README = `# @emotion-machine/claw-messenger

iMessage, RCS & SMS channel plugin for [OpenClaw](https://openclaw.ai) — no phone or Mac Mini required. See [Claw Messenger](https://clawmessenger.com) for more details. Very cool!

## Install

\`\`\`bash
openclaw plugins install @emotion-machine/claw-messenger
\`\`\`

## Configuration

After installing, add to your OpenClaw config under \`channels\`:

\`\`\`json5
{
  "channels": {
    "claw-messenger": {
      "enabled": true,
      "apiKey": "cm_live_XXXXXXXX_YYYYYYYYYYYYYY",
      "serverUrl": "wss://claw-messenger.onrender.com",
      "preferredService": "iMessage",  // "iMessage" | "RCS" | "SMS"
      "dmPolicy": "pairing",           // "open" | "pairing" | "allowlist"
      "allowFrom": ["+15551234567"]    // only used with "allowlist" policy
    }
  }
}
\`\`\`

## Features

- **Send & receive** text messages and media (images, video, audio, documents)
- **iMessage reactions** — love, like, dislike, laugh, emphasize, question (tapback)
- **Group chats** — send to existing groups or create new ones
- **Typing indicators** — sent and received
- **DM security policies** — open, pairing-based approval, or allowlist

## Agent Tools

The plugin registers two tools your agent can call:

| Tool | Description |
|------|-------------|
| \`claw_messenger_status\` | Check connection status, server URL, and preferred service |
| \`claw_messenger_switch_service\` | Switch the preferred messaging service at runtime |

## Slash Commands

| Command | Description |
|---------|-------------|
| \`/cm-status\` | Show connection state, server URL, and preferred service |
| \`/cm-switch <service>\` | Switch preferred service (\`iMessage\`, \`RCS\`, or \`SMS\`) |

## Getting Started

1. Sign up at [clawmessenger.com](https://clawmessenger.com)
2. Create an API key from the dashboard
3. Install the plugin: \`openclaw plugins install @emotion-machine/claw-messenger\`
4. Add the config above with your API key
5. Start a conversation — your agent can now send and receive messages

## License

UNLICENSED
`;

function maybeCollapseExactWholeDocRepetition(content: string): { deduped: string; repeats: number } | null {
  const totalLength = content.length;
  if (totalLength < REPEAT_DEDUPE_MIN_BYTES) return null;

  // KMP prefix table to detect exact whole-string periodicity.
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
  if (deduped.trim().length === 0) return null;
  return { deduped, repeats };
}

function maybeCollapseByRepeatedTopHeading(content: string): { deduped: string; repeats: number } | null {
  if (content.length < HEADING_REPEAT_DEDUPE_MIN_BYTES) return null;

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
  if (deduped.trim().length === 0) return null;
  if (deduped.length < HEADING_REPEAT_MIN_SECTION_BYTES) return null;
  if (content.length - deduped.length < HEADING_REPEAT_MIN_DUPLICATED_BYTES) return null;
  return { deduped, repeats };
}

function stripLeadingPlaceholderParagraphs(content: string): { content: string; stripped: boolean } {
  if (!content) return { content, stripped: false };
  const lines = content.replace(/\r\n/g, '\n').split('\n');
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

function sanitizeRealtimeMarkdown(content: string): { content: string; repeats: number; strippedLeadingPlaceholders: boolean } {
  const stripped = stripLeadingPlaceholderParagraphs(content);
  const normalized = stripped.content;
  const exact = maybeCollapseExactWholeDocRepetition(normalized);
  if (exact) {
    return {
      content: exact.deduped,
      repeats: exact.repeats,
      strippedLeadingPlaceholders: stripped.stripped,
    };
  }
  const byHeading = maybeCollapseByRepeatedTopHeading(normalized);
  if (byHeading) {
    return {
      content: byHeading.deduped,
      repeats: byHeading.repeats,
      strippedLeadingPlaceholders: stripped.stripped,
    };
  }
  return {
    content: normalized,
    repeats: 1,
    strippedLeadingPlaceholders: stripped.stripped,
  };
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

function normalizePath(path: string): string | null {
  const normalized = normalizeSlashes(path).trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return null;

  const segments = normalized.split('/');
  const cleaned: string[] = [];
  for (const segment of segments) {
    const part = segment.trim();
    if (!part || part === '.') continue;
    if (part === '..') return null;
    cleaned.push(part);
  }

  if (cleaned.length === 0) return null;
  return cleaned.join('/');
}

function joinPath(parent: string, child: string): string {
  const parentNormalized = parent.trim().replace(/^\/+|\/+$/g, '');
  const childNormalized = child.trim().replace(/^\/+|\/+$/g, '');
  if (!parentNormalized) return childNormalized;
  if (!childNormalized) return parentNormalized;
  return `${parentNormalized}/${childNormalized}`;
}

function splitFileName(path: string): { dir: string; baseName: string; extension: string } {
  const segments = path.split('/');
  const fileName = segments.pop() ?? path;
  const dir = segments.join('/');
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) {
    return { dir, baseName: fileName, extension: '' };
  }
  return {
    dir,
    baseName: fileName.slice(0, dot),
    extension: fileName.slice(dot),
  };
}

function fileNameFromPath(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

function directoryFromPath(path: string): string {
  const segments = path.split('/');
  segments.pop();
  return segments.join('/');
}

function isPathEqualOrDescendant(parentPath: string, candidatePath: string): boolean {
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}/`);
}

function isMarkdownFilePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function categorizeFile(path: string): string {
  const lower = path.toLowerCase();
  const name = lower.split('/').pop() ?? '';
  if (name === 'readme.md' || name === 'readme.markdown') return 'readme';
  if (name.includes('prompt')) return 'prompt';
  if (name.includes('agent')) return 'agent';
  if (name.includes('claude') || name.includes('.cursorrules')) return 'claude';
  if (lower.startsWith('docs/') || lower.startsWith('doc/')) return 'docs';
  return 'other';
}

function createSiblingPath(path: string, usedPaths: Set<string>): string {
  const { dir, baseName, extension } = splitFileName(path);
  let index = 2;
  while (index < 1000) {
    const candidateName = `${baseName} (${index})${extension}`;
    const candidate = joinPath(dir, candidateName);
    if (!usedPaths.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
  return joinPath(dir, `${baseName} (${Date.now()})${extension}`);
}

function buildUndoPayload(repoId: string, entries: UndoEntry[], now: number): string | null {
  if (entries.length === 0) return null;
  const payload: UndoPayload = {
    repoId,
    createdAt: now,
    expiresAt: now + UNDO_WINDOW_MS,
    entries,
  };
  return JSON.stringify(payload);
}

function parseUndoPayload(raw: string): UndoPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<UndoPayload> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.repoId !== 'string') return null;
    if (!Number.isFinite(parsed.createdAt) || !Number.isFinite(parsed.expiresAt)) return null;
    if (!Array.isArray(parsed.entries)) return null;
    const entries: UndoEntry[] = [];
    for (const item of parsed.entries) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Partial<UndoEntry>;
      if (entry.kind === 'inserted' && typeof entry.mdFileId === 'string') {
        entries.push({ kind: 'inserted', mdFileId: entry.mdFileId });
        continue;
      }
      if (
        entry.kind === 'replaced'
        && typeof entry.mdFileId === 'string'
        && typeof (entry as Partial<ImportUndoReplacedEntry>).previousContent === 'string'
      ) {
        entries.push({
          kind: 'replaced',
          mdFileId: entry.mdFileId,
          previousContent: (entry as Partial<ImportUndoReplacedEntry>).previousContent ?? '',
        });
        continue;
      }
      if (
        entry.kind === 'path'
        && typeof entry.mdFileId === 'string'
        && typeof (entry as Partial<PathUndoEntry>).fromPath === 'string'
        && typeof (entry as Partial<PathUndoEntry>).toPath === 'string'
      ) {
        entries.push({
          kind: 'path',
          mdFileId: entry.mdFileId,
          fromPath: (entry as Partial<PathUndoEntry>).fromPath ?? '',
          toPath: (entry as Partial<PathUndoEntry>).toPath ?? '',
        });
      }
    }
    return {
      repoId: parsed.repoId,
      createdAt: Number(parsed.createdAt),
      expiresAt: Number(parsed.expiresAt),
      entries,
    };
  } catch {
    return null;
  }
}

async function upsertPendingPushQueueItem(
  ctx: MutationCtx,
  input: {
    repoId: Id<'repos'>;
    mdFileId: Id<'mdFiles'>;
    path: string;
    newContent: string;
    createdAt: number;
    branch?: string;
  },
) {
  const queued = await ctx.db
    .query('pushQueue')
    .withIndex('by_md_file', (q) => q.eq('mdFileId', input.mdFileId))
    .collect();
  const pending = queued.filter((item) => item.status === 'queued');
  if (pending.length > 0) {
    for (const item of pending) {
      await ctx.db.patch(item._id, {
        path: input.path,
        newContent: input.newContent,
        createdAt: input.createdAt,
      });
    }
    return;
  }

  await ctx.db.insert('pushQueue', {
    repoId: input.repoId,
    mdFileId: input.mdFileId,
    path: input.path,
    branch: input.branch,
    newContent: input.newContent,
    authorLogins: [],
    authorEmails: [],
    status: 'queued',
    createdAt: input.createdAt,
  });
}

async function patchPendingQueuePath(
  ctx: MutationCtx,
  mdFileId: Id<'mdFiles'>,
  nextPath: string,
) {
  const queued = await ctx.db
    .query('pushQueue')
    .withIndex('by_md_file', (q) => q.eq('mdFileId', mdFileId))
    .collect();
  for (const item of queued) {
    if (item.status !== 'queued') continue;
    await ctx.db.patch(item._id, { path: nextPath });
  }
}

interface PathRewriteEntry {
  mdFileId: Id<'mdFiles'>;
  fromPath: string;
  toPath: string;
}

function buildPathRewritePlan(
  repoFiles: Array<{
    _id: Id<'mdFiles'>;
    path: string;
    isDeleted: boolean;
  }>,
  fromPath: string,
  rootToPath: string,
  conflictMode: ConflictMode,
): { ok: true; entries: PathRewriteEntry[]; isDirectory: boolean } | { ok: false; reason: string } {
  const active = repoFiles.filter((file) => !file.isDeleted);
  const sourceFile = active.find((file) => file.path === fromPath) ?? null;
  const descendants = active.filter((file) => file.path.startsWith(`${fromPath}/`));
  const isDirectory = !sourceFile && descendants.length > 0;
  const moveFiles = isDirectory ? descendants : (sourceFile ? [sourceFile] : []);
  if (moveFiles.length === 0) {
    return { ok: false, reason: 'Path not found.' };
  }

  if (isDirectory && isPathEqualOrDescendant(fromPath, rootToPath)) {
    return { ok: false, reason: 'Cannot move a folder inside itself.' };
  }
  if (!isDirectory && sourceFile && sourceFile.path === rootToPath) {
    return { ok: false, reason: 'Path unchanged.' };
  }
  if (isDirectory && fromPath === rootToPath) {
    return { ok: false, reason: 'Path unchanged.' };
  }

  const movingPathSet = new Set(moveFiles.map((file) => file.path));
  const occupiedPaths = new Set(active.map((file) => file.path));
  for (const path of movingPathSet) {
    occupiedPaths.delete(path);
  }

  const entries: PathRewriteEntry[] = [];
  if (!isDirectory && sourceFile) {
    let nextPath = rootToPath;
    if (occupiedPaths.has(nextPath)) {
      if (conflictMode === 'keep_both') {
        nextPath = createSiblingPath(nextPath, occupiedPaths);
      } else {
        return { ok: false, reason: `Destination already exists: ${nextPath}` };
      }
    }
    entries.push({
      mdFileId: sourceFile._id,
      fromPath: sourceFile.path,
      toPath: nextPath,
    });
    return { ok: true, entries, isDirectory: false };
  }

  // Folder move/rename: explicit collision handling; no implicit merge.
  for (const file of moveFiles) {
    const suffix = file.path.slice(fromPath.length).replace(/^\//, '');
    const nextPath = suffix ? joinPath(rootToPath, suffix) : rootToPath;
    if (occupiedPaths.has(nextPath)) {
      return { ok: false, reason: `Destination already exists: ${nextPath}` };
    }
    entries.push({
      mdFileId: file._id,
      fromPath: file.path,
      toPath: nextPath,
    });
  }

  return { ok: true, entries, isDirectory: true };
}

export const listByRepo = internalQuery({
  args: {
    repoId: v.id('repos'),
    branch: v.optional(v.string()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeDeleted = args.includeDeleted ?? false;

    if (args.branch !== undefined) {
      const rows = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', args.branch))
        .collect();

      // Also include legacy records (branch=undefined) if targeting default branch
      const repo = await ctx.db.get(args.repoId);
      const isDefaultBranch = repo && args.branch === repo.defaultBranch;
      let merged = rows;
      if (isDefaultBranch) {
        const legacy = await ctx.db
          .query('mdFiles')
          .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', undefined))
          .collect();
        const explicitPaths = new Set(rows.map((r) => r.path));
        merged = [...rows, ...legacy.filter((r) => !explicitPaths.has(r.path))];
      }

      return merged
        .filter((row) => includeDeleted || !row.isDeleted)
        .sort((a, b) => a.path.localeCompare(b.path));
    }

    const rows = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect();

    return rows
      .filter((row) => includeDeleted || !row.isDeleted)
      .sort((a, b) => a.path.localeCompare(b.path));
  },
});

export const listByRepoMeta = internalQuery({
  args: {
    repoId: v.id('repos'),
    branch: v.optional(v.string()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeDeleted = args.includeDeleted ?? false;

    let rows;
    if (args.branch !== undefined) {
      rows = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', args.branch))
        .collect();

      const repo = await ctx.db.get(args.repoId);
      const isDefaultBranch = repo && args.branch === repo.defaultBranch;
      if (isDefaultBranch) {
        const legacy = await ctx.db
          .query('mdFiles')
          .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', undefined))
          .collect();
        const explicitPaths = new Set(rows.map((r) => r.path));
        rows = [...rows, ...legacy.filter((r) => !explicitPaths.has(r.path))];
      }
    } else {
      rows = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
        .collect();
    }

    return rows
      .filter((row) => includeDeleted || !row.isDeleted)
      .map((row) => ({
        mdFileId: row._id,
        path: row.path,
        contentBytes: markdownByteLength(row.content),
        contentHash: row.contentHash,
        isOversized: row.isOversized ?? false,
        lastOversizeBytes: row.lastOversizeBytes ?? null,
        oversizeUpdatedAt: row.oversizeUpdatedAt ?? null,
        editHeartbeat: row.editHeartbeat ?? null,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  },
});

export const get = internalQuery({
  args: { mdFileId: v.id('mdFiles') },
  handler: async (ctx, args) => {
    return ctx.db.get(args.mdFileId);
  },
});

export const getGithubSha = internalQuery({
  args: { mdFileId: v.id('mdFiles') },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file) return null;
    return { lastGithubSha: file.lastGithubSha, repoId: file.repoId as string };
  },
});

export const resolveByPath = internalQuery({
  args: {
    repoId: v.id('repos'),
    path: v.string(),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.branch !== undefined) {
      const hit = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_branch_path', (q) => q.eq('repoId', args.repoId).eq('branch', args.branch).eq('path', args.path))
        .first();
      if (hit && !hit.isDeleted) return hit;

      // Check legacy records (branch=undefined) for default branch
      const repo = await ctx.db.get(args.repoId);
      if (repo && args.branch === repo.defaultBranch) {
        const legacy = await ctx.db
          .query('mdFiles')
          .withIndex('by_repo_branch_path', (q) => q.eq('repoId', args.repoId).eq('branch', undefined).eq('path', args.path))
          .first();
        if (legacy && !legacy.isDeleted) return legacy;
      }
      return null;
    }

    const hit = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo_and_path', (q) => q.eq('repoId', args.repoId).eq('path', args.path))
      .first();

    if (!hit || hit.isDeleted) return null;
    return hit;
  },
});

export const resolveByPathMeta = internalQuery({
  args: {
    repoId: v.id('repos'),
    path: v.string(),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let hit;
    if (args.branch !== undefined) {
      hit = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_branch_path', (q) => q.eq('repoId', args.repoId).eq('branch', args.branch).eq('path', args.path))
        .first();
      if (!hit || hit.isDeleted) {
        const repo = await ctx.db.get(args.repoId);
        if (repo && args.branch === repo.defaultBranch) {
          hit = await ctx.db
            .query('mdFiles')
            .withIndex('by_repo_branch_path', (q) => q.eq('repoId', args.repoId).eq('branch', undefined).eq('path', args.path))
            .first();
        }
      }
    } else {
      hit = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_and_path', (q) => q.eq('repoId', args.repoId).eq('path', args.path))
        .first();
    }

    if (!hit || hit.isDeleted) return null;

    return {
      mdFileId: hit._id,
      path: hit.path,
      contentBytes: markdownByteLength(hit.content),
      contentHash: hit.contentHash,
      isOversized: hit.isOversized ?? false,
      lastOversizeBytes: hit.lastOversizeBytes ?? null,
      oversizeUpdatedAt: hit.oversizeUpdatedAt ?? null,
      editHeartbeat: hit.editHeartbeat ?? null,
    };
  },
});

export const upsertFromSync = internalMutation({
  args: {
    repoId: v.id('repos'),
    path: v.string(),
    branch: v.optional(v.string()),
    content: v.string(),
    githubSha: v.string(),
    fileCategory: v.string(),
    sizeBytes: v.number(),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Look up existing file by branch-scoped index when branch is provided
    let existing = args.branch !== undefined
      ? await ctx.db
          .query('mdFiles')
          .withIndex('by_repo_branch_path', (q) => q.eq('repoId', args.repoId).eq('branch', args.branch).eq('path', args.path))
          .first()
      : null;

    // Check legacy records (branch=undefined) for default branch
    if (!existing && args.branch !== undefined) {
      const repo = await ctx.db.get(args.repoId);
      if (repo && args.branch === repo.defaultBranch) {
        existing = await ctx.db
          .query('mdFiles')
          .withIndex('by_repo_branch_path', (q) => q.eq('repoId', args.repoId).eq('branch', undefined).eq('path', args.path))
          .first();
      }
    }

    // Fallback: if no branch provided, use the old index
    if (!existing && args.branch === undefined) {
      existing = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_and_path', (q) => q.eq('repoId', args.repoId).eq('path', args.path))
        .first();
    }

    const syntax = detectUnsupportedSyntax(args.content);
    const now = Date.now();

    if (existing) {
      const localDriftedFromGithub = hasMeaningfulDiff(existing.content, args.content);
      // Git-like safety: never overwrite local pending edits during sync.
      const queuedForThisFile = await ctx.db
        .query('pushQueue')
        .withIndex('by_md_file', (q) => q.eq('mdFileId', existing._id))
        .collect();
      const hasPendingLocalChanges = queuedForThisFile.some((item) => item.status === 'queued');

      // If SHA didn't change and file is healthy, skip.
      if (existing.lastGithubSha === args.githubSha && !existing.isDeleted && !localDriftedFromGithub) {
        return { id: existing._id, skipped: false };
      }

      if (hasPendingLocalChanges && localDriftedFromGithub) {
        if (args.force) {
          // Force sync: cancel pending push queue entries and proceed with overwrite
          for (const item of queuedForThisFile) {
            if (item.status === 'queued') {
              await ctx.db.patch(item._id, { status: 'pushed', commitSha: 'force-synced' });
            }
          }
        } else {
          return { id: existing._id, skipped: true };
        }
      }

      await ctx.db.patch(existing._id, {
        content: args.content,
        contentHash: hashContent(args.content),
        lastGithubSha: args.githubSha,
        fileCategory: args.fileCategory,
        sizeBytes: args.sizeBytes,
        isDeleted: false,
        deletedAt: undefined,
        lastSyncedAt: now,
        yjsStateStorageId: undefined,
        syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
        syntaxSupportReasons: syntax.reasons,
        isOversized: false,
        lastOversizeBytes: undefined,
        oversizeUpdatedAt: undefined,
        // Upgrade legacy records to have explicit branch
        ...(args.branch !== undefined && existing.branch === undefined ? { branch: args.branch } : {}),
      });
      return { id: existing._id, skipped: false };
    }

    const newId = await ctx.db.insert('mdFiles', {
      repoId: args.repoId,
      path: args.path,
      branch: args.branch,
      content: args.content,
      contentHash: hashContent(args.content),
      lastGithubSha: args.githubSha,
      fileCategory: args.fileCategory,
      sizeBytes: args.sizeBytes,
      isDeleted: false,
      lastSyncedAt: now,
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
      isOversized: false,
    });
    return { id: newId, skipped: false };
  },
});

export const markMissingAsDeleted = internalMutation({
  args: {
    repoId: v.id('repos'),
    branch: v.optional(v.string()),
    existingPaths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    let allFiles;
    if (args.branch !== undefined) {
      allFiles = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', args.branch))
        .collect();

      // Include legacy records (branch=undefined) for default branch
      const repo = await ctx.db.get(args.repoId);
      if (repo && args.branch === repo.defaultBranch) {
        const legacy = await ctx.db
          .query('mdFiles')
          .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', undefined))
          .collect();
        const explicitIds = new Set(allFiles.map((f) => f._id));
        allFiles = [...allFiles, ...legacy.filter((f) => !explicitIds.has(f._id))];
      }
    } else {
      allFiles = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
        .collect();
    }
    const queuedItems = await ctx.db
      .query('pushQueue')
      .withIndex('by_repo_and_status', (q) => q.eq('repoId', args.repoId).eq('status', 'queued'))
      .collect();

    const pathSet = new Set(args.existingPaths);
    // Group queued pushQueue items by mdFileId for cleanup
    const queuedItemsByFile = new Map<string, typeof queuedItems>();
    for (const item of queuedItems) {
      const key = item.mdFileId as string;
      if (!queuedItemsByFile.has(key)) queuedItemsByFile.set(key, []);
      queuedItemsByFile.get(key)!.push(item);
    }
    const now = Date.now();
    let deletedCount = 0;
    let cancelledQueueCount = 0;
    let preservedLocalOnlyCount = 0;

    for (const file of allFiles) {
      if (file.isDeleted || pathSet.has(file.path)) continue;

      if (file.lastGithubSha.startsWith('local_')) {
        preservedLocalOnlyCount += 1;
        continue;
      }

      await ctx.db.patch(file._id, { isDeleted: true, deletedAt: now });
      deletedCount += 1;

      // Clean up orphaned pushQueue entries for the deleted file
      const orphanedItems = queuedItemsByFile.get(file._id as string) ?? [];
      for (const item of orphanedItems) {
        await ctx.db.patch(item._id, {
          status: 'pushed',
          commitSha: 'sync_deleted',
          pushedAt: now,
        });
        cancelledQueueCount += 1;
      }
    }

    return {
      deletedCount,
      cancelledQueueCount,
      preservedLocalOnlyCount,
    };
  },
});

export const saveSource = internalMutation({
  args: {
    mdFileId: v.id('mdFiles'),
    sourceContent: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) {
      throw new Error('Cannot save source for missing or deleted file');
    }

    if (!hasMeaningfulDiff(args.sourceContent, file.content)) {
      return { changed: false };
    }

    const existingBytes = new TextEncoder().encode(file.content).byteLength;
    const incomingBytes = new TextEncoder().encode(args.sourceContent).byteLength;
    if (shouldRejectSuspiciousShrink(existingBytes, incomingBytes)) {
      await ctx.db.insert('activities', {
        repoId: file.repoId,
        mdFileId: file._id,
        actorId: 'system',
        type: 'shrink_blocked',
        summary: `Blocked suspicious content shrink for ${file.path} (${existingBytes}B → ${incomingBytes}B)`,
        filePath: file.path,
        createdAt: Date.now(),
      });
      return { changed: false };
    }

    const now = Date.now();
    const syntax = detectUnsupportedSyntax(args.sourceContent);

    await ctx.db.patch(args.mdFileId, {
      content: args.sourceContent,
      contentHash: hashContent(args.sourceContent),
      // Source mode is canonical markdown; rich snapshot is stale.
      yjsStateStorageId: undefined,
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
      lastSyncedAt: now,
      isOversized: false,
      lastOversizeBytes: undefined,
      oversizeUpdatedAt: undefined,
    });

    await ctx.db.insert('pushQueue', {
      repoId: file.repoId,
      mdFileId: file._id,
      path: file.path,
      branch: file.branch,
      newContent: args.sourceContent,
      authorLogins: [],
      authorEmails: [],
      status: 'queued',
      createdAt: now,
    });

    await ctx.db.insert('activities', {
      repoId: file.repoId,
      mdFileId: file._id,
      actorId: 'local-user',
      type: 'source_saved',
      summary: `Source saved for ${file.path}`,
      filePath: file.path,
      createdAt: now,
    });

    return { changed: true };
  },
});

export const revertToGithub = internalMutation({
  args: {
    mdFileId: v.id('mdFiles'),
    githubContent: v.string(),
    githubSha: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) {
      throw new Error('Cannot revert missing or deleted file');
    }

    const now = Date.now();

    // Cancel all pending pushQueue entries for this file
    const queuedItems = await ctx.db
      .query('pushQueue')
      .withIndex('by_md_file', (q) => q.eq('mdFileId', args.mdFileId))
      .collect();
    for (const item of queuedItems) {
      if (item.status !== 'queued') continue;
      await ctx.db.patch(item._id, {
        status: 'pushed',
        commitSha: 'reverted',
        pushedAt: now,
      });
    }

    // Patch file to GitHub state
    const syntax = detectUnsupportedSyntax(args.githubContent);
    await ctx.db.patch(args.mdFileId, {
      content: args.githubContent,
      contentHash: hashContent(args.githubContent),
      lastGithubSha: args.githubSha,
      yjsStateStorageId: undefined,
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
      lastSyncedAt: now,
      isOversized: false,
      lastOversizeBytes: undefined,
      oversizeUpdatedAt: undefined,
    });

    await ctx.db.insert('activities', {
      repoId: file.repoId,
      mdFileId: file._id,
      actorId: 'local-user',
      type: 'reverted_to_github',
      summary: `Reverted to GitHub version for ${file.path}`,
      filePath: file.path,
      createdAt: now,
    });
  },
});

export const importLocalBatch = internalMutation({
  args: {
    repoId: v.id('repos'),
    branch: v.optional(v.string()),
    files: v.array(v.object({
      relativePath: v.string(),
      targetPath: v.optional(v.string()),
      content: v.string(),
      conflictMode: v.optional(v.union(v.literal('keep_both'), v.literal('replace'))),
    })),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repoId);
    if (!repo) {
      throw new Error('Repo not found');
    }

    let repoFiles;
    if (args.branch !== undefined) {
      repoFiles = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', args.branch))
        .collect();
      const isDefaultBranch = args.branch === repo.defaultBranch;
      if (isDefaultBranch) {
        const legacy = await ctx.db
          .query('mdFiles')
          .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', undefined))
          .collect();
        const explicitIds = new Set(repoFiles.map((f) => f._id));
        repoFiles = [...repoFiles, ...legacy.filter((f) => !explicitIds.has(f._id))];
      }
    } else {
      repoFiles = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
        .collect();
    }

    const now = Date.now();
    const activeByPath = new Map<string, (typeof repoFiles)[number]>();
    const deletedByPath = new Map<string, (typeof repoFiles)[number]>();
    for (const file of repoFiles) {
      if (file.isDeleted) {
        if (!deletedByPath.has(file.path)) {
          deletedByPath.set(file.path, file);
        }
        continue;
      }
      if (!activeByPath.has(file.path)) {
        activeByPath.set(file.path, file);
      }
    }
    const activePaths = new Set(activeByPath.keys());
    const undoEntries: UndoEntry[] = [];
    const createdOrUpdatedPaths: string[] = [];
    const invalidRows: string[] = [];

    let imported = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    let invalid = 0;
    let autoRenamed = 0;
    let undoUnsupportedCount = 0;

    for (const row of args.files) {
      const requestedTarget = normalizePath(row.targetPath ?? row.relativePath);
      if (!requestedTarget || !isMarkdownFilePath(requestedTarget)) {
        invalid += 1;
        invalidRows.push(row.relativePath);
        continue;
      }

      const conflictMode: ConflictMode = row.conflictMode === 'replace' ? 'replace' : 'keep_both';
      let targetPath = requestedTarget;
      if (activePaths.has(targetPath) && conflictMode === 'keep_both') {
        targetPath = createSiblingPath(targetPath, activePaths);
        autoRenamed += 1;
      }

      const existingActive = activeByPath.get(targetPath) ?? null;
      const sourceContent = row.content.replace(/\r\n/g, '\n');
      const sourceHash = hashContent(sourceContent);
      const syntax = detectUnsupportedSyntax(sourceContent);
      const fileCategory = categorizeFile(targetPath);
      const sourceBytes = markdownByteLength(sourceContent);

      if (existingActive) {
        if (!hasMeaningfulDiff(sourceContent, existingActive.content)) {
          unchanged += 1;
          continue;
        }

        if (markdownByteLength(existingActive.content) <= UNDO_MAX_RESTORABLE_CONTENT_BYTES) {
          undoEntries.push({
            kind: 'replaced',
            mdFileId: existingActive._id,
            previousContent: existingActive.content,
          });
        } else {
          undoUnsupportedCount += 1;
        }

        await ctx.db.patch(existingActive._id, {
          content: sourceContent,
          contentHash: sourceHash,
          fileCategory,
          sizeBytes: sourceBytes,
          isDeleted: false,
          deletedAt: undefined,
          lastSyncedAt: now,
          editHeartbeat: now,
          yjsStateStorageId: undefined,
          pendingGithubContent: sourceContent,
          pendingGithubSha: sourceHash,
          syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
          syntaxSupportReasons: syntax.reasons,
          isOversized: false,
          lastOversizeBytes: undefined,
          oversizeUpdatedAt: undefined,
        });

        await upsertPendingPushQueueItem(ctx, {
          repoId: args.repoId,
          mdFileId: existingActive._id,
          path: targetPath,
          newContent: sourceContent,
          createdAt: now,
          branch: args.branch,
        });

        updated += 1;
        createdOrUpdatedPaths.push(targetPath);
        activePaths.add(targetPath);
        activeByPath.set(targetPath, {
          ...existingActive,
          content: sourceContent,
          contentHash: sourceHash,
          fileCategory,
          sizeBytes: sourceBytes,
          isDeleted: false,
        });
        continue;
      }

      const existingDeleted = deletedByPath.get(targetPath) ?? null;
      if (existingDeleted) {
        await ctx.db.patch(existingDeleted._id, {
          content: sourceContent,
          contentHash: sourceHash,
          fileCategory,
          sizeBytes: sourceBytes,
          isDeleted: false,
          deletedAt: undefined,
          lastSyncedAt: now,
          editHeartbeat: now,
          yjsStateStorageId: undefined,
          pendingGithubContent: sourceContent,
          pendingGithubSha: sourceHash,
          syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
          syntaxSupportReasons: syntax.reasons,
          isOversized: false,
          lastOversizeBytes: undefined,
          oversizeUpdatedAt: undefined,
          lastGithubSha: existingDeleted.lastGithubSha || `local_${sourceHash}`,
        });

        await upsertPendingPushQueueItem(ctx, {
          repoId: args.repoId,
          mdFileId: existingDeleted._id,
          path: targetPath,
          newContent: sourceContent,
          createdAt: now,
          branch: args.branch,
        });

        undoEntries.push({
          kind: 'inserted',
          mdFileId: existingDeleted._id,
        });

        imported += 1;
        createdOrUpdatedPaths.push(targetPath);
        activePaths.add(targetPath);
        activeByPath.set(targetPath, {
          ...existingDeleted,
          path: targetPath,
          content: sourceContent,
          contentHash: sourceHash,
          fileCategory,
          sizeBytes: sourceBytes,
          isDeleted: false,
        });
        deletedByPath.delete(targetPath);
        continue;
      }

      const mdFileId = await ctx.db.insert('mdFiles', {
        repoId: args.repoId,
        path: targetPath,
        branch: args.branch,
        content: sourceContent,
        contentHash: sourceHash,
        lastGithubSha: `local_${sourceHash}`,
        fileCategory,
        sizeBytes: sourceBytes,
        isDeleted: false,
        lastSyncedAt: now,
        editHeartbeat: now,
        pendingGithubContent: sourceContent,
        pendingGithubSha: sourceHash,
        syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
        syntaxSupportReasons: syntax.reasons,
        isOversized: false,
      });

      await upsertPendingPushQueueItem(ctx, {
        repoId: args.repoId,
        mdFileId,
        path: targetPath,
        newContent: sourceContent,
        createdAt: now,
        branch: args.branch,
      });

      undoEntries.push({
        kind: 'inserted',
        mdFileId,
      });

      imported += 1;
      createdOrUpdatedPaths.push(targetPath);
      activePaths.add(targetPath);
      activeByPath.set(targetPath, {
        _id: mdFileId,
        _creationTime: now,
        repoId: args.repoId,
        path: targetPath,
        content: sourceContent,
        contentHash: sourceHash,
        lastGithubSha: `local_${sourceHash}`,
        fileCategory,
        sizeBytes: sourceBytes,
        isDeleted: false,
        lastSyncedAt: now,
      });
    }

    const changedCount = imported + updated;
    if (changedCount > 0) {
      const summary = [
        `Imported local markdown files (${imported} new`,
        `${updated} replaced`,
        `${autoRenamed} keep-both`,
        `${unchanged} unchanged`,
        `${invalid} invalid).`,
      ].join(', ');
      await ctx.db.insert('activities', {
        repoId: args.repoId,
        actorId: 'local-user',
        type: 'source_saved',
        summary,
        createdAt: now,
      });
    }

    const undoPayload = buildUndoPayload(args.repoId, undoEntries, now);
    return {
      ok: true,
      imported,
      updated,
      unchanged,
      skipped,
      invalid,
      autoRenamed,
      undoUnsupportedCount,
      createdOrUpdatedPaths,
      invalidRows,
      firstPath: createdOrUpdatedPaths[0] ?? null,
      undoPayload,
      undoExpiresAt: undoPayload ? now + UNDO_WINDOW_MS : null,
    };
  },
});

export const movePath = internalMutation({
  args: {
    repoId: v.id('repos'),
    fromPath: v.string(),
    toDirectoryPath: v.optional(v.string()),
    conflictMode: v.optional(v.union(v.literal('keep_both'), v.literal('replace'))),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fromPath = normalizePath(args.fromPath);
    if (!fromPath) {
      return { ok: false, reason: 'Invalid source path.' as const };
    }

    const toDirectoryPath = args.toDirectoryPath ? normalizePath(args.toDirectoryPath) ?? '' : '';
    const nextRoot = normalizePath(joinPath(toDirectoryPath, fileNameFromPath(fromPath)));
    if (!nextRoot) {
      return { ok: false, reason: 'Invalid destination path.' as const };
    }

    let repoFiles;
    if (args.branch !== undefined) {
      repoFiles = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', args.branch))
        .collect();
      const repo = await ctx.db.get(args.repoId);
      if (repo && args.branch === repo.defaultBranch) {
        const legacy = await ctx.db
          .query('mdFiles')
          .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', undefined))
          .collect();
        const explicitIds = new Set(repoFiles.map((f) => f._id));
        repoFiles = [...repoFiles, ...legacy.filter((f) => !explicitIds.has(f._id))];
      }
    } else {
      repoFiles = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
        .collect();
    }

    const conflictMode: ConflictMode = args.conflictMode === 'replace' ? 'replace' : 'keep_both';
    const plan = buildPathRewritePlan(repoFiles, fromPath, nextRoot, conflictMode);
    if (!plan.ok) {
      return { ok: false, reason: plan.reason };
    }

    const now = Date.now();
    const undoEntries: UndoEntry[] = [];
    for (const entry of plan.entries) {
      await ctx.db.patch(entry.mdFileId, {
        path: entry.toPath,
        editHeartbeat: now,
      });
      await patchPendingQueuePath(ctx, entry.mdFileId, entry.toPath);
      undoEntries.push({
        kind: 'path',
        mdFileId: entry.mdFileId,
        fromPath: entry.fromPath,
        toPath: entry.toPath,
      });
    }

    await ctx.db.insert('activities', {
      repoId: args.repoId,
      actorId: 'local-user',
      type: 'source_saved',
      summary: `Moved ${plan.isDirectory ? 'folder' : 'file'} ${fromPath} -> ${nextRoot} (${plan.entries.length} path${plan.entries.length === 1 ? '' : 's'})`,
      filePath: fromPath,
      createdAt: now,
    });

    const undoPayload = buildUndoPayload(args.repoId, undoEntries, now);
    return {
      ok: true,
      movedCount: plan.entries.length,
      fromPath,
      toPath: nextRoot,
      moved: plan.entries,
      undoPayload,
      undoExpiresAt: undoPayload ? now + UNDO_WINDOW_MS : null,
    };
  },
});

export const renamePath = internalMutation({
  args: {
    repoId: v.id('repos'),
    fromPath: v.string(),
    toPath: v.string(),
    conflictMode: v.optional(v.union(v.literal('keep_both'), v.literal('replace'))),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fromPath = normalizePath(args.fromPath);
    const requestedToPath = normalizePath(args.toPath);
    if (!fromPath || !requestedToPath) {
      return { ok: false, reason: 'Invalid path.' as const };
    }

    let repoFiles;
    if (args.branch !== undefined) {
      repoFiles = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', args.branch))
        .collect();
      const repo = await ctx.db.get(args.repoId);
      if (repo && args.branch === repo.defaultBranch) {
        const legacy = await ctx.db
          .query('mdFiles')
          .withIndex('by_repo_and_branch', (q) => q.eq('repoId', args.repoId).eq('branch', undefined))
          .collect();
        const explicitIds = new Set(repoFiles.map((f) => f._id));
        repoFiles = [...repoFiles, ...legacy.filter((f) => !explicitIds.has(f._id))];
      }
    } else {
      repoFiles = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
        .collect();
    }

    const sourceFile = repoFiles.find((file) => !file.isDeleted && file.path === fromPath) ?? null;
    if (sourceFile && !isMarkdownFilePath(requestedToPath)) {
      return { ok: false, reason: 'Only markdown file names are allowed.' as const };
    }

    const conflictMode: ConflictMode = args.conflictMode === 'replace' ? 'replace' : 'keep_both';
    const plan = buildPathRewritePlan(repoFiles, fromPath, requestedToPath, conflictMode);
    if (!plan.ok) {
      return { ok: false, reason: plan.reason };
    }

    const now = Date.now();
    const undoEntries: UndoEntry[] = [];
    for (const entry of plan.entries) {
      await ctx.db.patch(entry.mdFileId, {
        path: entry.toPath,
        editHeartbeat: now,
      });
      await patchPendingQueuePath(ctx, entry.mdFileId, entry.toPath);
      undoEntries.push({
        kind: 'path',
        mdFileId: entry.mdFileId,
        fromPath: entry.fromPath,
        toPath: entry.toPath,
      });
    }

    await ctx.db.insert('activities', {
      repoId: args.repoId,
      actorId: 'local-user',
      type: 'source_saved',
      summary: `Renamed ${plan.isDirectory ? 'folder' : 'file'} ${fromPath} -> ${requestedToPath} (${plan.entries.length} path${plan.entries.length === 1 ? '' : 's'})`,
      filePath: fromPath,
      createdAt: now,
    });

    const undoPayload = buildUndoPayload(args.repoId, undoEntries, now);
    return {
      ok: true,
      renamedCount: plan.entries.length,
      fromPath,
      toPath: requestedToPath,
      moved: plan.entries,
      undoPayload,
      undoExpiresAt: undoPayload ? now + UNDO_WINDOW_MS : null,
    };
  },
});

export const undoFileOperation = internalMutation({
  args: {
    repoId: v.id('repos'),
    undoPayload: v.string(),
  },
  handler: async (ctx, args) => {
    const parsed = parseUndoPayload(args.undoPayload);
    if (!parsed) {
      return { ok: false, reason: 'Invalid undo payload.' as const };
    }
    if (parsed.repoId !== args.repoId) {
      return { ok: false, reason: 'Undo payload does not match repo.' as const };
    }
    if (Date.now() > parsed.expiresAt) {
      return { ok: false, reason: 'Undo expired.' as const };
    }

    const now = Date.now();
    let restored = 0;
    let skipped = 0;

    for (const entry of parsed.entries) {
      if (entry.kind === 'inserted') {
        const file = await ctx.db.get(entry.mdFileId as Id<'mdFiles'>);
        if (!file || file.repoId !== args.repoId || file.isDeleted) {
          skipped += 1;
          continue;
        }

        await ctx.db.patch(file._id, {
          isDeleted: true,
          deletedAt: now,
          yjsStateStorageId: undefined,
        });

        const queued = await ctx.db
          .query('pushQueue')
          .withIndex('by_md_file', (q) => q.eq('mdFileId', file._id))
          .collect();
        for (const item of queued) {
          if (item.status !== 'queued') continue;
          await ctx.db.patch(item._id, {
            status: 'pushed',
            pushedAt: now,
            commitSha: 'local_undo',
          });
        }

        restored += 1;
        continue;
      }

      if (entry.kind === 'replaced') {
        const file = await ctx.db.get(entry.mdFileId as Id<'mdFiles'>);
        if (!file || file.repoId !== args.repoId || file.isDeleted) {
          skipped += 1;
          continue;
        }
        if (!hasMeaningfulDiff(entry.previousContent, file.content)) {
          skipped += 1;
          continue;
        }

        const syntax = detectUnsupportedSyntax(entry.previousContent);
        const previousHash = hashContent(entry.previousContent);
        await ctx.db.patch(file._id, {
          content: entry.previousContent,
          contentHash: previousHash,
          editHeartbeat: now,
          yjsStateStorageId: undefined,
          pendingGithubContent: entry.previousContent,
          pendingGithubSha: previousHash,
          syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
          syntaxSupportReasons: syntax.reasons,
          isOversized: false,
          lastOversizeBytes: undefined,
          oversizeUpdatedAt: undefined,
        });

        await upsertPendingPushQueueItem(ctx, {
          repoId: args.repoId,
          mdFileId: file._id,
          path: file.path,
          newContent: entry.previousContent,
          createdAt: now,
        });

        restored += 1;
        continue;
      }

      const file = await ctx.db.get(entry.mdFileId as Id<'mdFiles'>);
      if (!file || file.repoId !== args.repoId || file.isDeleted) {
        skipped += 1;
        continue;
      }
      if (file.path !== entry.toPath) {
        skipped += 1;
        continue;
      }
      const occupied = await ctx.db
        .query('mdFiles')
        .withIndex('by_repo_and_path', (q) => q.eq('repoId', args.repoId).eq('path', entry.fromPath))
        .first();
      if (occupied && occupied._id !== file._id && !occupied.isDeleted) {
        skipped += 1;
        continue;
      }

      await ctx.db.patch(file._id, {
        path: entry.fromPath,
        editHeartbeat: now,
      });
      await patchPendingQueuePath(ctx, file._id, entry.fromPath);
      restored += 1;
    }

    await ctx.db.insert('activities', {
      repoId: args.repoId,
      actorId: 'local-user',
      type: 'source_saved',
      summary: `Undo file operation restored ${restored} item(s), skipped ${skipped}.`,
      createdAt: now,
    });

    return {
      ok: true,
      restored,
      skipped,
    };
  },
});

export const repairRealtimeCorruption = internalMutation({
  args: {
    mdFileId: v.id('mdFiles'),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) {
      throw new Error('File not found');
    }

    const sanitized = sanitizeRealtimeMarkdown(file.content);
    const nextContent = sanitized.content;
    const changed = hasMeaningfulDiff(nextContent, file.content);
    const shouldClearSnapshot = !!file.yjsStateStorageId;
    if (!changed && !shouldClearSnapshot) {
      return {
        changed: false,
        repeats: sanitized.repeats,
        strippedLeadingPlaceholders: sanitized.strippedLeadingPlaceholders,
      };
    }

    const now = Date.now();
    const syntax = detectUnsupportedSyntax(nextContent);
    const nextHash = hashContent(nextContent);

    await ctx.db.patch(file._id, {
      content: nextContent,
      contentHash: nextHash,
      editHeartbeat: now,
      yjsStateStorageId: undefined,
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
      pendingGithubContent: nextContent,
      pendingGithubSha: nextHash,
      isOversized: false,
      lastOversizeBytes: undefined,
      oversizeUpdatedAt: undefined,
    });

    await ctx.db.insert('activities', {
      repoId: file.repoId,
      mdFileId: file._id,
      actorId: 'system',
      type: 'source_saved',
      summary: `Repaired realtime corruption for ${file.path}${sanitized.repeats > 1 ? ` (deduped ${sanitized.repeats}x)` : ''}`,
      filePath: file.path,
      createdAt: now,
    });

    return {
      changed: true,
      repeats: sanitized.repeats,
      strippedLeadingPlaceholders: sanitized.strippedLeadingPlaceholders,
    };
  },
});

export const dedupeRepeatedContent = internalMutation({
  args: {
    mdFileId: v.id('mdFiles'),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) {
      throw new Error('Cannot dedupe missing or deleted file');
    }

    const collapsed =
      maybeCollapseExactWholeDocRepetition(file.content) ??
      maybeCollapseByRepeatedTopHeading(file.content);
    if (!collapsed || !hasMeaningfulDiff(collapsed.deduped, file.content)) {
      return { changed: false, repeats: 1, bytesBefore: markdownByteLength(file.content), bytesAfter: markdownByteLength(file.content) };
    }

    const now = Date.now();
    const syntax = detectUnsupportedSyntax(collapsed.deduped);
    const bytesBefore = markdownByteLength(file.content);
    const bytesAfter = markdownByteLength(collapsed.deduped);

    await ctx.db.patch(file._id, {
      content: collapsed.deduped,
      contentHash: hashContent(collapsed.deduped),
      yjsStateStorageId: undefined,
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
      lastSyncedAt: now,
      isOversized: false,
      lastOversizeBytes: undefined,
      oversizeUpdatedAt: undefined,
    });

    const queued = await ctx.db
      .query('pushQueue')
      .withIndex('by_md_file', (q) => q.eq('mdFileId', file._id))
      .collect();
    const pending = queued.find((item) => item.status === 'queued');
    if (pending) {
      await ctx.db.patch(pending._id, {
        newContent: collapsed.deduped,
        createdAt: now,
      });
    } else {
      await ctx.db.insert('pushQueue', {
        repoId: file.repoId,
        mdFileId: file._id,
        path: file.path,
        branch: file.branch,
        newContent: collapsed.deduped,
        authorLogins: [],
        authorEmails: [],
        status: 'queued',
        createdAt: now,
      });
    }

    await ctx.db.insert('activities', {
      repoId: file.repoId,
      mdFileId: file._id,
      actorId: 'system',
      type: 'source_saved',
      summary: `Deduped repeated content for ${file.path} (${collapsed.repeats}x -> 1x)`,
      filePath: file.path,
      createdAt: now,
    });

    return {
      changed: true,
      repeats: collapsed.repeats,
      bytesBefore,
      bytesAfter,
    };
  },
});

export const contentWindow = internalQuery({
  args: {
    mdFileId: v.id('mdFiles'),
    offset: v.number(),
    length: v.number(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) return null;

    const start = Math.max(0, Math.floor(args.offset));
    const span = Math.max(0, Math.min(20000, Math.floor(args.length)));
    const end = Math.min(file.content.length, start + span);

    return {
      path: file.path,
      contentBytes: markdownByteLength(file.content),
      contentLength: file.content.length,
      start,
      end,
      snippet: file.content.slice(start, end),
    };
  },
});

export const deleteFile = internalMutation({
  args: {
    repoId: v.id('repos'),
    mdFileId: v.id('mdFiles'),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file) {
      return { ok: false, reason: 'File not found.' };
    }
    if (file.repoId !== args.repoId) {
      return { ok: false, reason: 'File does not belong to this repo.' };
    }
    if (file.isDeleted) {
      return { ok: false, reason: 'File is already deleted.' };
    }

    const now = Date.now();

    // Mark file as deleted and clear Yjs state
    await ctx.db.patch(file._id, {
      isDeleted: true,
      deletedAt: now,
      yjsStateStorageId: undefined,
      isOversized: undefined,
      lastOversizeBytes: undefined,
      oversizeUpdatedAt: undefined,
    });

    // Cancel any existing queued pushQueue entries for this file
    const queuedItems = await ctx.db
      .query('pushQueue')
      .withIndex('by_md_file', (q) => q.eq('mdFileId', file._id))
      .collect();
    for (const item of queuedItems) {
      if (item.status !== 'queued') continue;
      await ctx.db.patch(item._id, {
        status: 'pushed',
        commitSha: 'local_deleted',
        pushedAt: now,
      });
    }

    // If file has a real GitHub SHA, insert a deletion pushQueue entry
    if (!file.lastGithubSha.startsWith('local_')) {
      await ctx.db.insert('pushQueue', {
        repoId: args.repoId,
        mdFileId: file._id,
        path: file.path,
        branch: file.branch,
        newContent: '',
        isDelete: true,
        authorLogins: [],
        authorEmails: [],
        status: 'queued',
        createdAt: now,
      });
    }

    // Log activity
    await ctx.db.insert('activities', {
      repoId: args.repoId,
      mdFileId: file._id,
      actorId: 'local-user',
      type: 'source_saved',
      summary: `Deleted ${file.path}`,
      filePath: file.path,
      createdAt: now,
    });

    return { ok: true, deletedPath: file.path };
  },
});

export const restoreCanonicalClawMessengerReadme = internalMutation({
  args: {
    mdFileId: v.id('mdFiles'),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.mdFileId);
    if (!file || file.isDeleted) {
      throw new Error('Cannot restore missing or deleted file');
    }

    const now = Date.now();
    const syntax = detectUnsupportedSyntax(CLAW_MESSENGER_CANONICAL_README);

    await ctx.db.patch(file._id, {
      content: CLAW_MESSENGER_CANONICAL_README,
      contentHash: hashContent(CLAW_MESSENGER_CANONICAL_README),
      yjsStateStorageId: undefined,
      syntaxSupportStatus: syntax.supported ? 'supported' : 'unsupported',
      syntaxSupportReasons: syntax.reasons,
      lastSyncedAt: now,
      isOversized: false,
      lastOversizeBytes: undefined,
      oversizeUpdatedAt: undefined,
    });

    const queued = await ctx.db
      .query('pushQueue')
      .withIndex('by_md_file', (q) => q.eq('mdFileId', file._id))
      .collect();
    const pending = queued.filter((item) => item.status === 'queued');

    if (pending.length > 0) {
      for (const item of pending) {
        await ctx.db.patch(item._id, {
          newContent: CLAW_MESSENGER_CANONICAL_README,
          createdAt: now,
        });
      }
    } else {
      await ctx.db.insert('pushQueue', {
        repoId: file.repoId,
        mdFileId: file._id,
        path: file.path,
        branch: file.branch,
        newContent: CLAW_MESSENGER_CANONICAL_README,
        authorLogins: [],
        authorEmails: [],
        status: 'queued',
        createdAt: now,
      });
    }

    await ctx.db.insert('activities', {
      repoId: file.repoId,
      mdFileId: file._id,
      actorId: 'system',
      type: 'source_saved',
      summary: `Restored canonical README for ${file.path}`,
      filePath: file.path,
      createdAt: now,
    });

    return {
      changed: true,
      contentBytes: markdownByteLength(CLAW_MESSENGER_CANONICAL_README),
    };
  },
});
