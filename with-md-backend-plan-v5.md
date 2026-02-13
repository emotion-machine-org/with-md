# with.md — MVP Backend Plan v5 (Final)

## 0. Decisions Locked In

| Decision | Choice |
|---|---|
| Push to GitHub | Manual "Push" button in web UI |
| Branch strategy | Default branch only |
| Large files (>1MB) | Store inline, fail gracefully with warning |
| Commit attribution | Bot commits with `Co-authored-by:` trailers |
| Webhook reliability | Manual "Re-sync" button in UI |
| Editing model | Always-connected, Google Docs style. No edit/done buttons. |
| Comment anchoring | TipTap marks (inside CRDT doc) + metadata in Convex |
| Suggestions during editing | Queued, auto-applied when editing pauses |
| CRDT | Yjs + Hocuspocus (separate server) |
| Editor | **TipTap** (ProseMirror-based, rich text WYSIWYG) |
| Offline / crash resilience | y-indexeddb on client |
| File viewing | Lazy Hocuspocus — rendered markdown by default, CRDT on focus |
| Notifications | In-app activity feed |

---

## 1. Architecture

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

### The conversion layer (critical new element)

```
INBOUND (GitHub → with.md):
  .md file ──▶ TipTap Markdown parser ──▶ ProseMirror JSON ──▶ Yjs XmlFragment

OUTBOUND (with.md → GitHub):
  Yjs XmlFragment ──▶ ProseMirror JSON ──▶ TipTap Markdown serializer ──▶ .md file
```

This conversion layer is the **highest-risk component** in the system. Markdown → ProseMirror → Markdown round-trips can normalize formatting. See Section 10 for the mitigation strategy.

### Sources of truth

| What | Owner | Format | Why |
|---|---|---|---|
| Canonical file content at rest | GitHub | Raw markdown string | It's a git repo |
| Live document during editing | Hocuspocus / Yjs | ProseMirror JSON (Y.XmlFragment) | Rich text CRDT |
| Raw markdown for push-back | Convex (`mdFiles.content`) | Raw markdown string | Preserved for git fidelity |
| Collaboration metadata | Convex | Structured tables | Reactive, transactional |

---

## 2. Why TipTap

### TipTap + Hocuspocus = same ecosystem

TipTap (rich text editor) and Hocuspocus (Yjs WebSocket server) are made by the same company (Ueberdosis). The integration is first-class:

- `@tiptap/extension-collaboration` — binds TipTap to a Yjs document
- `@tiptap/extension-collaboration-cursor` — shows remote cursors with names/colors
- `@hocuspocus/provider` — WebSocket client for Hocuspocus
- All share the same ProseMirror ↔ Yjs bridge (`y-prosemirror`)

### What TipTap gives us over CodeMirror

1. **WYSIWYG editing**: users see rendered headings, bold, lists — not raw `##` and `**`. This is what non-developer users expect.
2. **Native markdown extension**: `@tiptap/markdown` (v3.7.0+) provides bidirectional parsing/serialization between markdown strings and TipTap's internal JSON format.
3. **Built-in comments as marks**: comments can live inside the ProseMirror document model, surviving edits natively through the CRDT.
4. **Suggestion/track-changes mode**: TipTap supports tracked changes where edits can be proposed inline — aligns with our suggestion workflow.
5. **Slash commands, floating menus, bubble menus**: rich editing UX out of the box.
6. **Better collaboration UX**: cursor labels, selection highlights, user colors are native.

### What TipTap introduces as risk

1. **Rich text CRDT anomalies**: Yjs uses control characters for formatting marks. Concurrent overlapping bold operations can produce incorrect merged formatting (the Peritext anomaly). Rare in real-time sync but possible during offline/reconnection.
2. **Markdown round-trip fidelity**: the conversion layer may normalize markdown syntax, creating unwanted git diffs.
3. **Heavier frontend**: TipTap + ProseMirror is a larger bundle than CodeMirror.

---

## 3. The Google Docs Model

### Core principle: there is no "edit mode"

When a user opens a markdown file, they see a **rendered view** served from Convex (markdown rendered to HTML). When they click into the content area, TipTap initializes with a Hocuspocus connection and they can start typing in WYSIWYG mode. No buttons, no mode switch.

### Two-phase file viewing

```
Phase 1: READ (immediate, no Hocuspocus)
  ┌──────────────────────────────────────────────┐
  │  User opens file page                        │
  │  → Convex query loads mdFile.content          │
  │  → Markdown rendered to HTML for display      │
  │  → Comments and suggestions shown in sidebar  │
  │  → No WebSocket to Hocuspocus                │
  │  → File tree browsing stays fast              │
  └──────────────────────────────────────────────┘

Phase 2: EDIT (lazy, on user focus)
  ┌──────────────────────────────────────────────┐
  │  User clicks into the content area            │
  │  → y-indexeddb loads local CRDT state          │
  │  → HocuspocusProvider connects                │
  │  → TipTap editor initializes with:            │
  │    - Collaboration extension (Yjs binding)    │
  │    - CollaborationCursor (awareness)          │
  │    - Markdown extension (for import/export)   │
  │  → Seamless transition: same content, now     │
  │    editable with cursors and WYSIWYG          │
  └──────────────────────────────────────────────┘
```

### Frontend implementation

```typescript
function MarkdownFilePage({ mdFileId }: { mdFileId: string }) {
  const mdFile = useQuery(api.mdFiles.get, { mdFileId });
  const [editorActive, setEditorActive] = useState(false);

  if (!mdFile) return <Loading />;

  return (
    <div>
      <Sidebar mdFileId={mdFileId} />

      {!editorActive ? (
        <div onClick={() => setEditorActive(true)} className="cursor-text">
          <RenderedMarkdown content={mdFile.content} />
          <span className="text-muted text-sm">Click to edit</span>
        </div>
      ) : (
        <CollaborativeEditor mdFileId={mdFileId} />
      )}
    </div>
  );
}
```

### Collaborative editor with TipTap

```typescript
function CollaborativeEditor({ mdFileId }: { mdFileId: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const authToken = useAuthToken();
  const currentUser = useCurrentUser();

  const ydoc = useMemo(() => new Y.Doc(), [mdFileId]);

  // ── Crash resilience: persist to IndexedDB ──
  useEffect(() => {
    const idb = new IndexeddbPersistence(`withmd-${mdFileId}`, ydoc);
    return () => { idb.destroy(); };
  }, [ydoc]);

  // ── Network sync: Hocuspocus ──
  const provider = useMemo(() => new HocuspocusProvider({
    url: HOCUSPOCUS_URL,
    name: mdFileId,
    document: ydoc,
    token: authToken,
  }), [mdFileId, ydoc]);

  // ── TipTap editor ──
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: false, // Yjs handles undo/redo
      }),
      Markdown, // bidirectional markdown support
      Collaboration.configure({
        document: ydoc,
      }),
      CollaborationCursor.configure({
        provider,
        user: {
          name: currentUser.githubLogin,
          color: currentUser.color,
        },
      }),
      // Comment marks (see Section 7)
      CommentMark,
    ],
  });

  // ── Activity detection ──
  useEffect(() => {
    if (!editor) return;
    const IDLE_TIMEOUT = 5000;
    let idleTimer: ReturnType<typeof setTimeout>;

    const handleUpdate = () => {
      provider.awareness.setLocalStateField("isEditing", true);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        provider.awareness.setLocalStateField("isEditing", false);
      }, IDLE_TIMEOUT);
    };

    editor.on("update", handleUpdate);
    return () => {
      clearTimeout(idleTimer);
      editor.off("update", handleUpdate);
    };
  }, [editor, provider]);

  useEffect(() => {
    return () => { provider.destroy(); };
  }, [provider]);

  return <EditorContent editor={editor} />;
}
```

### How y-indexeddb eliminates data loss

Same as v4 — every Yjs operation is persisted to IndexedDB instantly (~1ms). Hocuspocus crash, Convex downtime, internet drop, browser crash — all survivable with zero data loss. The Yjs CRDT merges local and server state on reconnect.

### Activity detection layers

| Layer | Mechanism | Latency | Used for |
|---|---|---|---|
| **UI** | Yjs Awareness | ~50ms | Cursors, "Alice is editing", idle/active |
| **Backend** | Heartbeat in Convex | 30-60s staleness | Auto-apply queued suggestions, defer GitHub changes |

---

## 4. Data Model

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
    // Raw markdown string — the canonical form for git push-back
    content: v.string(),
    contentHash: v.string(),
    lastGithubSha: v.string(),
    fileCategory: v.string(),
    sizeBytes: v.number(),
    isDeleted: v.boolean(),
    lastSyncedAt: v.number(),
    // CRDT persistence (Yjs binary state stored as blob)
    yjsStateStorageId: v.optional(v.id("_storage")),
    // Editing activity
    editHeartbeat: v.optional(v.number()),
    // Deferred GitHub changes
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
    // commentMarkId links this record to the mark inside the TipTap/Yjs document
    commentMarkId: v.string(),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
    parentCommentId: v.optional(v.id("comments")),
    // Fallback: absolute line number at creation time (used if CRDT state is unavailable)
    fallbackLine: v.optional(v.number()),
  })
    .index("by_md_file", ["mdFileId"])
    .index("by_parent", ["parentCommentId"])
    .index("by_comment_mark_id", ["commentMarkId"]),

  // ── Suggestions ──
  suggestions: defineTable({
    mdFileId: v.id("mdFiles"),
    commentId: v.optional(v.id("comments")),
    authorId: v.id("users"),
    status: v.string(),                    // "pending" | "queued" | "accepted" | "rejected" | "conflicted"
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

### Key change from v4: comment anchoring

Comments no longer use Yjs RelativePositions stored in Convex. Instead, comment anchors live **inside the TipTap/ProseMirror document** as marks on the text. This means:

- When someone adds a comment, a `commentMark` is applied to the selected text range within the editor. This mark is part of the CRDT document and syncs to all users automatically.
- The Convex `comments` table stores the **metadata** (author, body, resolved status, thread) and links to the mark via `commentMarkId`.
- The mark survives edits natively — if someone inserts text before the commented region, the mark moves with the text because ProseMirror/Yjs handles this.
- When all editors disconnect and Hocuspocus persists the document, the comment marks are part of the serialized Yjs state.

**Non-expanding behavior** (from Peritext research): comment marks should NOT expand when text is typed at their boundary. TipTap marks have an `inclusive` property — set `inclusive: false` so that typing at the edge of a comment doesn't extend it.

```typescript
// Comment mark extension for TipTap
const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,  // typing at boundary doesn't extend the comment
  addAttributes() {
    return {
      commentMarkId: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { 'data-comment': HTMLAttributes.commentMarkId, class: 'comment-highlight' }, 0];
  },
});
```

---

## 5. Hocuspocus Server

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
        // Fall through to bootstrap from markdown
        bootstrapFromMarkdown(document, data.markdownContent ?? "");
      }
    } else {
      // First time: convert markdown → ProseMirror JSON → Yjs
      bootstrapFromMarkdown(document, data.markdownContent ?? "");
    }
  },

  async onStoreDocument({ documentName, document }) {
    // Serialize ProseMirror doc back to markdown for storage
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
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

// These run on the Hocuspocus server (Node.js) — headless TipTap, no DOM

function bootstrapFromMarkdown(ydoc: Y.Doc, markdown: string) {
  // Create a headless TipTap editor to parse markdown → ProseMirror JSON
  const editor = new Editor({
    extensions: [StarterKit, Markdown],
    content: markdown,
    contentType: "markdown",
  });

  // Get the ProseMirror JSON
  const json = editor.getJSON();
  editor.destroy();

  // Apply JSON to the Yjs document's XmlFragment
  // (using y-prosemirror's prosemirrorJSONToYDoc or equivalent)
  const fragment = ydoc.getXmlFragment("default");
  applyProseMirrorJsonToYFragment(fragment, json);
}

function serializeToMarkdown(ydoc: Y.Doc): string {
  // Convert Yjs XmlFragment → ProseMirror JSON → markdown string
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

**Note:** Running headless TipTap on the Hocuspocus server (Node.js) for serialization is a known pattern. TipTap supports headless mode without a DOM via `@tiptap/core`. This keeps the markdown conversion logic in one place rather than depending on the client.

---

## 6. GitHub Synchronization

### 6.1 Inbound: GitHub → Convex (Webhook)

Same as v4 — unchanged by the editor choice:

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

### 6.2 Deferred change resolution

Same as v4 — when all editors disconnect from a file with `pendingGithubContent`, editor's version wins. The `markdownContent` from Hocuspocus's `onAllDisconnected` is used as the new `mdFile.content`.

### 6.3 Outbound: Manual Push

```
User clicks "Push to GitHub":
  1. Mutation validates queued items, schedules action
  2. Action collects queued pushQueue items
  3. Uses mdFile.content (raw markdown) for each file — NOT the Yjs state
  4. Creates blobs → tree → commit with Co-authored-by trailers
  5. Updates branch reference
  6. Marks items pushed/failed, creates activity entries
```

**Critical: push uses `mdFile.content`, not a live serialization.** The `content` field is updated by Hocuspocus's `onStoreDocument` hook (debounced) with the serialized markdown. This is the version that goes to git.

### 6.4 Re-sync (Manual)

Same as v4. Full tree scan via GitHub Trees API.

---

## 7. Comments

### 7.1 Architecture: dual storage

Comments have two parts:
1. **Anchor** (in the TipTap/Yjs document): a `comment` mark on the text range, carrying a unique `commentMarkId`. This is part of the CRDT and survives edits, moves with text, and syncs to all editors.
2. **Metadata** (in Convex): author, body, resolved status, thread. Linked via `commentMarkId`.

### 7.2 Creating a comment

```
1. User selects text in TipTap editor
2. Frontend applies a comment mark to the selection:
   editor.chain()
     .setMark('comment', { commentMarkId: generateId() })
     .run()
3. Frontend calls Convex mutation comments.create with:
   - mdFileId, body, commentMarkId, authorId
   - fallbackLine (current line number, for display when CRDT unavailable)
4. Mark syncs to all editors via Yjs (immediate)
5. Comment metadata appears in sidebar via Convex reactive query
```

### 7.3 Displaying comments

In Phase 1 (read-only view, no Hocuspocus):
- Comments are displayed in the sidebar, positioned by `fallbackLine`
- No highlight on the text (can't resolve mark positions without CRDT)

In Phase 2 (TipTap active):
- Comment marks are visible as highlights in the editor
- Clicking a highlight opens the comment thread in the sidebar
- Sidebar comments are linked to their marks — clicking a sidebar comment scrolls to and highlights the marked text

### 7.4 Resolving / deleting comments

```
Resolve: update Convex record (resolvedAt, resolvedBy). Mark stays in doc but renders differently (dimmed).
Delete: remove Convex record + remove mark from TipTap document:
  editor.chain().unsetMark('comment', { commentMarkId }).run()
```

### 7.5 Comments without active CRDT

When nobody has the file open and the Yjs state was deleted (after a GitHub sync), comment marks are gone. The Convex records still exist with `fallbackLine`. Next time someone opens the editor and the Yjs doc is bootstrapped from markdown, the comment marks won't be present.

**Solution**: when bootstrapping from markdown, re-apply comment marks based on `fallbackLine`:
- Load all unresolved comments for this file from Convex
- For each, find `fallbackLine` in the fresh document
- Re-apply the comment mark at that line
- This is approximate (line may have shifted) but better than losing all comments

**Better long-term**: preserve Yjs state more aggressively (don't delete on GitHub sync unless content actually changed).

---

## 8. Suggestions

### 8.1 Creating a suggestion

User selects text in the editor, clicks "Suggest change," types replacement.

```
1. Frontend captures:
   - originalText (selected text)
   - suggestedText (replacement typed by user)
   - baseContentHash (current mdFile.contentHash from Convex)
2. Calls Convex mutation suggestions.create
3. Suggestion appears in sidebar for all users (reactive query)
```

Suggestions are NOT marks in the document — they are pure Convex records. Unlike comments (which need to track position across edits), suggestions carry the `originalText` string and can be located by substring match at application time.

### 8.2 Accepting a suggestion (queue-and-auto-apply)

Same flow as v4:

```
Person C clicks "Accept":
  Is file actively being edited? (editHeartbeat fresh)
    YES → status = "queued"
          UI: "Suggestion approved ✓ Will be applied when editing pauses"
    NO  → Apply immediately:
          Find originalText in mdFile.content
          Replace with suggestedText
          Update mdFile.content/contentHash
          Delete yjsStateStorageId (stale)
          Enqueue pushQueue item
          Status = "accepted"
```

Queued suggestions are processed by `suggestions.processQueuedForFile` (scheduled via `ctx.scheduler.runAfter(65_000, ...)` from `storeDocument`) or on `onAllDisconnected`.

### 8.3 Suggestion status flow

```
pending → (accept while idle) → accepted
pending → (accept while editing) → queued → (editing pauses, text found) → accepted
pending → (accept while editing) → queued → (editing pauses, text gone) → conflicted
pending → (reject) → rejected
```

---

## 9. Activity Feed

Same as v4. Separate `activities` table + `activityReadCursors`. Every meaningful event creates an activity record. Unread count is a reactive query. Bell icon with badge.

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

## 10. Markdown Round-Trip Fidelity (Critical Risk)

### The problem

TipTap's markdown extension converts:
```
markdown string → ProseMirror JSON (on load) → markdown string (on save)
```

This round-trip can **normalize** markdown:
- `__bold__` might become `**bold**`
- Trailing whitespace might be stripped
- Heading style `Heading\n===` might become `# Heading`
- Custom HTML blocks might be mangled
- Indentation might change (2 spaces vs 4 vs tabs)
- Blank line patterns between elements might normalize

This means: even if nobody changes the content, the serialized markdown might differ from the original. When pushed to GitHub, this creates **noise diffs** — lines that changed in formatting but not meaning. Developers hate this.

### Mitigation strategy (layered)

**Layer 1: Configure TipTap's markdown serializer to match source conventions.**

```typescript
Markdown.configure({
  indentation: { style: 'space', size: 2 },
  markedOptions: { gfm: true, breaks: false },
})
```

Choose settings that match GitHub Flavored Markdown conventions. This reduces but doesn't eliminate normalization.

**Layer 2: Store the original raw markdown and diff before pushing.**

When `onStoreDocument` fires, we get TipTap's serialized markdown. Before updating `mdFile.content`, compare it with the previous `content`:

```typescript
// In Convex storeDocument mutation:
const serialized = args.markdownContent;
const previous = mdFile.content;

// Only update content if there's a meaningful difference
if (hasSemanticDifference(serialized, previous)) {
  await ctx.db.patch(mdFile._id, {
    content: serialized,
    contentHash: hash(serialized),
  });
} else {
  // Formatting-only change — don't update content,
  // keep the original markdown to avoid noise diffs
  // Still update Yjs state and heartbeat
}
```

`hasSemanticDifference` would normalize both strings (strip whitespace, normalize emphasis markers) and compare. If they're semantically identical, keep the original. This is a heuristic but catches the most common normalization noise.

**Layer 3: First-edit anchoring.**

When a file is first loaded from GitHub, store the **original markdown** as `mdFile.originalContent`. When it's time to push, if the only changes are in specific paragraphs, try to patch those changes into the original markdown rather than replacing the whole file. This preserves formatting in untouched sections.

This is complex and might be post-MVP. For MVP, Layers 1 and 2 should be sufficient.

**Layer 4 (future): Custom markdown serializer.**

If TipTap's built-in serializer causes too many issues, replace it with a custom serializer that's more faithful to the original formatting. The `@tiptap/markdown` extension supports custom `renderMarkdown` handlers per node/mark type.

### Acceptance criteria for MVP

Before launching, run a test suite:
1. Take 50 real-world markdown files from popular repos (READMEs, CLAUDE.md, docs)
2. Load each into TipTap, immediately serialize back
3. Diff the output against the original
4. Any diff that changes meaning = **bug** (must fix)
5. Any diff that only changes formatting = **noise** (minimize via Layers 1-2)
6. Target: <5% of files should have any noise diff at all

---

## 11. API Surface

### 11.1 Queries

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

### 11.2 Mutations

| Function | Purpose |
|---|---|
| `comments.create` | Add comment (with commentMarkId link) |
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

### 11.3 Internal Functions

| Function | Type | Purpose |
|---|---|---|
| `collab.authenticate` | internalQuery | Verify user + repo access |
| `collab.loadDocument` | internalQuery | Return Yjs state or raw markdown |
| `collab.storeDocument` | internalMutation | Persist Yjs + update markdown + heartbeat + schedule suggestion check |
| `collab.onAllDisconnected` | internalMutation | Final persist + resolve pending GitHub + process queued suggestions |
| `suggestions.processQueuedForFile` | internalMutation | Apply queued suggestions when editing pauses |

### 11.4 Actions

| Function | Purpose |
|---|---|
| `github.syncRepoFiles` | Inbound sync |
| `github.pushChanges` | Outbound push |
| `github.initialSync` | Full tree scan |
| `github.refreshToken` | Refresh installation token |

### 11.5 HTTP Endpoints

| Route | Method | Source |
|---|---|---|
| `/api/github-webhook` | POST | GitHub |
| `/api/auth/github/callback` | GET | Browser |
| `/api/collab/authenticate` | POST | Hocuspocus |
| `/api/collab/loadDocument` | POST | Hocuspocus |
| `/api/collab/storeDocument` | POST | Hocuspocus |
| `/api/collab/onAllDisconnected` | POST | Hocuspocus |

---

## 12. File Categories

```typescript
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

## 13. Project Structure

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
    └── markdownDiff.ts        # semantic diff for round-trip fidelity

hocuspocus-server/
├── index.ts                   # Server + hooks
├── bootstrap.ts               # Markdown → Yjs conversion
├── serialize.ts               # Yjs → Markdown conversion
├── package.json
├── Dockerfile
└── .env
```

---

## 14. Deployment

```
Frontend (Vercel/Cloudflare)
  ├── Convex WS ──▶ Convex Cloud (managed)
  └── Yjs WS ────▶ Hocuspocus on Fly.io (1 instance MVP)
                       └── HTTP ──▶ Convex Cloud

Hocuspocus needs: Node.js runtime with @tiptap/core for headless serialization.
Deploy in same region as Convex. Health checks + auto-restart on Fly.io.
```

---

## 15. Failure Scenarios

All failure scenarios from v4 still apply. TipTap-specific additions:

### F11: Markdown round-trip normalization

**What happens**: File loaded from GitHub, opened in TipTap, immediately serialized back produces different markdown. On push, git shows changes nobody made.

**Impact**: Noisy diffs, polluted git blame.

**Mitigation**: Layers 1-2 from Section 10. Semantic diff comparison before updating `mdFile.content`.

### F12: TipTap can't parse a markdown file

**What happens**: File contains non-standard markdown (MDX, custom directives, embedded HTML that TipTap doesn't understand). The parser drops or mangles content.

**Impact**: Content loss on first edit.

**Mitigation**: Before loading into TipTap, validate the round-trip. If `parse(file) → serialize()` loses content, show a warning: "This file contains unsupported syntax. Some formatting may be simplified." Let the user choose to proceed or open on GitHub instead. Long-term: add custom TipTap extensions for common non-standard syntax (frontmatter, MDX, admonitions).

### F13: Peritext anomaly in Yjs rich text

**What happens**: Two users concurrently apply overlapping bold formatting while offline. On reconnect, Yjs produces incorrectly merged formatting (text becomes bold that shouldn't be, or loses bold that should be).

**Impact**: Incorrect formatting. Requires manual fix.

**Likelihood**: Very low with real-time sync (users see each other's cursors). Only happens during offline editing with y-indexeddb where two users independently format overlapping regions.

**Mitigation**: Accept as known limitation for MVP. If it becomes a real problem, migrate to Loro (Rust/WASM CRDT that implements Peritext natively and has ProseMirror bindings).

### F14: Comment marks lost on Yjs state reset

**What happens**: GitHub content changes while nobody is editing. Yjs state is deleted (stale). Comment marks (which lived in the Yjs doc) are gone.

**Impact**: Comments lose their position anchoring. Fall back to `fallbackLine`.

**Mitigation**: Re-apply comment marks when bootstrapping from markdown (see Section 7.5). Long-term: don't delete Yjs state unless the content actually changed — compute a diff and apply it to the existing Yjs doc instead of resetting.

---

## 16. UX Analysis

### What users will love

1. **WYSIWYG markdown editing** — see headings, bold, lists rendered as you type, not raw syntax. Feels like Google Docs for markdown.
2. **Real-time collaboration with cursors** — see who's editing, where they are, live.
3. **Comments anchored to text** — click a passage, leave a comment, it stays attached even as content shifts around it.
4. **Seamless git integration** — one-click push, auto-sync from GitHub, co-authored commits.
5. **Instant file browsing** — lazy Hocuspocus means clicking through files is fast, no loading spinners.
6. **Activity feed** — know when someone comments or updates a doc without checking manually.
7. **Suggestions that don't block** — approved suggestions queue and auto-apply, no frustrating "try again later."

### What users might hate

1. **Markdown normalization** — if their carefully formatted markdown gets normalized by the round-trip, they'll be annoyed by noisy diffs. This is the #1 UX risk.
2. **Unsupported markdown features** — frontmatter (YAML), MDX, custom directives, complex HTML blocks may not survive the TipTap parse. These are common in agentic markdown files.
3. **Can't see raw markdown** — some developers want the raw text, not WYSIWYG. Consider a "Source mode" toggle that shows the raw markdown in a CodeMirror-style view.
4. **Bot commits in git history** — same as v4, partially mitigated by co-authored-by trailers.
5. **No notifications outside the app** — same as v4, activity feed helps but email/Slack is missing.
6. **Comments lost when Yjs state resets** — if a GitHub sync happens while nobody is editing, comment marks are lost and fall back to approximate line positions.

### UX recommendations for MVP

1. **Run the round-trip fidelity test suite** (Section 10) before launch.
2. **Add a "Source" toggle** — switch between TipTap WYSIWYG and a read-only raw markdown view. Developers will want this.
3. **Handle frontmatter** — many agentic markdown files start with YAML frontmatter (`---\ntitle: ...\n---`). Add a TipTap extension that preserves it as an opaque block.
4. **Show unpushed changes badge** — persistent indicator of how many files have unsaved work.

---

## 17. MVP Scope Summary

### In scope
- GitHub App + webhook inbound sync
- File tree with category filtering
- **Google Docs-style WYSIWYG markdown editing (TipTap + Hocuspocus)**
- **Bidirectional markdown conversion** (`@tiptap/markdown`)
- Cursor presence and awareness (TipTap collaboration extensions)
- y-indexeddb crash resilience (zero data loss)
- Lazy Hocuspocus connection (read-only view → CRDT on focus)
- In-app activity feed with unread counts
- **Comments as TipTap marks** (anchored in CRDT, metadata in Convex)
- Suggestions with queue-and-auto-apply
- Manual "Push to GitHub" with co-authored-by commits
- Manual "Re-sync from GitHub"
- GitHub OAuth
- Edit lock for incoming GitHub changes during active editing
- Markdown round-trip fidelity safeguards (Layers 1-2)
- Graceful 1MB file handling
- Default branch only

### Strongly recommended additions
- Source mode toggle (raw markdown view)
- Frontmatter preservation extension
- Round-trip fidelity test suite

### Out of scope (future)
- Loro migration (Peritext-native CRDT for rich text)
- Auto-push to GitHub
- Branch/PR workflows
- Merging GitHub changes into live editing sessions
- GitLab/Bitbucket
- Email/Slack notifications
- AI-powered features
- Multi-instance Hocuspocus (Redis adapter)
- File creation/deletion from with.md
- Custom markdown syntax extensions (MDX, admonitions)
