# Agent Repo-Share and Repo-Write Plan

## Goal

Enable terminal agents (Codex/Claude Code) to programmatically create repo shares and update repo markdown files without relying on browser session cookies.

## Product Rules

1. Public anonymous share flows stay public.
2. Repo-bound actions require auth.
3. Browser auth is for humans; agents use dedicated scoped tokens.
4. Agent writes should queue changes by default (no auto-push by default).

## Phase 1: Agent Token Infrastructure

1. Add `agentTokens` table in Convex.
2. Store only token hash (never raw token).
3. Fields:
   - `ownerUserId`
   - `name`
   - `tokenHash`
   - `scopes`
   - `repoIds`
   - `pathPrefixes`
   - `expiresAt`
   - `revokedAt`
   - `createdAt`
   - `lastUsedAt`
4. Add indexes:
   - `by_owner`
   - `by_token_hash`
   - `by_expiry`

## Phase 2: Token Management APIs (Human Auth Required)

1. `POST /api/agent/tokens/create`
2. `GET /api/agent/tokens`
3. `POST /api/agent/tokens/revoke`
4. Return raw token only once at creation.

## Phase 3: Repo-Share Create for Agents

1. Extract existing repo-share create logic into shared service.
2. Add `POST /api/agent/repo-share/create` with `Authorization: Bearer <agent_token>`.
3. Validate:
   - token active/not expired
   - required scope (`repo-share:create`)
   - repo and path constraints
4. Return:
   - `viewUrl`
   - `editUrl`
   - `expiresAt`

## Phase 4: Agent File Upsert

1. Add `POST /api/agent/files/upsert`.
2. Input:
   - `repoId`
   - `path`
   - `content`
   - optional `branch`
3. Behavior:
   - create file if missing
   - update via existing canonical save path if present
   - queue push entry
4. Enforce token scopes (`files:write`) and path prefixes.

## Phase 5: UI Redirect Behavior

1. Keep public view/edit routes (`/s/*`, `/r/*`, raw) accessible.
2. For repo-bound actions, if unauthenticated:
   - redirect to GitHub auth
   - preserve `next=` return URL

## Security Requirements

1. Separate rate limits for agent endpoints.
2. Scope model:
   - `repo-share:create`
   - `files:write`
   - optional `push:request`
3. Path-level allowlist support (e.g. `docs/**`).
4. Audit log every agent write/share action.
5. Easy token revocation.

## Testing Plan

1. Unit:
   - token hash/validation
   - scope checks
   - path-prefix checks
2. Integration:
   - create token -> create repo share -> read/update via public repo-share API
   - create token -> upsert file -> queued push
3. Negative:
   - revoked/expired token
   - missing scope
   - unauthorized repo/path
4. E2E:
   - create token in UI
   - use token from terminal
   - verify with.md and GitHub sync behavior

## Rollout

1. Phase A: token infra + `agent/repo-share/create`
2. Phase B: `agent/files/upsert`
3. Phase C: optional `agent/push` endpoint

## Definition of Done (MVP)

1. Terminal agent can create repo shares using bearer token auth.
2. Terminal agent can update shared repo docs with existing public repo-share update flow.
3. No dependence on browser cookies for agent automation.
4. Scoped and revocable agent credentials are enforced.
