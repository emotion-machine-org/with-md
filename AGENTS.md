# [AGENTS.md](http://AGENTS.md)

Guidance for agents working in this repository.

## Project Purpose

`with.md` is a filesystem-first markdown collaboration app:

- GitHub stores canonical markdown files.
- Convex stores synced file metadata/content and collaboration state.
- Hocuspocus + Yjs power realtime editing.
- Next.js (`web/`) is the product UI and API surface.

## Architecture At A Glance

- `web/`: Next.js 15 app (port `4040`), UI + API routes.
- `convex/`: backend schema/functions (DB, storage, sync metadata, comments, queue).
- `hocuspocus-server/`: websocket collaboration bridge (default port `3001`).

Runtime flow:

1. User authenticates in `web/`.
2. Web app syncs markdown from GitHub into Convex.
3. Realtime editor connects to Hocuspocus.
4. Hocuspocus loads/stores snapshots and markdown through Convex HTTP actions.
5. Changes queue for push back to GitHub.

## Local Development

From repo root:

```bash
npm install
npx convex dev
npm run dev:hocuspocus
npm run dev:web
```

Validation:

```bash
npm run test:web
npm --workspace web run build
npx tsc --noEmit -p hocuspocus-server/tsconfig.json
```

## Repository Map

- `web/src/components/with-md/with-md-shell.tsx`: top-level UI orchestrator.
- `web/src/components/with-md/collab-editor.tsx`: TipTap/Yjs realtime editor.
- `web/src/hooks/with-md/use-collab-doc.ts`: provider lifecycle and IndexedDB behavior.
- `web/src/app/api/auth/collab-token/route.ts`: user realtime token minting.
- `web/src/lib/with-md/collab-token.ts`: token format/signing.
- `convex/collab.ts`: realtime authentication and document load/store logic.
- `convex/http.ts`: internal endpoints used by Hocuspocus.
- `convex/mdFiles.ts`: markdown file CRUD/import/move/delete/save/repair paths.
- `convex/repos.ts`: repo records and fallback seed behavior.
- `hocuspocus-server/src/index.ts`: websocket auth/load/store lifecycle.

## Critical Product Invariants

1. GitHub is source of truth for repository files.
2. Do not enable rich edit for unsupported markdown syntax; preserve Source mode fallback.
3. Realtime load/store must be idempotent; avoid duplicate bootstrap paths.
4. File switching must not leak stale editor state between files.
5. Prefer minimal-diff markdown updates and preserve meaningful content.
6. Keep oversized-file guardrails intact (source-only editing for very large docs).

## Security Expectations

Before public release, do not ship insecure defaults:

- No fallback production secrets for sessions or token peppers.
- No permissive auth paths that allow cross-repo/file access.
- No unsanitized HTML injection paths in editor rendering.
- No unsafe URL schemes (`javascript:`) in link insertion flows.

If you touch auth/collab code, verify both:

- user token verification (`usr1` flow),
- repo-share realtime token verification (`rse1` flow).

## Realtime Editing Guidance

- Treat `hocuspocus-server/src/index.ts` and `convex/collab.ts` as a coupled system.
- Be careful with reconnect, disconnect, and cleanup code; race conditions can duplicate content.
- Avoid introducing non-deterministic bootstrap order.
- Preserve shrink-guard and dedupe protections unless intentionally replaced with stronger logic.

## Convex Rules

- `convex/_generated/*` is generated; do not edit manually.
- Keep external/browser-exposed function surface tightly controlled.
- Any function that reads/writes repo/file/comment data should enforce identity + access.

## Frontend Rules

- Keep read/edit/source mode behavior explicit and testable.
- Avoid adding more cross-coupling into `with-md-shell.tsx`; split logic when feasible.
- Add cancellation guards for async effects that can race during rapid repo/file changes.

## Documentation Policy

- Keep root `README.md` as user-facing setup/architecture documentation.
- Keep this file (`AGENTS.md`) as maintainer/agent operational guidance.
- Avoid reintroducing large planning/handoff markdown files at repo root.
