# with.md Drag-and-Drop Markdown Import Plan

## Goal
Allow users to drag local markdown files into with.md so files appear in the repo file tree, become editable/collaborative, and can be pushed to GitHub through the existing push flow.

## Product Constraints
- Keep current UI style and layout language.
- Do not break realtime collaboration behavior.
- No duplicate/corrupt content writes.
- Keep a single canonical markdown write path in Convex.

## Scope (v1)
- Drag/drop `.md` and `.markdown` files.
- Optional folder drop when browser supports directory entries.
- External drop anywhere in the with.md UI imports to repo root.
- Internal drag/drop in file tree moves files across folders/subfolders.
- Import into repo virtual filesystem (`mdFiles` table), not local disk writes.
- Queue imported files to `pushQueue` so existing `Push` action sends them to GitHub.
- Path conflicts on import default to sibling copy (`name (2).md`).
- Users can rename dropped files before import.
- Undo for replace/move/rename operations via UI action and keyboard shortcut.
- Undo window is fixed at 60 seconds.

## Non-goals (v1)
- Two-way watched sync to local machine directories.
- Binary/image uploads.
- Automatic overwrite of actively edited files in another session.

## UX Plan
1. Global drag affordance:
- While dragging local files over app, show a subtle full-shell transparent overlay.
- Overlay content sits in an inset frame (`~100px` from each viewport edge).
- Copy: `Drag & drop markdown files here`.

2. External drop behavior:
- Dropping anywhere in the with.md UI imports to repo root (no per-folder external targeting in v1).
- Overlay remains visible in a "processing" state until import mutation completes and file list refreshes.
- After successful import:
  - Select the first imported file.
  - Navigate URL to `/with-md/:repoId/:path` for shareability.
  - Then dismiss overlay.

3. Import review behavior for v1:
- Show an import review sheet after drop and before commit.
- Every row has editable `target path` (rename in place before import).
- If target already exists, default action is `Keep both` with sibling suggestion (`name (2).md`).
- Per-row actions:
  - `Keep both` (default)
  - `Replace`
  - `Rename target` (manual path edit)
- Batch action: `Import N files`.
- Completion toast includes undo when destructive changes happened:
  - Example: `Imported 9 files. Replaced 2. Undo`.
- Support `Cmd/Ctrl+Z` to undo last file operation when editor text input is not focused.

4. Internal move interaction (file tree):
- User presses and holds on a file row to enter drag mode (long-press threshold, e.g. 220ms).
- While dragging, folder rows become active drop targets.
- Drop on folder moves file under that folder path.
- Drop on tree background moves file to repo root.
- Show ghost row + target highlight during drag.
- Folder rows are draggable too; dropping a folder moves the full subtree.
- Add explicit rename action on file/folder rows (inline rename input or context menu action).

5. Completion feedback:
- Status message + activity log entry with counts.
- Optional action button: `Open first imported file`.

## Architecture
Use one backend mutation for import writes. Do not write imported content through Hocuspocus.

### New Convex mutation
- File: `convex/mdFiles.ts`
- Add `importLocalBatch` mutation:
  - Args:
    - `repoId`
    - `basePath` (optional folder target)
    - `files[]` with:
      - `relativePath`
      - `targetPath` (editable path/name from review sheet)
      - `content`
      - `conflictMode` (`keep_both` | `replace`)
  - Behavior per file:
    - Normalize path (`/`, trim, collapse duplicate slashes, reject `..`, reject abs paths).
    - Allow only markdown extensions.
    - Compute category (`readme`, `docs`, etc.) using same categorization policy.
    - Lookup existing by `repoId + targetPath`.
    - If unchanged (`hasMeaningfulDiff` false): mark `unchanged`.
    - If new: insert `mdFiles` row.
    - If exists and `keep_both`: synthesize sibling path and insert.
    - If exists and `replace`: patch existing row.
    - For changed/new rows:
      - Update `content`, `contentHash`, syntax status/reasons.
      - Clear `yjsStateStorageId` (fresh bootstrap on next collab load).
      - Clear oversize flags.
      - Upsert queued `pushQueue` item for that `mdFileId` (single queued record semantics).
      - Persist reversible undo entry with pre-change snapshot.
  - Return summary:
    - counts (`imported`, `updated`, `unchanged`, `skipped`, `invalid`)
    - `createdOrUpdatedPaths[]` (resolved final paths)
    - `undoGroupId` (for undo action)

### New Convex mutation for tree moves
- File: `convex/mdFiles.ts`
- Add `movePath` mutation:
  - Args:
    - `repoId`
    - `fromPath` (file or folder)
    - `toDirectoryPath` (empty string means root)
    - `conflictMode` (`keep_both` default, optional `replace`)
  - Behavior:
    - Resolve source path and detect file vs folder.
    - Compute destination path normalized.
    - For folder moves, rewrite every descendant path with preserved relative suffix.
    - Reject no-op and invalid traversal paths.
    - If destination exists, default `keep_both` naming for file collisions.
    - For folder collisions, require explicit rename or replace (no implicit merge).
    - Patch all affected `mdFiles.path` rows.
    - Patch queued `pushQueue.path` entries for affected `mdFileId` values.
    - Persist reversible undo entry with pre-change paths.
    - Insert activity (`source_saved` summary: moved file path).
  - Return:
    - `ok`, moved count, `fromPath`, `toPath`, `undoGroupId`.

### New Convex mutation for rename
- File: `convex/mdFiles.ts`
- Add `renamePath` mutation:
  - Args:
    - `repoId`
    - `fromPath` (file or folder)
    - `toPath` (full target path)
    - `conflictMode` (`keep_both` default, optional `replace`)
  - Behavior:
    - Uses same path validation and subtree rewrite rules as `movePath`.
    - Updates matching `pushQueue.path` entries.
    - Persists undo snapshot group with 60s expiry.
  - Return:
    - `ok`, `fromPath`, `toPath`, `undoGroupId`.

### New Convex mutation for undo
- File: `convex/mdFiles.ts`
- Add `undoFileOperation` mutation:
  - Args:
    - `repoId`
    - `undoGroupId`
  - Behavior:
    - Reject if group expired (`createdAt + 60_000`).
    - Load undo entries for group (imports/moves).
    - For each entry:
      - Validate current hash/path still matches expected post-op state.
      - If match, restore pre-op content/path.
      - If mismatch, mark as skipped (protect concurrent edits).
    - Update `pushQueue` rows to restored path/content where applied.
    - Mark undo group consumed.
  - Return:
    - counts (`restored`, `skipped_due_to_drift`).

### New client API surface
- File: `web/src/lib/with-md/convex-functions.ts`
  - Add `mdFilesImportLocalBatch`.
  - Add `mdFilesMovePath`.
  - Add `mdFilesRenamePath`.
  - Add `mdFilesUndoFileOperation`.
- File: `web/src/lib/with-md/api.ts`
  - Add `importLocalBatch(...)`.
  - Add `movePath(...)`.
  - Add `renamePath(...)`.
  - Add `undoFileOperation(...)`.
- File: `web/src/lib/with-md/types.ts`
  - Add import request/result types.
  - Add file-move and undo result types.

## Realtime Safety Rules
To avoid stomping active collab sessions:
- Default conflict mode is `keep_both` for existing files.
- `replace` stays available but is explicit and reversible for 60s.
- For hot files (`editHeartbeat` very recent, e.g. < 30s), show a stronger warning when user selects replace.
- Undo is hash/path guarded to avoid reverting over newer concurrent edits.

This keeps import deterministic without introducing cross-session overwrite races.

## Frontend Changes
- File: `web/src/components/with-md/with-md-shell.tsx`
  - Add global external drag state + overlay orchestration.
  - Keep overlay visible during pending import and list refresh.
  - After import success, route to first imported file path.
  - Add undo toast state with fixed 60s countdown and global `Cmd/Ctrl+Z` handler for last import/move/rename operation (non-editor focus only).
- File: `web/src/components/with-md/file-tree.tsx`
  - Add internal long-press drag start, drag ghost, drop target highlighting.
  - Add callbacks for move operations and root-drop fallback.
  - Add file/folder rename entrypoint and inline rename affordance.
- New: `web/src/components/with-md/import-drop-overlay.tsx`
- New: `web/src/components/with-md/import-review-sheet.tsx`
- New: `web/src/components/with-md/undo-toast.tsx`
- File: `web/src/styles/with-md.css`
  - Add inset transparent overlay (`100px` offset) and processing state styles.
  - Add tree drag/drop target styles aligned with current design tokens.

## Parsing Dropped Files
- Prefer `DataTransferItem` directory traversal when supported.
- Fallback to flat `FileList`.
- Read file content via `File.text()`.
- Normalize line endings to `\n`.
- Deduplicate within a single drop by normalized target path before sending mutation.
- For external drop, always resolve target under repo root in v1.

## GitHub Sync Path
- Imported files are added/updated in `pushQueue`.
- Existing `POST /api/github/push` already commits queued path/content pairs, including brand-new paths.
- No new GitHub API endpoints required for v1.

## Observability
- Add one activity summary entry per batch import:
  - Example: `Imported 7 markdown files (5 new, 2 replaced, 3 auto-renamed)`.
- Add one activity summary entry for move operations (file/folder).
- Add one activity summary for rename operations.
- Add one summary for undo execution (`restored/skipped` counts).

## Validation Plan
1. Unit tests:
- Path normalization and traversal rejection.
- Keep-both sibling naming outcomes.
- Replace conflict outcomes.
- Folder move path rewrite outcomes.
- Rename file/folder outcomes.
- Undo hash/path guard outcomes.

2. Convex mutation tests (or script-level checks):
- New insert, unchanged, replace, keep-both, invalid path.
- PushQueue upsert behavior (no duplicate queued rows per mdFile).

3. Manual:
- Drop files into root and folder.
- Import same file twice (must be unchanged, no duplicates).
- Validate conflict default is sibling copy.
- Rename one dropped file in review sheet and verify path import target.
- Replace existing file and verify file tree + content.
- Verify overlay stays visible until file appears in file tree.
- Verify URL auto-switches to imported file path after success.
- Verify `Cmd/Ctrl+Z` undo restores replaced/moved/renamed state when no newer edits intervened.
- Verify undo expires after 60 seconds.
- Long-press drag a file and a folder to another folder and root; verify move and URL update when selected.
- Rename a file and a folder from tree UI; verify updates and push queue path consistency.
- Push and confirm new file appears on GitHub.
- Open imported file in two tabs and verify realtime still works.

## Design details
- Overlay:
  - Frosted transparent panel with 100px inset, subtle animated dashed border, and polished loading state.
  - Use current token system (`--withmd-*`) for color consistency.
- Import review sheet:
  - Dense but elegant table layout, monospaced path column, inline editable path field.
  - Clear status pills (`new`, `keep both`, `replace`, `invalid`) aligned to existing neutral palette.
- Tree drag/rename:
  - Minimal motion: soft lift shadow on drag ghost, precise folder target highlight.
  - Rename input matches existing file-tree typography and hover states.
- Undo toast:
  - Low-profile bottom dock style, countdown indicator (60s), and keyboard hint (`Cmd/Ctrl+Z`).

## Rollout
1. Implement backend mutation + API typing.
2. Build drop overlay and import review sheet UI.
3. Wire mutation and refresh flow.
4. Add tests.
5. Run:
- `cd web && npm run build`
- `cd web && npm run test`
- `cd hocuspocus-server && npx tsc --noEmit -p tsconfig.json`
