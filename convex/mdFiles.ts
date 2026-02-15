import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

import { markdownByteLength } from './lib/collabPolicy';
import { hashContent, hasMeaningfulDiff } from './lib/markdownDiff';
import { detectUnsupportedSyntax } from './lib/syntax';

const REPEAT_DEDUPE_MIN_BYTES = 1024;
const HEADING_REPEAT_DEDUPE_MIN_BYTES = 2048;
const HEADING_REPEAT_MIN_SECTION_BYTES = 800;
const HEADING_REPEAT_MIN_DUPLICATED_BYTES = 512;

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

export const listByRepo = query({
  args: {
    repoId: v.id('repos'),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeDeleted = args.includeDeleted ?? false;

    const rows = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect();

    return rows
      .filter((row) => includeDeleted || !row.isDeleted)
      .sort((a, b) => a.path.localeCompare(b.path));
  },
});

export const listByRepoMeta = query({
  args: {
    repoId: v.id('repos'),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeDeleted = args.includeDeleted ?? false;

    const rows = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect();

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

export const get = query({
  args: { mdFileId: v.id('mdFiles') },
  handler: async (ctx, args) => {
    return ctx.db.get(args.mdFileId);
  },
});

export const resolveByPath = query({
  args: {
    repoId: v.id('repos'),
    path: v.string(),
  },
  handler: async (ctx, args) => {
    const hit = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo_and_path', (q) => q.eq('repoId', args.repoId).eq('path', args.path))
      .first();

    if (!hit || hit.isDeleted) return null;
    return hit;
  },
});

export const resolveByPathMeta = query({
  args: {
    repoId: v.id('repos'),
    path: v.string(),
  },
  handler: async (ctx, args) => {
    const hit = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo_and_path', (q) => q.eq('repoId', args.repoId).eq('path', args.path))
      .first();

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

export const upsertFromSync = mutation({
  args: {
    repoId: v.id('repos'),
    path: v.string(),
    content: v.string(),
    githubSha: v.string(),
    fileCategory: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo_and_path', (q) => q.eq('repoId', args.repoId).eq('path', args.path))
      .first();

    const syntax = detectUnsupportedSyntax(args.content);
    const now = Date.now();

    if (existing) {
      // If SHA didn't change and file is healthy, skip.
      // If local content diverged/corrupted while SHA stayed the same, force refresh from GitHub.
      const localDriftedFromGithub = hasMeaningfulDiff(existing.content, args.content);
      if (existing.lastGithubSha === args.githubSha && !existing.isDeleted && !localDriftedFromGithub) {
        return existing._id;
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
      });
      return existing._id;
    }

    return await ctx.db.insert('mdFiles', {
      repoId: args.repoId,
      path: args.path,
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
  },
});

export const markMissingAsDeleted = mutation({
  args: {
    repoId: v.id('repos'),
    existingPaths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const allFiles = await ctx.db
      .query('mdFiles')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect();

    const pathSet = new Set(args.existingPaths);
    const now = Date.now();

    for (const file of allFiles) {
      if (!file.isDeleted && !pathSet.has(file.path)) {
        await ctx.db.patch(file._id, { isDeleted: true, deletedAt: now });
      }
    }
  },
});

export const saveSource = mutation({
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

export const repairRealtimeCorruption = mutation({
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

export const dedupeRepeatedContent = mutation({
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

export const contentWindow = query({
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

export const restoreCanonicalClawMessengerReadme = mutation({
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
