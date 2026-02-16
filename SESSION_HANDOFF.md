# with-md Session Handoff

## 1. Outcome Summary
This session moved `with-md` from unstable realtime behavior to a much more reliable baseline, then exported it as a standalone repo.

Main shipped outcomes:
- Realtime sync is websocket-first and much faster in normal local use.
- Reconnect/bootstrap flow is idempotent and less race-prone.
- Duplication/corruption risk was reduced with deterministic bootstrap and persist normalization.
- File switching no longer remounts the entire page route; shell stays stable.
- Main document content now correctly updates per file switch.
- Drag-and-drop local markdown import shipped (files + folders, conflict resolution, rename/move support).
- File tree UI was redesigned to a cleaner, indentation-first style.
- Unsynced file signaling (local edits / queued push) was added in the file tree.
- `with-md` was split and published to `emotion-machine-org/with-md` as a standalone repo root.

## 2. Problems We Started With
High pain points observed repeatedly:
- 5-10s lag between browser windows.
- `plugin/README.md` and top-level `README.md` showing repeated duplicated content.
- Occasional empty leading paragraph / blank line artifact.
- Collab auth warnings and websocket disconnect noise.
- Route/file switches remounting too aggressively and causing stale or incorrect content behavior.

## 3. Root Cause Analysis (Duplication + Lag)
Primary issues were architectural race conditions, not just UI:
- Bootstrap replay races: reconnect paths could re-apply markdown/bootstrap logic while doc state already existed.
- Competing persistence timing: manual/disconnect persistence could race with normal Hocuspocus store lifecycle.
- Stale local cache interactions: local CRDT cache could reintroduce stale state after canonical content changed.
- Non-idempotent state restoration under reconnect/version drift conditions.
- Missing or weak lifecycle coordination between `onLoadDocument`, store, and disconnect cleanup.

Why this produced duplication:
- Old state and new state could both be applied in the same reconnect window.
- Markdown/Yjs bootstraps could run more than once for the same effective version.
- Repeated document sections then got persisted, and only guardrail dedupe could clean symptoms after the fact.

## 4. Core Fixes Shipped

### 4.1 Hocuspocus bootstrap/store lifecycle hardening
Key file: `hocuspocus-server/src/index.ts`

Implemented patterns:
- In-flight bootstrap lock per doc (`bootstrapInFlightByDoc`) to avoid double bootstrap.
- Version tracking per doc (`loadedVersionByDoc`) to detect drift and only rebootstrap when needed.
- Deterministic load flow:
  - clear existing Yjs doc state before rebootstrap paths
  - prefer remote Yjs snapshot when valid
  - fallback to markdown bootstrap when needed
- Persist path normalization metadata and logging for deterministic diagnostics.
- Oversized handling/report throttling to avoid noisy loops.
- Disconnect cleanup changed to avoid double-store races; rely on canonical Hocuspocus flush lifecycle.

### 4.2 Convex collab endpoint stability and conflict handling
Key files:
- `convex/collab.ts`
- `convex/http.ts`

Implemented patterns:
- Safer store/onAllDisconnected handling with normalized metadata.
- Write-conflict path handled gracefully (`concurrent_conflict_skipped`) instead of uncaught loop behavior.
- Oversized content policy consistently enforced in collab endpoints.
- Snapshot storage cleanup logic for replaced/unused blobs.

### 4.3 Client provider lifecycle cleanup
Key file: `web/src/hooks/with-md/use-collab-doc.ts`

Implemented patterns:
- Stronger provider lifecycle logs (`open`, `connect`, `authenticated`, `synced`, `close`, `disconnect`, `destroy`).
- Provider teardown cleanup on effect unmount.
- IndexedDB cache gating + reset behavior on content hash drift.
- Missing URL handling path surfaced cleanly.

### 4.4 File switch correctness without shell remount
Key files:
- `web/src/components/with-md/file-tree.tsx`
- `web/src/components/with-md/with-md-shell.tsx`

Implemented patterns:
- In-shell file selection via callback instead of full route navigation.
- URL updates with History API (`pushState` / `replaceState`) and `popstate` sync.
- Local file context switching for faster UX.
- Critical fix: keying document surface by file id to force correct editor subtree refresh:
  - prevents stale content from previous file staying visible.

### 4.5 Drag-and-drop local markdown import feature
Key files:
- `web/src/components/with-md/import-drop-overlay.tsx`
- `web/src/components/with-md/import-review-sheet.tsx`
- `web/src/components/with-md/with-md-shell.tsx`
- `convex/mdFiles.ts`
- `web/src/lib/with-md/api.ts`
- `web/src/lib/with-md/types.ts`
- `web/src/lib/with-md/convex-functions.ts`

Shipped behavior:
- Drop files/folders anywhere into UI -> import review flow.
- Root-drop defaults to root path.
- Conflict handling includes keep-both and replace strategies.
- Rename/move flows integrated for post-import organization.
- URL switches to imported file after successful import.
- Undo toast was introduced, then removed per product decision.

### 4.6 File tree and interaction polish
Key files:
- `web/src/components/with-md/file-tree.tsx`
- `web/src/styles/with-md.css`

Shipped UX changes:
- Cleaner indentation-first tree style.
- Folder icon kept, doc icon removed.
- Removed leftover gap from removed icon.
- Removed hover radius for flatter look.
- Files panel persistence behavior improved (stays open during file switches/editing unless explicitly closed).

### 4.7 Dirty/unsynced signaling and Git sync behavior
Key files:
- `web/src/components/with-md/with-md-shell.tsx`
- `web/src/components/with-md/collab-editor.tsx`
- `web/src/app/api/github/sync/route.ts`

Shipped behavior:
- Local edits can be marked as unsynced in the file tree.
- Queued push paths and local edited paths merged for visibility.
- Sync flow updated to preserve local-only files and avoid destructive replacement behavior.

## 5. Validation Performed During Session
Validation done during active debugging cycles (before repo split):
- Repeated two-browser realtime typing checks.
- Reconnect stress (close/reopen tab) checks.
- Manual checks for duplication recurrence and activity feed dedupe signals.
- Build/test/typecheck were run in-session on the active branch during stabilization:
  - `npm --workspace web run build`
  - `npm --workspace web run test`
  - `npx tsc --noEmit -p hocuspocus-server/tsconfig.json`

After moving to standalone repo, dependencies were reinstalled and `dev:web` startup was verified.

## 6. Repository Split and Publishing
Completed:
- `with-md` subtree history exported from monorepo.
- New remote repo: `https://github.com/emotion-machine-org/with-md`
- History mismatch issue resolved by replacing target repo main with exported subtree history.
- Result: standalone repo root now correctly contains:
  - `convex/`
  - `hocuspocus-server/`
  - `web/`

## 7. Deployment Model Decision
Final architecture kept for full functionality:
- App 1: `web` (Next.js)
- App 2: `hocuspocus-server` (websocket realtime)
- Backend: hosted Convex deployment

In production, you do not run local `npx convex dev`; both apps point to hosted Convex URL.

## 8. OSS Readiness Plan File
Created plan file:
- `OSS_OPEN_SOURCE_PLAN.md`

Contains:
- P0 blockers before public release
- P1 onboarding improvements
- env contract
- release checklist

Most important P0 items in that plan:
- replace permissive collab token flow (`local-dev-token`) with real signed short-lived token
- enforce authorization boundaries in Convex user-facing functions
- remove session secret fallback default in production

## 9. Key Commits in Current Standalone Repo
Current repo: `emotion-machine-org/with-md`

Notable commits:
- `b21a63e` - frontend optimizations, sync much faster
- `4ea361b` - stabilize file switching + realtime dirty-state updates
- `40bd969` - file tree styling fix
- `56fe001` - OSS open-source plan doc
- `43028b7` - add repo picker (current `main`)

## 10. Local Dev Boot Commands
From `~/projects/with-md`:

```bash
npx convex dev
npm run dev:hocuspocus
npm run dev:web
```

If `next: command not found` appears in fresh clone:

```bash
npm install
```

## 11. Suggested Next Session Prompt Seed
Use this as a starting prompt in a new session:

"Read `SESSION_HANDOFF.md` and `OSS_OPEN_SOURCE_PLAN.md`. Continue from the current standalone `with-md` repo. Prioritize P0 OSS hardening: secure collab token issuance/verification, Convex authorization boundaries, and session secret enforcement. Keep current UX/design intact and do not regress realtime behavior."
