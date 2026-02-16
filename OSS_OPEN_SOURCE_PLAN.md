# with.md Open Source Readiness Plan

## Goal
Ship `with-md` as a public repo with full functionality:
- rendered markdown editing
- realtime collaboration
- comments
- GitHub sync/push

without requiring local tribal knowledge or insecure defaults.

## Target Architecture (Production)
Use 2 deployable apps + 1 managed backend:
1. `web` (Next.js)
2. `hocuspocus-server` (Yjs websocket bridge)
3. Convex hosted deployment (managed service, not a Render app)

Both `web` and `hocuspocus-server` point to the same Convex deployment.

## P0 (Must Fix Before Public Release)

### 1) Harden realtime auth
Current risk:
- `web/src/components/with-md/document-surface.tsx` uses a static `authToken="local-dev-token"`.
- `convex/collab.ts` authenticate path is still permissive (`TODO`).

Plan:
- Add `web/src/app/api/collab/token/route.ts` to mint short-lived signed collab tokens from authenticated session data.
- Include claims: `userId`, `githubUserId`, `repoId`, `mdFileId`, `exp` (short TTL).
- Update client collab init to request/use that token.
- Verify token and file access inside `convex/collab.ts` `authenticate`.
- Reject invalid token, expired token, or wrong repo/file access.

### 2) Close Convex authorization gaps
Current risk:
- Browser calls Convex functions directly via `web/src/lib/with-md/api.ts`.
- Many Convex queries/mutations do not enforce user-level authorization.

Plan:
- Enforce repo/file authorization in all user-facing Convex functions.
- Keep internal-only endpoints (`internalQuery`, `internalMutation`) for Hocuspocus paths.
- Add a strict rule: every mutation/query that touches repo/file/comment data validates caller identity and access.

### 3) Remove insecure session fallback
Current risk:
- `web/src/lib/with-md/session.ts` falls back to a hardcoded secret.

Plan:
- Require `SESSION_SECRET` in production and local dev startup checks.
- Fail fast at boot if missing.

### 4) Align docs with real runtime behavior
Current risk:
- `with-md/README.md` still references stale/experimental realtime notes.

Plan:
- Rewrite setup instructions for current architecture.
- Remove stale flags or mark clearly as optional debugging flags only.
- Document exact envs for `web`, `hocuspocus-server`, and Convex.

### 5) Clean seed/default content
Current risk:
- Seed content contains hardcoded external URL assumptions.

Plan:
- Make seed content neutral or configurable.
- Avoid project-specific production URLs in default OSS seed docs.

## P1 (Strongly Recommended for OSS UX)

### 1) Add env templates
Create:
- `with-md/.env.example`
- `with-md/web/.env.example`
- `with-md/hocuspocus-server/.env.example`

Include only required and optional variables with comments.

### 2) Add one-command local startup
Add workspace script:
- `npm run dev:all`

This should run:
- `npx convex dev`
- `npm run dev:hocuspocus`
- `npm run dev:web`

### 3) Add Render blueprint
Create `with-md/render.yaml` with:
- `web` service
- `hocuspocus-server` service
- required env var wiring
- health checks

### 4) Add operational docs
Document:
- websocket connection lifecycle signals
- expected logs for auth/load/store/disconnect
- common failure modes and fixes

## Environment Variable Contract

### `web`
- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_HOCUSPOCUS_URL`
- `SESSION_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`

### `hocuspocus-server`
- `CONVEX_HTTP_URL` (or normalized equivalent accepted by code)
- `HOCUSPOCUS_CONVEX_SECRET`
- `PORT`
- `WITHMD_INLINE_REALTIME_MAX_BYTES` (optional)

### Convex environment
- `HOCUSPOCUS_CONVEX_SECRET`
- any GitHub integration keys required by Convex-side workflows

## Release Checklist
1. Implement all P0 items.
2. Validate local startup from clean clone using only docs.
3. Validate realtime in 2 browsers (<500ms local propagation after connect).
4. Validate no duplication/corruption after reconnect/restart stress loop.
5. Validate GitHub sync/push flows and local-only file preservation behavior.
6. Validate build/tests/typecheck:
   - `npm --workspace web run build`
   - `npm --workspace web run test`
   - `npx tsc --noEmit -p hocuspocus-server/tsconfig.json`
7. Validate no Convex uncaught error loops from collab endpoints.
8. Merge README + env template updates only after final verification pass.

## Post-Launch (Later)
- Multi-instance Hocuspocus scaling with shared state backend + sticky sessions.
- Formal repo membership model in schema (if multi-user org/team support is expanded).
- CI pipeline to run full realtime regression checks on PRs.
