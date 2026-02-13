# with.md — Unified Implementation Plan (Backend + Frontend MVP)

This plan is designed for one-pass agentic execution. It contains everything needed to build the complete with.md product: a GitHub-synced, real-time collaborative markdown editor with WYSIWYG editing, anchored comments, suggestions, and a beautiful cinematic UI.

---

## 1. Objective

Build a desktop-first web app for filesystem-first markdown collaboration that is:
- Beautiful and calm (editorial, cinematic, graceful).
- Google Docs-style: rendered markdown by default, WYSIWYG editing on click.
- Safe for real-world markdown with an always-editable Source mode fallback.
- Git-native: manual push, re-sync, low-noise diffs, co-authored commits.
- Real-time collaborative: cursors, presence, anchored comments, queued suggestions.

---

## 2. Locked Decisions

| Decision | Choice |
|---|---|
| Push to GitHub | Manual "Push" button in web UI |
| Branch strategy | Default branch only |
| Large files (>1MB) | Store inline, fail gracefully with warning |
| Commit attribution | Bot commits with `Co-authored-by:` trailers |
| Webhook reliability | Manual "Re-sync" button in UI |
| Editing model | Two-phase: Read mode (rendered markdown) → Edit mode (TipTap WYSIWYG on click) |
| Source mode | Always editable, explicit apply/save actions |
| Comment anchoring | TipTap marks (inside CRDT doc) + metadata in Convex + fallback anchor snapshots |
| Suggestions during editing | Queued, auto-applied when editing pauses |
| CRDT | Yjs + Hocuspocus (separate server) |
| Editor | TipTap (ProseMirror-based, rich text WYSIWYG) |
| Offline / crash resilience | y-indexeddb on client |
| File viewing | Lazy Hocuspocus — rendered markdown by default, CRDT on focus |
| Notifications | In-app activity feed |
| Syntax safety gate | Unsupported markdown defaults to Source mode with warning |
| Approximate comment recovery | Acceptable when CRDT anchors are unavailable |
| MVP scope | Desktop-first (no full responsive polish), one global visual theme |

---

## 3. Architecture

```
┌──────────────┐    webhook      ┌──────────────────────────────────────┐
│   GitHub     │ ───────────────▶│  Convex                              │
│   (stores    │                 │  ┌──────────────────────────────────┐ │
│    .md files │ ◀────────────── │  │  HTTP Endpoints                  │ │
│    as plain  │   GitHub API    │  │  (webhook, collab, push)         │ │
│    markdown) │   manual push   │  └──────────────────────────────────┘ │
└──────────────┘                 │  ┌─────────────┐  ┌───────────────┐  │
        ▲                        │  │  Queries    │  │  Mutations    │  │
        │                        │  │  (reactive) │  │  (transact.)  │  │
   serialize   ┌──────────┐     │  └─────────────┘  └───────────────┘  │
   back to md  │  Web UI  │◀─WS▶│  ┌─────────────┐  ┌───────────────┐  │
        │      │  (React) │     │  │  Actions     │  │  File Storage │  │
        │      │          │◀─WS▶│  │  (GitHub API)│  │  (Yjs blobs)  │  │
        │      └────┬─────┘     │  └─────────────┘  └───────────────┘  │
        │           │ Yjs WS     └──────────────────────────────────────┘
        │           │ (lazy)
        │           ▼
        │      ┌──────────────────┐
        │      │  Hocuspocus       │
        └──────│  (Yjs CRDT server)│──── HTTP ────▶ Convex
               └──────────────────┘
```

### The conversion layer (highest-risk component)

```
INBOUND (GitHub → with.md):
  .md file ──▶ TipTap Markdown parser ──▶ ProseMirror JSON ──▶ Yjs XmlFragment

OUTBOUND (with.md → GitHub):
  Yjs XmlFragment ──▶ ProseMirror JSON ──▶ TipTap Markdown serializer ──▶ .md file
```

### Sources of truth

| What | Owner | Format | Why |
|---|---|---|---|
| Canonical file content at rest | GitHub | Raw markdown string | It's a git repo |
| Live document during editing | Hocuspocus / Yjs | ProseMirror JSON (Y.XmlFragment) | Rich text CRDT |
| Raw markdown for push-back | Convex (`mdFiles.content`) | Raw markdown string | Preserved for git fidelity |
| Collaboration metadata | Convex | Structured tables | Reactive, transactional |

---

## 4. Data Model (Convex Schema)

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ── GitHub installations ──
  installations: defineTable({
    githubInstallationId: v.number(),
    githubAccountLogin: v.string(),
    githubAccountType: v.string(),
    accessToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
  }).index("by_github_installation_id", ["githubInstallationId"]),

  // ── Tracked repositories ──
  repos: defineTable({
    installationId: v.id("installations"),
    githubRepoId: v.number(),
    owner: v.string(),
    name: v.string(),
    defaultBranch: v.string(),
    lastSyncedCommitSha: v.optional(v.string()),
    syncStatus: v.string(),
  })
    .index("by_github_repo_id", ["githubRepoId"])
    .index("by_installation", ["installationId"]),

  // ── Markdown files ──
  mdFiles: defineTable({
    repoId: v.id("repos"),
    path: v.string(),
    content: v.string(),
    contentHash: v.string(),
    lastGithubSha: v.string(),
    fileCategory: v.string(),
    sizeBytes: v.number(),
    isDeleted: v.boolean(),
    lastSyncedAt: v.number(),
    yjsStateStorageId: v.optional(v.id("_storage")),
    editHeartbeat: v.optional(v.number()),
    pendingGithubContent: v.optional(v.string()),
    pendingGithubSha: v.optional(v.string()),
  })
    .index("by_repo_and_path", ["repoId", "path"])
    .index("by_repo_and_category", ["repoId", "fileCategory"])
    .index("by_repo", ["repoId"]),

  // ── Comments (metadata — anchor lives in TipTap document as a mark) ──
  comments: defineTable({
    mdFileId: v.id("mdFiles"),
    authorId: v.id("users"),
    body: v.string(),
    commentMarkId: v.string(),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
    parentCommentId: v.optional(v.id("comments")),
    fallbackLine: v.optional(v.number()),
    // Anchor snapshot for recovery when CRDT state is lost
    anchorSnapshot: v.optional(v.object({
      textQuote: v.string(),
      prefix: v.string(),
      suffix: v.string(),
      headingPath: v.array(v.string()),
      fallbackLine: v.number(),
    })),
  })
    .index("by_md_file", ["mdFileId"])
    .index("by_parent", ["parentCommentId"])
    .index("by_comment_mark_id", ["commentMarkId"]),

  // ── Suggestions ──
  suggestions: defineTable({
    mdFileId: v.id("mdFiles"),
    commentId: v.optional(v.id("comments")),
    authorId: v.id("users"),
    status: v.string(), // "pending" | "queued" | "accepted" | "rejected" | "conflicted"
    originalText: v.string(),
    suggestedText: v.string(),
    baseContentHash: v.string(),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_md_file", ["mdFileId"])
    .index("by_md_file_and_status", ["mdFileId", "status"]),

  // ── Push queue ──
  pushQueue: defineTable({
    repoId: v.id("repos"),
    mdFileId: v.id("mdFiles"),
    path: v.string(),
    newContent: v.string(),
    authorLogins: v.array(v.string()),
    authorEmails: v.array(v.string()),
    status: v.string(),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    pushedAt: v.optional(v.number()),
    commitSha: v.optional(v.string()),
  })
    .index("by_repo_and_status", ["repoId", "status"])
    .index("by_md_file", ["mdFileId"]),

  // ── Activity feed ──
  activities: defineTable({
    repoId: v.id("repos"),
    mdFileId: v.optional(v.id("mdFiles")),
    actorId: v.id("users"),
    type: v.string(),
    targetId: v.optional(v.string()),
    summary: v.string(),
    filePath: v.optional(v.string()),
  })
    .index("by_repo", ["repoId"])
    .index("by_repo_and_type", ["repoId", "type"])
    .index("by_md_file", ["mdFileId"]),

  // ── Per-user read state for activity feed ──
  activityReadCursors: defineTable({
    userId: v.id("users"),
    repoId: v.id("repos"),
    lastReadAt: v.number(),
  })
    .index("by_user_and_repo", ["userId", "repoId"]),

  // ── Users ──
  users: defineTable({
    githubUserId: v.number(),
    githubLogin: v.string(),
    avatarUrl: v.optional(v.string()),
    email: v.optional(v.string()),
  }).index("by_github_user_id", ["githubUserId"]),
});
```

---

## 5. Frontend Data Types

```typescript
// web/src/lib/with-md/types.ts

export type DocMode = 'read' | 'edit' | 'source';

export interface DocState {
  mode: DocMode;
  syntaxSupported: boolean;
  hasDirtySourceBuffer: boolean;
  collabConnected: boolean;
}

export interface MdFile {
  mdFileId: string;
  repoId: string;
  path: string;
  content: string;
  contentHash: string;
  fileCategory: 'readme' | 'prompt' | 'agent' | 'claude' | 'docs' | 'other';
  editHeartbeat?: number;
  pendingGithubContent?: string;
}

export interface CommentAnchorSnapshot {
  commentMarkId: string;
  textQuote: string;
  prefix: string;
  suffix: string;
  headingPath: string[];
  fallbackLine: number;
}

export interface CommentRecord {
  id: string;
  mdFileId: string;
  authorId: string;
  body: string;
  resolvedAt?: number;
  resolvedBy?: string;
  parentCommentId?: string;
  anchor: CommentAnchorSnapshot;
}
```

### DocMode state machine rules

- `read -> edit` only if `syntaxSupported === true`.
- `read -> source` always allowed.
- `source` is always editable.
- `edit <-> source` allowed, but source changes require explicit apply/save action.

---

## 6. API Surface

### 6.1 Convex Queries (reactive)

| Function | Purpose |
|---|---|
| `repos.list` | Repos for current user's installations |
| `repos.get` | Single repo with sync status |
| `mdFiles.listByRepo` | Files with optional category filter |
| `mdFiles.get` | Single file with content + edit status |
| `mdFiles.getFileTree` | Path/category/ID list for tree view |
| `comments.listByFile` | Comments with author info, threaded |
| `suggestions.listByFile` | Suggestions with status filter |
| `pushQueue.listByRepo` | Push history and status |
| `pushQueue.unpushedCount` | Badge count |
| `activities.listByRepo` | Paginated activity feed |
| `activities.unreadCount` | Unread badge count |

### 6.2 Convex Mutations

| Function | Purpose |
|---|---|
| `comments.create` | Add comment (with commentMarkId link + anchor snapshot) |
| `comments.update` | Edit body |
| `comments.resolve` | Resolve thread |
| `comments.delete` | Delete + remove mark from doc |
| `suggestions.create` | Propose text replacement |
| `suggestions.accept` | Accept → apply or queue |
| `suggestions.reject` | Reject |
| `repos.track` | Start tracking a repo |
| `repos.untrack` | Stop tracking |
| `repos.resync` | Trigger manual re-sync |
| `pushQueue.pushNow` | Trigger manual push |
| `pushQueue.retry` | Retry failed push |
| `pushQueue.cancel` | Cancel queued push |
| `activities.markAsRead` | Update read cursor |

### 6.3 Convex Internal Functions

| Function | Type | Purpose |
|---|---|---|
| `collab.authenticate` | internalQuery | Verify user + repo access |
| `collab.loadDocument` | internalQuery | Return Yjs state or raw markdown |
| `collab.storeDocument` | internalMutation | Persist Yjs + update markdown + heartbeat + schedule suggestion check |
| `collab.onAllDisconnected` | internalMutation | Final persist + resolve pending GitHub + process queued suggestions |
| `suggestions.processQueuedForFile` | internalMutation | Apply queued suggestions when editing pauses |

### 6.4 Convex Actions

| Function | Purpose |
|---|---|
| `github.syncRepoFiles` | Inbound sync via GitHub API |
| `github.pushChanges` | Outbound push to GitHub |
| `github.initialSync` | Full tree scan |
| `github.refreshToken` | Refresh installation token |

### 6.5 HTTP Endpoints

| Route | Method | Source |
|---|---|---|
| `/api/github-webhook` | POST | GitHub |
| `/api/auth/github/callback` | GET | Browser |
| `/api/collab/authenticate` | POST | Hocuspocus |
| `/api/collab/loadDocument` | POST | Hocuspocus |
| `/api/collab/storeDocument` | POST | Hocuspocus |
| `/api/collab/onAllDisconnected` | POST | Hocuspocus |

---

## 7. GitHub Synchronization

### 7.1 Inbound: GitHub → Convex (Webhook)

```
GitHub push event arrives:
  1. Validate HMAC-SHA256 signature
  2. Extract changed .md file paths
  3. For each changed .md file:
     a. Is file actively being edited? (editHeartbeat fresh)
        YES → store in pendingGithubContent/pendingGithubSha, show banner
        NO  → upsert mdFile.content (raw markdown), update contentHash/lastGithubSha
              Delete yjsStateStorageId (stale — next editor open will re-bootstrap)
  4. For removed files: set isDeleted = true
  5. Update repo.lastSyncedCommitSha
```

### 7.2 Deferred change resolution

When all editors disconnect from a file with `pendingGithubContent`, editor's version wins. The `markdownContent` from Hocuspocus's `onAllDisconnected` is used as the new `mdFile.content`.

### 7.3 Outbound: Manual Push

```
User clicks "Push to GitHub":
  1. Mutation validates queued items, schedules action
  2. Action collects queued pushQueue items
  3. Uses mdFile.content (raw markdown) for each file — NOT the Yjs state
  4. Creates blobs → tree → commit with Co-authored-by trailers
  5. Updates branch reference
  6. Marks items pushed/failed, creates activity entries
```

**Critical: push uses `mdFile.content`, not a live serialization.** The `content` field is updated by Hocuspocus's `onStoreDocument` hook (debounced) with the serialized markdown.

### 7.4 Re-sync (Manual)

Full tree scan via GitHub Trees API. User clicks "Re-sync" button.

---

## 8. Hocuspocus Server

```typescript
// hocuspocus-server/index.ts
import { Server } from "@hocuspocus/server";
import * as Y from "yjs";

const CONVEX_HTTP = process.env.CONVEX_HTTP_URL!;
const INTERNAL_SECRET = process.env.HOCUSPOCUS_CONVEX_SECRET!;

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${INTERNAL_SECRET}`,
};

async function convexCall(path: string, body: object) {
  const res = await fetch(`${CONVEX_HTTP}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Convex ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

const server = new Server({
  port: Number(process.env.PORT) || 3001,
  debounce: 3000,
  maxDebounce: 10000,
  timeout: 30000,

  async onAuthenticate({ token, documentName }) {
    return await convexCall("/api/collab/authenticate", {
      userToken: token,
      mdFileId: documentName,
    });
  },

  async onLoadDocument({ documentName, document }) {
    const data = await convexCall("/api/collab/loadDocument", {
      mdFileId: documentName,
    });

    if (data.yjsState) {
      try {
        const update = Uint8Array.from(Buffer.from(data.yjsState, "base64"));
        Y.applyUpdate(document, update);
      } catch (e) {
        console.error(`Corrupted Yjs state for ${documentName}, bootstrapping`, e);
        bootstrapFromMarkdown(document, data.markdownContent ?? "");
      }
    } else {
      bootstrapFromMarkdown(document, data.markdownContent ?? "");
    }
  },

  async onStoreDocument({ documentName, document }) {
    const markdownContent = serializeToMarkdown(document);
    const yjsState = Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");

    await convexCall("/api/collab/storeDocument", {
      mdFileId: documentName,
      markdownContent,
      yjsState,
    });
  },

  async onDisconnect({ documentName, document }) {
    if (document.getConnectionsCount() === 0) {
      const markdownContent = serializeToMarkdown(document);
      const yjsState = Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");

      await convexCall("/api/collab/onAllDisconnected", {
        mdFileId: documentName,
        markdownContent,
        yjsState,
      });
    }
  },
});

server.listen();
```

### Bootstrap and serialization helpers

```typescript
// hocuspocus-server/bootstrap.ts + serialize.ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

// These run on the Hocuspocus server (Node.js) — headless TipTap, no DOM

function bootstrapFromMarkdown(ydoc: Y.Doc, markdown: string) {
  const editor = new Editor({
    extensions: [StarterKit, Markdown],
    content: markdown,
    contentType: "markdown",
  });
  const json = editor.getJSON();
  editor.destroy();

  const fragment = ydoc.getXmlFragment("default");
  applyProseMirrorJsonToYFragment(fragment, json);
}

function serializeToMarkdown(ydoc: Y.Doc): string {
  const fragment = ydoc.getXmlFragment("default");
  const json = yFragmentToProseMirrorJson(fragment);

  const editor = new Editor({
    extensions: [StarterKit, Markdown],
    content: json,
  });
  const md = editor.getMarkdown();
  editor.destroy();
  return md;
}
```

---

## 9. Comments

### 9.1 Dual storage architecture

1. **Anchor** (in TipTap/Yjs document): a `comment` mark on the text range, carrying a unique `commentMarkId`. Part of the CRDT, survives edits, syncs to all editors.
2. **Metadata** (in Convex): author, body, resolved status, thread. Linked via `commentMarkId`.
3. **Anchor snapshot** (in Convex): `textQuote`, `prefix`, `suffix`, `headingPath`, `fallbackLine` for recovery when CRDT state is lost.

### 9.2 Creating a comment

```
1. User selects text in TipTap editor
2. Frontend applies a comment mark to the selection:
   editor.chain()
     .setMark('comment', { commentMarkId: generateId() })
     .run()
3. Frontend captures anchor snapshot:
   - selected quote text
   - 32-char prefix and suffix context
   - heading path at selection
   - fallback line number
4. Frontend calls Convex mutation comments.create with:
   - mdFileId, body, commentMarkId, authorId, anchorSnapshot
5. Mark syncs to all editors via Yjs (immediate)
6. Comment metadata appears in sidebar via Convex reactive query
```

### 9.3 TipTap comment mark extension

```typescript
import { Mark } from '@tiptap/core';

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false, // typing at boundary doesn't extend the comment (Peritext behavior)
  addAttributes() {
    return {
      commentMarkId: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      {
        'data-comment-id': HTMLAttributes.commentMarkId,
        class: 'withmd-comment-highlight',
      },
      0,
    ];
  },
});
```

### 9.4 Displaying comments

**In Read mode** (no Hocuspocus): Comments displayed in sidebar, positioned by `fallbackLine`. No text highlights.

**In Edit mode** (TipTap active): Comment marks visible as highlights. Clicking a highlight opens the thread in sidebar. Clicking a sidebar comment scrolls to and highlights the marked text.

### 9.5 Resolving / deleting comments

- **Resolve**: Update Convex record (`resolvedAt`, `resolvedBy`). Mark stays in doc but renders dimmed.
- **Delete**: Remove Convex record + remove mark: `editor.chain().unsetMark('comment', { commentMarkId }).run()`

### 9.6 Anchor recovery (when CRDT state is lost)

When Yjs state is deleted (after GitHub sync while nobody editing), comment marks are gone. Recovery uses the anchor snapshot stored in Convex.

Recovery order:
1. Find exact `textQuote` unique match in markdown.
2. If multiple matches, score by `prefix`/`suffix` proximity.
3. If no match, restrict search to `headingPath` section and retry.
4. If still not found, place sidebar link using `fallbackLine`.

```typescript
// web/src/lib/with-md/anchor.ts
export function recoverAnchor(
  md: string,
  anchor: CommentAnchorSnapshot
): { start: number; end: number } | null {
  const exactMatches = findAllIndices(md, anchor.textQuote);
  if (exactMatches.length === 1) return span(exactMatches[0], anchor.textQuote.length);

  if (exactMatches.length > 1) {
    const scored = exactMatches
      .map((i) => ({ i, score: contextScore(md, i, anchor.prefix, anchor.suffix) }))
      .sort((a, b) => b.score - a.score);
    return span(scored[0].i, anchor.textQuote.length);
  }

  const section = findSectionByHeadingPath(md, anchor.headingPath);
  if (section) {
    const j = section.text.indexOf(anchor.textQuote);
    if (j >= 0) return span(section.start + j, anchor.textQuote.length);
  }

  return null; // fallbackLine used by caller
}
```

When bootstrapping a Yjs doc from markdown, re-apply comment marks using anchor recovery for all unresolved comments.

---

## 10. Suggestions

### 10.1 Creating a suggestion

User selects text in editor, clicks "Suggest change," types replacement.

```
1. Frontend captures:
   - originalText (selected text)
   - suggestedText (replacement typed by user)
   - baseContentHash (current mdFile.contentHash from Convex)
2. Calls Convex mutation suggestions.create
3. Suggestion appears in sidebar for all users (reactive query)
```

Suggestions are NOT marks in the document — they are pure Convex records with `originalText` for substring match at application time.

### 10.2 Accepting a suggestion (queue-and-auto-apply)

```
Person clicks "Accept":
  Is file actively being edited? (editHeartbeat fresh)
    YES → status = "queued"
          UI: "Suggestion approved. Will be applied when editing pauses."
    NO  → Apply immediately:
          Find originalText in mdFile.content
          Replace with suggestedText
          Update mdFile.content/contentHash
          Delete yjsStateStorageId (stale)
          Enqueue pushQueue item
          Status = "accepted"
```

Queued suggestions processed by `suggestions.processQueuedForFile` (scheduled via `ctx.scheduler.runAfter(65_000, ...)` from `storeDocument`) or on `onAllDisconnected`.

### 10.3 Suggestion status flow

```
pending → (accept while idle) → accepted
pending → (accept while editing) → queued → (editing pauses, text found) → accepted
pending → (accept while editing) → queued → (editing pauses, text gone) → conflicted
pending → (reject) → rejected
```

---

## 11. Activity Feed

Every meaningful event creates an activity record. Unread count is a reactive query. Bell icon with badge.

| Event | Activity type |
|---|---|
| Comment created | `comment_created` |
| Comment resolved | `comment_resolved` |
| Suggestion created | `suggestion_created` |
| Suggestion accepted | `suggestion_accepted` |
| Suggestion conflicted | `suggestion_conflicted` |
| Push completed | `push_completed` |
| Push failed | `push_failed` |
| File synced from GitHub | `sync_completed` |

---

## 12. Markdown Round-Trip Fidelity

### The problem

TipTap's `markdown string → ProseMirror JSON → markdown string` round-trip can normalize formatting, creating noise diffs on push to GitHub.

### Mitigation strategy (layered)

**Layer 1: Configure TipTap's markdown serializer to match source conventions.**

```typescript
Markdown.configure({
  indentation: { style: 'space', size: 2 },
  markedOptions: { gfm: true, breaks: false },
})
```

**Layer 2: Semantic diff guard — only update `mdFile.content` if meaningful change.**

```typescript
// convex/lib/markdownDiff.ts (backend) + web/src/lib/with-md/markdown-diff.ts (frontend)
export function hasMeaningfulDiff(nextMd: string, prevMd: string): boolean {
  const normalize = (s: string) =>
    s
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/__([^_]+)__/g, '**$1**')
      .trim();

  return normalize(nextMd) !== normalize(prevMd);
}
```

Used in `storeDocument` mutation: if `hasMeaningfulDiff` is false, keep the original markdown to avoid noise diffs.

**Layer 3 (post-MVP): First-edit anchoring** — patch changes into original markdown rather than replacing the whole file.

**Layer 4 (future): Custom markdown serializer** via `@tiptap/markdown` custom `renderMarkdown` handlers.

---

## 13. Syntax Safety Gate

Deterministic detection before enabling TipTap Edit mode.

```typescript
// web/src/lib/with-md/syntax.ts
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;
const MDX_RE = /<\w+[\s\S]*?>|\{[^\n]*\}/;
const DIRECTIVE_RE = /^:{2,}\w+/m;

export function detectUnsupportedSyntax(md: string): {
  supported: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (FRONTMATTER_RE.test(md)) reasons.push('frontmatter');
  if (DIRECTIVE_RE.test(md)) reasons.push('directives');
  if (MDX_RE.test(md)) reasons.push('mdx_or_embedded_jsx');

  return { supported: reasons.length === 0, reasons };
}
```

Behavior:
- `supported=true`: user can choose Read/Edit/Source.
- `supported=false`: default to Source mode with non-blocking warning banner.

---

## 14. Source Mode

Source mode is always editable, with explicit save actions (no hidden dual-write).

Buttons:
- **`Apply to Edit Doc`** (supported files): reparses markdown into TipTap document.
- **`Save Source`** (unsupported files): writes markdown directly to backend and queues push item.
- **`Discard Source Changes`**: resets source buffer.

---

## 15. File Categories

```typescript
// convex/lib/categories.ts
type FileCategory = "readme" | "prompt" | "agent" | "claude" | "docs" | "other";

function deriveCategory(path: string): FileCategory {
  const lower = path.toLowerCase();
  const filename = lower.split("/").pop() ?? "";

  if (filename === "readme.md") return "readme";
  if (filename === "agent.md" || filename === "agents.md") return "agent";
  if (filename === "claude.md") return "claude";
  if (lower.includes("/prompts/") || lower.startsWith("prompts/")) return "prompt";
  if (lower.includes("/docs/") || lower.startsWith("docs/")) return "docs";
  return "other";
}
```

---

## 16. Frontend Visual Theme

One global theme matching editorial, cinematic, calm aesthetic.

- Background image: `background_0.jpeg` (default global).
- Dark translucent content card with glass effect.
- Serif headings for document title and section heads.
- Sans-serif for UI controls.
- Low-saturation accent colors for comments/activity badges.

Style tokens (`web/src/styles/with-md.css`):

```css
:root {
  --withmd-bg-overlay: rgba(10, 16, 18, 0.68);
  --withmd-panel: rgba(12, 14, 18, 0.82);
  --withmd-border: rgba(255, 255, 255, 0.14);
  --withmd-text: rgba(245, 247, 250, 0.94);
  --withmd-muted: rgba(210, 216, 224, 0.72);
  --withmd-comment: rgba(255, 209, 102, 0.28);
}

.withmd-bg {
  background-image: linear-gradient(var(--withmd-bg-overlay), var(--withmd-bg-overlay)), url('/with-md/backgrounds/background_0.jpeg');
  background-size: cover;
  background-position: center;
}

.withmd-panel {
  background: var(--withmd-panel);
  border: 1px solid var(--withmd-border);
  backdrop-filter: blur(3px);
}
```

Layout (desktop-first):
- Full-screen scenic background + dark vignette overlay.
- Center document panel (`max-width: 940px`) with glass effect.
- Right sidebar for comments/activity.
- Compact top toolbar with mode toggle + push/resync status.

---

## 17. Complete File Plan

### 17.1 Backend (Convex)

```
convex/
├── schema.ts
├── http.ts
├── auth.ts
├── repos.ts
├── mdFiles.ts
├── comments.ts
├── suggestions.ts
├── pushQueue.ts
├── activities.ts
├── collab.ts
├── github/
│   ├── webhookHandler.ts
│   ├── sync.ts
│   ├── push.ts
│   └── tokens.ts
└── lib/
    ├── categories.ts
    └── markdownDiff.ts
```

### 17.2 Hocuspocus Server

```
hocuspocus-server/
├── index.ts                   # Server + hooks
├── bootstrap.ts               # Markdown → Yjs conversion
├── serialize.ts               # Yjs → Markdown conversion
├── package.json
├── Dockerfile
└── .env
```

### 17.3 Frontend (Next.js Web App)

```
web/src/app/(authenticated)/with-md/page.tsx
web/src/app/(authenticated)/with-md/[repoId]/[...filePath]/page.tsx

web/src/components/with-md/with-md-shell.tsx
web/src/components/with-md/file-tree.tsx
web/src/components/with-md/document-toolbar.tsx
web/src/components/with-md/document-surface.tsx
web/src/components/with-md/read-renderer.tsx
web/src/components/with-md/source-editor.tsx
web/src/components/with-md/collab-editor.tsx
web/src/components/with-md/comments-sidebar.tsx
web/src/components/with-md/activity-panel.tsx
web/src/components/with-md/presence-strip.tsx

web/src/components/with-md/tiptap/comment-mark.ts
web/src/components/with-md/tiptap/editor-extensions.ts

web/src/hooks/with-md/use-doc-mode.ts
web/src/hooks/with-md/use-collab-doc.ts
web/src/hooks/with-md/use-comment-anchors.ts
web/src/hooks/with-md/use-syntax-support.ts

web/src/lib/with-md/api.ts
web/src/lib/with-md/types.ts
web/src/lib/with-md/syntax.ts
web/src/lib/with-md/anchor.ts
web/src/lib/with-md/markdown-diff.ts

web/src/styles/with-md.css
web/public/with-md/backgrounds/background_0.jpeg
```

---

## 18. Dependencies

### 18.1 Frontend (from `web/`)

```bash
npm i @tiptap/core @tiptap/react @tiptap/starter-kit @tiptap/markdown @tiptap/extension-collaboration @tiptap/extension-collaboration-cursor @hocuspocus/provider yjs y-indexeddb
```

Optional (for source editor quality):
```bash
npm i @uiw/react-codemirror
```

### 18.2 Hocuspocus Server (from `hocuspocus-server/`)

```bash
npm i @hocuspocus/server @tiptap/core @tiptap/starter-kit @tiptap/markdown yjs
```

### 18.3 Convex Backend

Standard Convex packages (already available in Convex project).

---

## 19. Implementation Steps (Agentic Execution Order)

Execute in this order. Each phase builds on the previous.

### Phase 1: Backend Foundation

1. **Set up Convex project structure** — Create `convex/schema.ts` with the complete data model from Section 4.
2. **Implement file categories** — Create `convex/lib/categories.ts` with `deriveCategory()`.
3. **Implement markdown diff utility** — Create `convex/lib/markdownDiff.ts` with `hasMeaningfulDiff()`.
4. **Implement GitHub auth + installations** — Create `convex/auth.ts`, `convex/github/tokens.ts`.
5. **Implement GitHub webhook handler** — Create `convex/http.ts`, `convex/github/webhookHandler.ts` with HMAC validation, file upsert logic, deferred change handling.
6. **Implement repos queries and mutations** — Create `convex/repos.ts` with `list`, `get`, `track`, `untrack`, `resync`.
7. **Implement mdFiles queries and mutations** — Create `convex/mdFiles.ts` with `listByRepo`, `get`, `getFileTree`.
8. **Implement GitHub sync action** — Create `convex/github/sync.ts` with `syncRepoFiles`, `initialSync`.
9. **Implement GitHub push action** — Create `convex/github/push.ts` with blob → tree → commit flow.
10. **Implement push queue** — Create `convex/pushQueue.ts` with queries/mutations.
11. **Implement comments CRUD** — Create `convex/comments.ts` with `listByFile`, `create` (with anchor snapshot), `update`, `resolve`, `delete`.
12. **Implement suggestions** — Create `convex/suggestions.ts` with full status flow, queue-and-auto-apply logic, `processQueuedForFile`.
13. **Implement activity feed** — Create `convex/activities.ts` with `listByRepo`, `unreadCount`, `markAsRead`.
14. **Implement collab HTTP endpoints** — Create `convex/collab.ts` with `authenticate`, `loadDocument`, `storeDocument` (with semantic diff guard), `onAllDisconnected`.

### Phase 2: Hocuspocus Server

15. **Create Hocuspocus project** — Set up `hocuspocus-server/` with `package.json`, `.env`, `Dockerfile`.
16. **Implement Hocuspocus server** — Create `index.ts` with `onAuthenticate`, `onLoadDocument`, `onStoreDocument`, `onDisconnect` hooks calling Convex HTTP endpoints.
17. **Implement bootstrap helper** — Create `bootstrap.ts` for markdown → Yjs conversion via headless TipTap.
18. **Implement serialize helper** — Create `serialize.ts` for Yjs → markdown conversion via headless TipTap.

### Phase 3: Frontend Foundation

19. **Install frontend dependencies** — Run npm install for TipTap, Hocuspocus provider, Yjs, y-indexeddb.
20. **Create module skeleton** — Create all files listed in Section 17.3 as empty stubs.
21. **Create global styles** — Write `web/src/styles/with-md.css` with theme tokens.
22. **Copy background image** — Place `background_0.jpeg` in `web/public/with-md/backgrounds/`.
23. **Implement types** — Write `web/src/lib/with-md/types.ts` with all data types from Section 5.
24. **Implement API client** — Write `web/src/lib/with-md/api.ts` with Convex query/mutation wrappers.

### Phase 4: Frontend Core Features

25. **Implement syntax safety gate** — Write `web/src/lib/with-md/syntax.ts` with `detectUnsupportedSyntax()`.
26. **Implement anchor recovery** — Write `web/src/lib/with-md/anchor.ts` with `recoverAnchor()`.
27. **Implement markdown diff guard** — Write `web/src/lib/with-md/markdown-diff.ts` with `hasMeaningfulDiff()`.
28. **Implement doc mode hook** — Write `web/src/hooks/with-md/use-doc-mode.ts` with state machine.
29. **Implement syntax support hook** — Write `web/src/hooks/with-md/use-syntax-support.ts`.
30. **Implement collab doc hook** — Write `web/src/hooks/with-md/use-collab-doc.ts` with Yjs + IndexedDB + Hocuspocus.
31. **Implement comment anchors hook** — Write `web/src/hooks/with-md/use-comment-anchors.ts`.

### Phase 5: Frontend UI Components

32. **Build shell layout** — Write `web/src/components/with-md/with-md-shell.tsx` with background, panels, responsive layout.
33. **Build file tree** — Write `web/src/components/with-md/file-tree.tsx` with category filtering.
34. **Build document toolbar** — Write `web/src/components/with-md/document-toolbar.tsx` with mode toggle, push/resync buttons, unpushed changes badge.
35. **Build read renderer** — Write `web/src/components/with-md/read-renderer.tsx` using react-markdown + remark-gfm.
36. **Build source editor** — Write `web/src/components/with-md/source-editor.tsx` with editable textarea/CodeMirror, apply/save/discard buttons.
37. **Implement TipTap comment mark** — Write `web/src/components/with-md/tiptap/comment-mark.ts`.
38. **Implement TipTap editor extensions** — Write `web/src/components/with-md/tiptap/editor-extensions.ts` with StarterKit + Markdown + Collaboration + CollaborationCursor + CommentMark.
39. **Build collaborative editor** — Write `web/src/components/with-md/collab-editor.tsx` with TipTap + Yjs + presence cursors + activity detection.
40. **Build document surface** — Write `web/src/components/with-md/document-surface.tsx` orchestrating Read/Edit/Source modes.
41. **Build comments sidebar** — Write `web/src/components/with-md/comments-sidebar.tsx` with threads, mark linking, selection-to-comment flow.
42. **Build activity panel** — Write `web/src/components/with-md/activity-panel.tsx` with feed display, unread badge.
43. **Build presence strip** — Write `web/src/components/with-md/presence-strip.tsx` with user avatars and edit status.

### Phase 6: Frontend Pages

44. **Build file list page** — Write `web/src/app/(authenticated)/with-md/page.tsx` with repo selector and file tree.
45. **Build document page** — Write `web/src/app/(authenticated)/with-md/[repoId]/[...filePath]/page.tsx` with document surface + sidebar.

### Phase 7: Testing and Verification

46. **Write unit tests** — Test `syntax.ts` (feature detection), `anchor.ts` (recovery logic), `markdown-diff.ts` (semantic diff guard).
47. **Write integration tests** — Test mode transitions (`read -> edit -> source -> edit`), source apply flow, comment create + sidebar linking.
48. **Run build verification** — `npm run build` in `web/`, `npx tsc --noEmit`, lint checks.

---

## 20. Acceptance Criteria

### Functional

- File opens in read mode instantly (rendered markdown).
- Clicking into content area activates TipTap WYSIWYG editor with Hocuspocus.
- Source mode is always editable for any file.
- Supported files can enter collaborative edit mode with presence cursors.
- Unsupported files default to source mode with warning banner.
- Comments can be created from selected text and shown in sidebar.
- After synthetic anchor loss, recovery strategy resolves most comments.
- Push/resync actions visible and invokable.
- Activity feed shows all meaningful events with unread badge.
- Suggestions can be created, accepted (with queue behavior), rejected.
- y-indexeddb prevents data loss on browser crash/refresh.

### Quality

- No crashes when switching modes repeatedly.
- No data loss in browser refresh while editing (IndexedDB recovery).
- Noise-only markdown changes are suppressed by semantic diff guard.
- GitHub pushes produce clean diffs without formatting-only noise.

---

## 21. Testing Plan

### Unit tests

- `syntax.ts`: markdown feature detection (frontmatter, MDX, directives).
- `anchor.ts`: quote/context/heading-based recovery logic.
- `markdown-diff.ts`: semantic-diff guard.
- `categories.ts`: file category derivation.

### Integration tests (component-level)

- Mode transitions `read -> edit -> source -> edit`.
- Source apply flow updates editor document.
- Comment create and sidebar highlight linking.
- Suggestion accept/reject/queue flow.

### Manual checks

- Open 10 representative markdown docs.
- Verify supported vs unsupported routing.
- Verify comment behavior with and without active collab session.
- Verify push and resync button states.
- Round-trip fidelity: load 50 real-world markdown files, serialize back, target <5% noise diff rate.

---

## 22. Failure Scenarios and Mitigations

| Scenario | Impact | Mitigation |
|---|---|---|
| **Markdown round-trip normalization** | Noisy diffs, polluted git blame | Semantic diff guard (Layer 2) + TipTap serializer config (Layer 1) |
| **TipTap can't parse markdown file** | Content loss on first edit | Syntax safety gate detects unsupported syntax, defaults to Source mode |
| **Peritext anomaly in Yjs rich text** | Incorrect formatting after offline merge | Accept as known limitation; migrate to Loro if needed |
| **Comment marks lost on Yjs state reset** | Comments lose position anchoring | Anchor snapshot recovery using quote/context/heading/line + re-apply on bootstrap |
| **Source/edit mode conflicts** | Data inconsistency | Explicit apply/save actions; no hidden dual-write |
| **Hocuspocus server crash** | Editing paused | y-indexeddb preserves local state, auto-reconnect resumes |
| **GitHub webhook missed** | Content drift | Manual "Re-sync" button for full tree scan |
| **Large file (>1MB)** | Performance degradation | Store inline with warning, skip editor for very large files |

---

## 23. Deployment

```
Frontend (Vercel/Cloudflare)
  ├── Convex WS ──▶ Convex Cloud (managed)
  └── Yjs WS ────▶ Hocuspocus on Fly.io (1 instance MVP)
                       └── HTTP ──▶ Convex Cloud

Hocuspocus needs: Node.js runtime with @tiptap/core for headless serialization.
Deploy in same region as Convex. Health checks + auto-restart on Fly.io.
```

---

## 24. MVP Scope Summary

### In scope

- GitHub App + webhook inbound sync
- File tree with category filtering
- Google Docs-style WYSIWYG markdown editing (TipTap + Hocuspocus)
- Read mode (rendered markdown) / Edit mode (TipTap WYSIWYG) / Source mode (always editable)
- Syntax safety gate (unsupported → Source mode with warning)
- Bidirectional markdown conversion (`@tiptap/markdown`)
- Cursor presence and awareness (TipTap collaboration extensions)
- y-indexeddb crash resilience (zero data loss)
- Lazy Hocuspocus connection (read-only view → CRDT on focus)
- In-app activity feed with unread counts
- Comments as TipTap marks (anchored in CRDT, metadata + anchor snapshot in Convex)
- Approximate comment anchor recovery
- Suggestions with queue-and-auto-apply
- Manual "Push to GitHub" with co-authored-by commits
- Manual "Re-sync from GitHub"
- GitHub OAuth
- Edit lock for incoming GitHub changes during active editing
- Markdown round-trip fidelity safeguards (Layers 1-2)
- Graceful 1MB file handling
- Default branch only
- One global visual theme (cinematic dark)

### Out of scope (future)

- Full mobile UX parity
- Loro migration (Peritext-native CRDT)
- Auto-push to GitHub
- PR/branch workflows
- Merging GitHub changes into live editing sessions
- GitLab/Bitbucket
- Email/Slack notifications
- AI-powered features
- Multi-instance Hocuspocus (Redis adapter)
- File creation/deletion from with.md
- Custom markdown syntax extensions (MDX, admonitions)
- Perfect round-trip fidelity for every markdown dialect
- Rich MDX/custom directive visual editing

---

## 25. References

- TipTap Markdown docs: https://tiptap.dev/docs/editor/markdown
- TipTap Markdown custom serialization: https://tiptap.dev/docs/editor/markdown/advanced-usage/custom-serializing
- TipTap comments overview: https://tiptap.dev/docs/comments/getting-started/overview
- Peritext paper: https://www.inkandswitch.com/peritext/
- Loro rich text article: https://loro.dev/blog/loro-richtext
