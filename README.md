# [with.md](http://with.md)

Markdowns are dope! Markdowns are kino!

Filesystem-first markdown collaboration for humans and agents. Edit markdown files stored in GitHub repositories with real-time collaboration, live cursors, anchored comments, and instant synchronization, no proprietary formats, no lock-in.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Services](#services)
  - [Web (Next.js Frontend)](#web-nextjs-frontend)
  - [Convex (Backend)](#convex-backend)
  - [Hocuspocus Server (Real-time)](#hocuspocus-server-real-time)
- [Database Schema](#database-schema)
- [Features](#features)
- [Key Design Decisions](#key-design-decisions)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Known Gotchas](#known-gotchas)

## Architecture Overview

with.md is an npm workspaces monorepo with three services:

```
┌──────────────────────────────────────────────────────────────────────┐
│                         GitHub (source of truth)                     │
└──────────┬──────────────────────────────────────────┬────────────────┘
           │  OAuth + GitHub App API                  │
           ▼                                          ▼
┌─────────────────────┐                  ┌─────────────────────────────┐
│   Next.js Frontend  │◄── WebSocket ──► │    Hocuspocus Server        │
│   (web/)            │                  │    (hocuspocus-server/)      │
│                     │                  │                              │
│  - TipTap editor    │                  │  - Yjs CRDT sync            │
│  - React 19         │                  │  - Document bootstrap        │
│  - iron-session     │                  │  - Content sanitization      │
│  - API routes       │                  │  - Persistence to Convex     │
└────────┬────────────┘                  └──────────┬──────────────────┘
         │                                          │
         │  HTTP queries/mutations                  │  HTTP (load/store)
         ▼                                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Convex (serverless backend)                      │
│                                                                      │
│  - Database (14 tables)       - File operations                      │
│  - Binary storage (Yjs)       - Collaboration auth                   │
│  - Push queue                 - Activity tracking                    │
│  - Comment anchoring          - Anonymous shares                     │
└──────────────────────────────────────────────────────────────────────┘
```

**Data flow**: GitHub is the source of truth. Users sync repos into Convex, edit via the TipTap editor with real-time collaboration through Hocuspocus/Yjs, and push changes back to GitHub. All markdown content and Yjs state is persisted in Convex.

## Services

### Web (Next.js Frontend)

**Stack**: Next.js 15 (App Router), React 19, TypeScript, TipTap v3, Yjs

The frontend lives in `web/` and runs on port 4040. It provides the editor UI, file tree, comments sidebar, and all GitHub integration via API routes.

**Key directories**:

| Path | Purpose |
|------|---------|
| `src/app/api/auth/` | GitHub OAuth flow (login, callback, session, collab tokens) |
| `src/app/api/github/` | Repo listing, branch listing, sync, push, blob fetching |
| `src/app/api/anon-share/` | Anonymous markdown share creation and access |
| `src/app/api/repo-share/` | Authenticated repo file sharing with expiration |
| `src/app/workspace/` | Main application route (requires auth) |
| `src/components/with-md/` | All editor and shell components |
| `src/hooks/with-md/` | Custom hooks for collaboration, auth, comments, modes |
| `src/lib/with-md/` | Utilities, API client, constants |

**Core components**:

- `**with-md-shell.tsx**` — Main application shell. Manages repo/file selection, UI layout, and coordinates all child components.
- `**collab-editor.tsx**` — TipTap rich text editor with real-time collaboration via Hocuspocus. Handles document modes, cursor presence, and comment marks.
- `**source-editor.tsx**` — Raw markdown editor for Source mode with explicit save/apply actions.
- `**document-surface.tsx**` — Switches between Read (rendered markdown), Edit (TipTap), and Source (raw) modes.
- `**file-tree.tsx**` — Hierarchical file browser with drag-and-drop import, file creation/deletion, and rename support.
- `**comments-sidebar.tsx**` — Thread-based comment system with anchor recovery and inline resolution.
- `**diff-viewer.tsx**` — Side-by-side markdown diff viewer for reviewing changes before push.
- `**document-toolbar.tsx**` — Formatting buttons, push/sync actions, mode switching, share controls.
- `**activity-panel.tsx**` — Feed of edits, comments, pushes, and syncs with unread indicators.
- `**presence-strip.tsx**` — Live cursor/peer indicators showing who is currently editing.
- `**branch-switcher.tsx**` — Branch navigation and switching.
- `**repo-picker.tsx**` — GitHub repository selection UI.

**Key hooks**:

- `**use-collab-doc.ts**` — Creates and manages the Yjs document, IndexedDB persistence layer, and Hocuspocus WebSocket provider. Handles connection lifecycle, token refresh, and version-based cache invalidation.
- `**use-auth.ts**` — GitHub authentication state (current user, login/logout).
- `**use-comment-anchors.ts**` — Resolves comment anchors in the editor using text quote, prefix/suffix context, heading path, and line number fallback.
- `**use-doc-mode.ts**` — Read/Edit/Source mode state and transitions.

### Convex (Backend)

**Stack**: Convex 1.17, TypeScript

The serverless backend in `convex/` handles all data persistence, authentication, and business logic. There is no traditional server — Convex provides the database, file storage, and serverless functions.

**Core modules**:

| Module | Purpose |
|--------|---------|
| `schema.ts` | Database schema (14 tables) |
| `mdFiles.ts` | File CRUD, GitHub sync, import/delete, oversized file handling, undo |
| `collab.ts` | Real-time collaboration auth (token verification) and Yjs document persistence (load/store via HTTP) |
| `http.ts` | HTTP routes consumed by Hocuspocus for document loading and storing |
| `repos.ts` | Repository management and sync orchestration |
| `comments.ts` | Comment CRUD, threading, resolution |
| `suggestions.ts` | Edit suggestion workflow (pending/accepted/rejected) |
| `activities.ts` | Activity logging and per-user read cursors |
| `pushQueue.ts` | Queued changes for pushing to GitHub |
| `anonShares.ts` | Anonymous share creation, access, rate limiting |
| `users.ts` | User upsert from GitHub profile data |

**Utility libraries** (`convex/lib/`):

- `**collabPolicy.ts**` — Real-time message size limits (900KB default for inline, 1MB for anon shares).
- `**markdownDiff.ts**` — Smart diff detection with normalization (CRLF, trailing whitespace, list markers, blank lines) so cosmetic differences don't flag as changes.
- `**syntax.ts**` — Detects markdown syntax that TipTap cannot round-trip (HTML blocks, footnotes, definition lists, etc.) and gates Edit mode accordingly.
- `**shrinkGuard.ts**` — Detects suspicious content shrinkage (>50% loss) to prevent accidental data loss during collaboration.

### Hocuspocus Server (Real-time)

**Stack**: Hocuspocus v2, Yjs 13.6, TypeScript, Node.js

The WebSocket server in `hocuspocus-server/` bridges TipTap editors via Yjs CRDTs. It runs as a standalone Node process (default port 3001).

**Responsibilities**:

1. **Authentication** — Validates JWT tokens against Convex on each WebSocket connection.
2. **Document loading** — Fetches Yjs snapshots or markdown from Convex, bootstraps into a Yjs document. Prefers binary Yjs snapshots but falls back to markdown parsing if the snapshot is corrupted.
3. **Content sanitization** — Strips leading/trailing placeholder paragraphs, collapses exact content repetitions and heading duplications using KMP-based deduplication.
4. **Persistence** — Encodes Yjs state and sends it to Convex storage on document changes.
5. **Oversized protection** — Documents exceeding 900KB are flagged and excluded from real-time sync.

## Database Schema

14 tables in Convex:

| Table | Purpose | Key indexes |
|-------|---------|-------------|
| `users` | GitHub user profiles (login, avatar, background preference) | `by_github_user_id` |
| `installations` | GitHub App installations per account | `by_github_installation_id` |
| `repos` | Synced GitHub repositories with branch tracking | `by_github_repo_id` |
| `mdFiles` | Markdown files with content, hash, Yjs snapshot reference | `by_repo_branch_path`, `by_repo_and_path` |
| `comments` | Anchored comments with text-based recovery metadata | `by_md_file`, `by_comment_mark_id` |
| `suggestions` | Edit suggestions with accept/reject workflow | `by_md_file_and_status` |
| `pushQueue` | Queued file changes for GitHub push | `by_repo_and_status` |
| `activities` | Activity log (edits, comments, pushes, syncs) | `by_repo`, `by_md_file` |
| `activityReadCursors` | Per-user read position in activity feed | `by_user_and_repo` |
| `anonShares` | Anonymous markdown shares with optional edit access | `by_short_id` |
| `anonRateLimits` | Rate limiting for anonymous operations | `by_bucket` |
| `repoShares` | Shareable links for repo files with expiration/revocation | `by_short_id_hash`, `by_md_file` |
| `webSnapshots` | Latest website-to-markdown snapshot per canonical URL | `by_url_hash`, `by_stale_at` |
| `webSnapshotVersions` | Immutable version history for URL snapshots | `by_snapshot_and_version`, `by_url_hash_and_created_at` |

## Features

### Document Modes

- **Read** — Fast rendered markdown view using `react-markdown` with `remark-gfm`. No editor overhead.
- **Edit** — Rich TipTap editor with real-time collaboration, live cursors, formatting toolbar. Guarded by syntax support detection — if a file contains markdown features TipTap can't round-trip (footnotes, HTML blocks, definition lists, etc.), Edit mode is blocked and the user is directed to Source mode.
- **Source** — Raw markdown textarea with explicit save/apply. Always available regardless of syntax complexity.

### Real-time Collaboration

- **Yjs CRDTs** for conflict-free concurrent editing across multiple users.
- **Live cursors** with user avatars and color-coded selections.
- **IndexedDB caching** (via `y-indexeddb`) for offline capability and fast reconnection.
- **Version-based cache invalidation** — content hash + Yjs snapshot ID detects stale local caches.
- **Oversized document protection** — files exceeding 900KB are excluded from real-time and edited via Source mode.

### GitHub Integration

- **OAuth via GitHub App** — users authenticate and grant repo access.
- **Repository sync** — pulls all `.md` files from a repo/branch into Convex.
- **Manual push** — saves changes back to GitHub as commits with per-file authorship tracking.
- **Branch support** — switch between branches, per-repo branch memory.
- **Diff viewer** — side-by-side comparison before pushing changes.

### Comments and Suggestions

- **Anchored comments** — tied to specific text passages in the document.
- **Fuzzy anchor recovery** — if surrounding text changes, comments recover position using text quote, prefix/suffix context, heading path, and line number fallback.
- **Threaded replies** with resolution tracking.
- **Edit suggestions** — propose specific text changes with accept/reject workflow.

### File Management

- **File tree** with hierarchical folder display.
- **Drag-and-drop import** of `.md` files with conflict resolution.
- **File creation and deletion** with 30-day soft-delete recovery.
- **Change indicators** showing which files have unsaved/unpushed modifications.

### Sharing

- **Anonymous shares** — create a sharable link to a standalone markdown document with optional edit access. Rate-limited.
- **Repository file shares** — time-limited, revocable links to specific repo files. Uses HMAC-SHA256 signed tokens.

### Website to Markdown

- **URL snapshots** — open `/<target-url>` to generate and render a markdown snapshot for a public website.
- **Versioned cache** — latest snapshot is served quickly and immutable versions are stored in `webSnapshotVersions`.
- **Manual refresh** — append `/revalidate` or `/redo` to force a new snapshot.
- **Fallback pipeline** — local heuristic extraction, optional OpenRouter cleanup, Jina fallback, and Firecrawl scrape fallback.

### Activity Tracking

- Activity feed showing edits, comments, pushes, and syncs.
- Per-user unread indicators.

## Key Design Decisions

### GitHub as source of truth

Markdown files live in GitHub. with.md syncs them into Convex for real-time editing and pushes changes back. There is no proprietary storage format — every file is a standard `.md` in a Git repo.

### Syntax gating for Edit mode

TipTap (ProseMirror) cannot losslessly round-trip all markdown syntax. Rather than silently corrupting content, with.md detects unsupported constructs (HTML blocks, footnotes, definition lists, etc.) at sync time and blocks Edit mode for those files. Source mode is always available as a fallback.

### Yjs snapshot + markdown dual storage

Each file stores both raw markdown content and a binary Yjs snapshot in Convex storage. The Hocuspocus server prefers loading from Yjs snapshots (preserving cursor positions and undo history) but falls back to parsing markdown if the snapshot is missing or corrupted. This provides resilience while preserving collaboration state.

### Comment anchor recovery

Comments are anchored with multiple resolution strategies in priority order:

1. **Text quote** — exact match of the highlighted text
2. **Prefix/suffix context** — surrounding text for disambiguation
3. **Heading path** — section-based anchor (e.g., `["## Getting Started", "### Installation"]`)
4. **Line number** — last resort fallback

This makes comments robust against document edits.

### Custom CollaborationCursor extension

`@tiptap/extension-collaboration` v3.19+ uses `@tiptap/y-tiptap` which creates its own `ySyncPluginKey`. The stock `@tiptap/extension-collaboration-cursor` imports `ySyncPluginKey` from `y-prosemirror` — a different instance. ProseMirror matches plugin keys by reference, so the cursor plugin can't find the sync state. with.md uses a custom `CollaborationCursor` extension in `editor-extensions.ts` that imports from `@tiptap/y-tiptap` directly.

### Content sanitization in Hocuspocus

The real-time server sanitizes documents on load to handle edge cases:

- Strips placeholder paragraphs that TipTap inserts
- Detects and collapses exact content repetitions (can occur from race conditions)
- Uses KMP algorithm for deduplication of repeated patterns

### Markdown diff normalization

The diff engine normalizes whitespace, line endings (CRLF to LF), list markers, and blank lines before comparing. This prevents cosmetic differences from showing as changes.

### Shrink guard

Before persisting collaborative edits, a shrink guard checks if content dropped by more than 50%. This catches accidental mass deletions during collaboration and prevents data loss.

## Getting Started

### Prerequisites

- Node.js 20+
- A [Convex](https://convex.dev) account and project
- A [GitHub App](https://docs.github.com/en/apps/creating-github-apps) with repo read/write permissions

### 1. Install dependencies

```bash
npm install
```

### 2. Start Convex

```bash
npx convex dev
```

### 3. Configure environment

Set the Hocuspocus shared secret in Convex:

```bash
npx convex env set HOCUSPOCUS_CONVEX_SECRET "<your-secret>"
```

Create `web/.env.local`:

```env
NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
NEXT_PUBLIC_HOCUSPOCUS_URL=ws://localhost:3001
NEXT_PUBLIC_POSTHOG_ENABLED=0
NEXT_PUBLIC_POSTHOG_TOKEN=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
NEXT_PUBLIC_POSTHOG_AUTOCAPTURE=0
NEXT_PUBLIC_POSTHOG_RECORDING=0

GITHUB_APP_ID=<your-github-app-id>
GITHUB_APP_PRIVATE_KEY=<your-github-app-private-key>
GITHUB_CLIENT_ID=<your-github-client-id>
GITHUB_CLIENT_SECRET=<your-github-client-secret>
GITHUB_WEBHOOK_SECRET=<your-github-webhook-secret>
SESSION_SECRET=<random-32-char-string>
WITHMD_REPO_SHARE_TOKEN_SECRET=<random-32-char-string>
WITHMD_ENABLE_PRIVATE_FONTS=0
WITHMD_PRIVATE_FONTS_STYLESHEET_URL=
```

Create `hocuspocus-server/.env`:

```env
CONVEX_URL=https://<your-deployment>.convex.cloud
HOCUSPOCUS_CONVEX_SECRET=<same-secret-as-convex-env>
PORT=3001
```

### 4. Start Hocuspocus server

```bash
npm run dev:hocuspocus
```

### 5. Start web UI

```bash
npm run dev:web
```

The app will be available at `http://localhost:4040`.

## Environment Variables

### Web (`web/.env.local`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL |
| `NEXT_PUBLIC_HOCUSPOCUS_URL` | WebSocket URL for Hocuspocus (e.g., `ws://localhost:3001`) |
| `NEXT_PUBLIC_POSTHOG_ENABLED` | Set to `1` to enable PostHog client analytics |
| `NEXT_PUBLIC_POSTHOG_TOKEN` | PostHog project token (public/client token) |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog host or reverse-proxy host (default: `https://us.i.posthog.com`) |
| `NEXT_PUBLIC_POSTHOG_AUTOCAPTURE` | Set to `1` to enable PostHog autocapture (default: off) |
| `NEXT_PUBLIC_POSTHOG_RECORDING` | Set to `1` to enable session recordings (default: off) |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM) |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook secret |
| `SESSION_SECRET` | Encryption key for iron-session cookies |
| `WITHMD_REPO_SHARE_TOKEN_SECRET` | HMAC signing key for share tokens |
| `WITHMD_ENABLE_PRIVATE_FONTS` | Set to `1` to enable private font override stylesheet loading |
| `WITHMD_PRIVATE_FONTS_STYLESHEET_URL` | Optional full URL for private font CSS (recommended for Vercel/GitHub-only deploys) |
| `WITHMD_INLINE_REALTIME_MAX_BYTES` | Max document size for real-time sync (default: 900KB) |
| `WITHMD_ANON_REALTIME_MAX_BYTES` | Max anon share size for real-time (default: 1MB) |
| `WEB2MD_CACHE_TTL_DAYS` | Website snapshot staleness window in days (default: `30`) |
| `WITHMD_WEB2MD_RATE_LIMIT_NORMAL` | Anonymous `/api/web-md/resolve` normal requests per hour (default: `60`) |
| `WITHMD_WEB2MD_RATE_LIMIT_REVALIDATE` | Anonymous revalidate requests per hour (default: `18`) |
| `WITHMD_WEB2MD_FORCE_ENGINE` | Optional debug override (`local_heuristic`, `openrouter_gpt_oss_20b`, `jina_reader`, `firecrawl_scrape`) |
| `WITHMD_WEB2MD_DISABLE_LOCAL` | Set to `1` to disable local heuristic stage |
| `WITHMD_WEB2MD_DISABLE_OPENROUTER` | Set to `1` to disable OpenRouter cleanup stage |
| `WITHMD_WEB2MD_DISABLE_JINA` | Set to `1` to disable Jina fallback stage |
| `WITHMD_WEB2MD_DISABLE_FIRECRAWL` | Set to `1` to disable Firecrawl fallback stage |
| `WITHMD_WEB2MD_USER_AGENT` | Optional custom user-agent for heuristic fetches |
| `WITHMD_WEB2MD_ACCEPT_LANGUAGE` | Optional Accept-Language header for heuristic fetches |
| `WITHMD_WEB2MD_HF_TOKEN` | Optional Hugging Face token for protected/rate-limited HF pages |
| `WITHMD_WEB2MD_JINA_API_KEY` | Optional Jina key for higher limits |
| `WITHMD_WEB2MD_JINA_TIMEOUT_MS` | Optional Jina fetch timeout in milliseconds (default: `35000`) |
| `WITHMD_WEB2MD_FIRECRAWL_API_KEY` | Optional Firecrawl key for scrape fallback |
| `WITHMD_WEB2MD_FIRECRAWL_API_BASE` | Optional Firecrawl API base URL (default: `https://api.firecrawl.dev/v2`) |
| `WITHMD_WEB2MD_FIRECRAWL_TIMEOUT_MS` | Optional Firecrawl request timeout in milliseconds (default: `45000`) |
| `WITHMD_WEB2MD_FIRECRAWL_WAIT_FOR_MS` | Optional Firecrawl wait-before-scrape delay in milliseconds (default: `0`) |
| `WITHMD_WEB2MD_FIRECRAWL_MAX_AGE_MS` | Optional Firecrawl cache max-age in milliseconds (default: `0`) |
| `WITHMD_WEB2MD_FIRECRAWL_PROXY` | Optional Firecrawl proxy mode (`basic`, `enhanced`, `auto`; default `auto`) |
| `OPENROUTER_API_KEY` | Optional server-side OpenRouter key for LLM cleanup stage |
| `WITHMD_WEB2MD_LLM_MODEL` | Optional OpenRouter model id (default: `openai/gpt-oss-20b`) |

### Hocuspocus (`hocuspocus-server/.env`)

| Variable | Description |
|----------|-------------|
| `CONVEX_URL` | Convex deployment URL |
| `HOCUSPOCUS_CONVEX_SECRET` | Shared secret for authenticating with Convex |
| `PORT` | WebSocket server port (default: 3001) |

### Convex (set via `npx convex env set`)

| Variable | Description |
|----------|-------------|
| `HOCUSPOCUS_CONVEX_SECRET` | Must match the Hocuspocus server secret |

`WITHMD_WEB2MD_FORCE_ENGINE` is optional and should usually be left unset. The default fallback order is:

1. `local_heuristic`
2. `openrouter_gpt_oss_20b`
3. `jina_reader`
4. `firecrawl_scrape`

## Optional Product Analytics (PostHog)

with.md includes a client-side PostHog bootstrap in `web/src/instrumentation-client.ts`.
It is OSS-safe by default:

- Analytics is disabled unless `NEXT_PUBLIC_POSTHOG_ENABLED=1`.
- No token is hardcoded in the repository.
- Autocapture and session recording are both off by default.

For production:

1. Set `NEXT_PUBLIC_POSTHOG_ENABLED=1`.
2. Set `NEXT_PUBLIC_POSTHOG_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST`.
3. Optionally enable `NEXT_PUBLIC_POSTHOG_AUTOCAPTURE=1` and/or `NEXT_PUBLIC_POSTHOG_RECORDING=1`.

If you use a reverse proxy for PostHog, point `NEXT_PUBLIC_POSTHOG_HOST` to the proxied endpoint.

## Optional Private Font Override

The public/default stack is OSS-safe:

- Sans: `Public Sans`
- Mono: `Server Mono`

For internal deployments where you are licensed to use proprietary fonts:

- Set `WITHMD_ENABLE_PRIVATE_FONTS=1`.
- Pick one delivery path:
- Local/private filesystem path:
Copy `web/public/private-fonts.example.css` to `web/public/private-fonts.css`, then place private binaries in `web/public/fonts/private/`.
- Remote stylesheet path (recommended on Vercel when deploying from GitHub):
Set `WITHMD_PRIVATE_FONTS_STYLESHEET_URL=https://<your-private-cdn>/private-fonts.css` and host referenced font files at that origin.

`web/public/private-fonts.css` and `web/public/fonts/private/` are gitignored.

## Project Structure

```
with-md/
├── convex/                              # Serverless backend
│   ├── schema.ts                        # Database schema (14 tables)
│   ├── mdFiles.ts                       # File operations, sync, import
│   ├── collab.ts                        # Real-time auth & Yjs persistence
│   ├── http.ts                          # HTTP routes for Hocuspocus
│   ├── repos.ts                         # Repository management
│   ├── users.ts                         # User profiles
│   ├── comments.ts                      # Comment CRUD & threading
│   ├── suggestions.ts                   # Edit suggestions
│   ├── activities.ts                    # Activity logging
│   ├── pushQueue.ts                     # GitHub push queue
│   ├── anonShares.ts                    # Anonymous shares
│   └── lib/                             # Shared utilities
│       ├── collabPolicy.ts              #   Size limits
│       ├── markdownDiff.ts              #   Diff normalization
│       ├── syntax.ts                    #   Syntax support detection
│       └── shrinkGuard.ts               #   Content loss prevention
│
├── hocuspocus-server/                   # Real-time WebSocket server
│   └── src/
│       ├── index.ts                     # Server entry point
│       └── table-block.ts              # Table serialization
│
├── web/                                 # Next.js frontend
│   └── src/
│       ├── app/
│       │   ├── page.tsx                 # Landing page
│       │   ├── workspace/               # Main app (authed)
│       │   └── api/                     # API routes
│       │       ├── auth/                #   OAuth flow
│       │       ├── github/              #   Repo/branch/sync/push
│       │       ├── anon-share/          #   Anonymous sharing
│       │       ├── repo-share/          #   Repo file sharing
│       │       └── web-md/              #   Website-to-markdown resolve API
│       ├── components/with-md/          # UI components
│       │   ├── with-md-shell.tsx        #   App shell
│       │   ├── collab-editor.tsx        #   TipTap editor
│       │   ├── source-editor.tsx        #   Raw markdown editor
│       │   ├── web-page-shell.tsx       #   URL snapshot viewer shell
│       │   ├── file-tree.tsx            #   File browser
│       │   ├── comments-sidebar.tsx     #   Comments
│       │   ├── diff-viewer.tsx          #   Diff viewer
│       │   └── tiptap/                  #   Custom TipTap extensions
│       │       ├── editor-extensions.ts #     Extension config
│       │       ├── comment-mark.ts      #     Comment highlighting
│       │       └── table-block.ts       #     Table support
│       ├── hooks/with-md/               # Custom React hooks
│       │   ├── use-collab-doc.ts        #   Yjs doc management
│       │   ├── use-auth.ts              #   Auth state
│       │   ├── use-comment-anchors.ts   #   Anchor resolution
│       │   └── use-doc-mode.ts          #   Mode switching
│       ├── lib/with-md/                 # Utilities & API client
│       │   └── web2md/                  #   URL canonicalize/fetch/convert pipeline
│       └── styles/                      # CSS
│
├── plans/                               # Feature planning docs
├── backgrounds/                         # Visual assets
└── package.json                         # Workspace root
```

## Testing

Tests use Vitest and live in `web/src/`:

```bash
# Run all tests
npm run test:web

# Watch mode
cd web && npm run test:watch
```

Test coverage includes:

- Markdown syntax detection (`convex/lib/syntax.ts`)
- Diff normalization (`convex/lib/markdownDiff.ts`)
- Comment anchor resolution
- GitHub API integration fallbacks

## Known Gotchas

**TipTap plugin key mismatch** — `@tiptap/extension-collaboration` v3.19+ uses `@tiptap/y-tiptap` internally, which creates its own `ySyncPluginKey`. The stock collaboration cursor extension imports from `y-prosemirror` — a different instance. ProseMirror matches plugin keys by reference identity, not string comparison, so the cursor plugin crashes with "ystate is undefined". The fix is in `web/src/components/with-md/tiptap/editor-extensions.ts` (custom `CollaborationCursor` that imports from `@tiptap/y-tiptap`).

**Oversized documents** — Files larger than 900KB (configurable via `WITHMD_INLINE_REALTIME_MAX_BYTES`) are excluded from real-time collaboration and can only be edited in Source mode. The Hocuspocus server checks size on every persist cycle.

**Syntax gating** — Not all markdown renders identically after a TipTap round-trip. Files containing HTML blocks, footnotes, definition lists, or other unsupported constructs will have Edit mode disabled. Check `convex/lib/syntax.ts` for the full list of detected patterns.

**IndexedDB cache staleness** — The client uses `y-indexeddb` for offline caching. If a document is edited through GitHub directly (outside with.md), the local cache may be stale. The version-based invalidation system (content hash + Yjs snapshot ID) handles this, but in rare cases a hard refresh may be needed.
