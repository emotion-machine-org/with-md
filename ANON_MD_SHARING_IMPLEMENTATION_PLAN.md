# Anonymous Markdown Sharing — Implementation Plan

## TL;DR

- Build anonymous sharing as a **separate data path** from `repos` / `mdFiles`.
- Ship in 2 phases:
  1. Anonymous upload + public share link (read-only).
  2. Realtime collaboration via edit-capability link (`?edit=...`) with Hocuspocus.
- Keep existing GitHub-auth workspace unchanged.
- Add hard guardrails: size limits, rate limits, expiry, noindex, abuse controls.

## Why Separate From Existing Repo Flow

- Current repo model (`repos`, `mdFiles`, `pushQueue`) is git-synced and auth-oriented.
- Current collab auth is still permissive (`local-dev-token` path + TODO checks in `convex/collab.ts`).
- Mixing anonymous docs into repo tables would increase security and product risk.
- Anonymous sharing should be isolated so failure/abuse cannot affect repo workflows.

## Product Scope (Proposed)

### Phase 1 (MVP)

- Anonymous user drags a single `.md` / `.markdown` file.
- Backend creates a short share ID and stores canonical markdown content.
- Return:
  - `viewUrl`: read-only public URL.
  - `editUrl`: capability URL with secret edit key.
- Shared page supports markdown rendering and copy/download.
- No comments/activity/sidebar in anon mode.

### Phase 2 (Realtime)

- Same shared page supports realtime edit (TipTap + Yjs + Hocuspocus) **only** when edit key is present and valid.
- View link remains read-only.
- Store yjs snapshot + markdown in anon-share table, not `mdFiles`.

## Data Model (Convex)

### New table: `anonShares`

- `shortId: string` (URL-safe short ID, unique)
- `title: string` (derived from file name)
- `content: string`
- `contentHash: string`
- `sizeBytes: number`
- `syntaxSupportStatus: string`
- `syntaxSupportReasons: string[]`
- `yjsStateStorageId?: Id<'_storage'>`
- `editSecretHash: string` (hash of edit capability secret, never store raw)
- `createdAt: number`
- `updatedAt: number`
- `expiresAt?: number`
- `isDeleted: boolean`
- `deletedAt?: number`
- `createdByIpHash?: string`

Indexes:

- `by_short_id` on `shortId`
- `by_expires_at` on `expiresAt`

### Optional table: `anonRateLimits` (if DB-backed limiting)

- `bucket: string` (e.g. `create:YYYY-MM-DD:ipHash`)
- `count: number`
- `updatedAt: number`

## API Surface

### Next.js API routes (public-facing)

- `POST /api/anon-share/create`
  - Accept markdown text + filename.
  - Validate size/type/rate-limit.
  - Create `anonShares` row.
  - Return `shareId`, `viewUrl`, `editUrl`, `expiresAt`.
- `POST /api/anon-share/issue-token`
  - Input: `shareId`, optional `editKey`.
  - Output: short-lived collab token (role: `read` or `write`).
  - Used by anon page before opening websocket.

### Convex functions

- `anonShares:create` mutation
- `anonShares:getPublic` query (by `shortId`)
- `anonShares:authenticate` internal query (token + documentName + role check)
- `anonShares:loadDocument` internal query
- `anonShares:storeDocument` internal mutation
- `anonShares:storeDocumentOversized` internal mutation

### Hocuspocus routing

- Keep existing doc behavior for repo files.
- Add document namespace convention:
  - Repo docs: existing `mdFileId` behavior unchanged.
  - Anon docs: `share:{shortId}`.
- In `hocuspocus-server/src/index.ts`, branch by namespace:
  - `share:*` -> anon-share Convex HTTP endpoints.
  - default -> existing collab endpoints.

## UI/UX Plan

### Entry points

- Landing page (`web/src/app/page.tsx`):
  - Add secondary CTA: `Share Markdown Instantly`.
  - Support drag-drop zone for anonymous upload.
- New route:
  - `web/src/app/s/[shareId]/page.tsx`.

### Shared doc page behavior

- View mode (default):
  - Render markdown cleanly.
  - Show lightweight header with share status + copy link.
- Edit mode (capability URL only):
  - Enable realtime editor.
  - No repo-specific UI (file tree, comments panel, branch switch, push/resync).

## Guardrails (Must Have)

- Max upload size (recommend 512 KB for v1).
- Daily upload cap per IP hash (recommend 20/day).
- Websocket/session cap per shared doc (recommend 25 concurrent).
- Auto-expiry (recommend 30 days default).
- `robots` noindex on `/s/*`.
- Reject non-markdown uploads.
- Sanitize rendered output as current markdown renderer already does.

## Security Model

- View URL: public read access.
- Edit URL: capability secret in query string (`?edit=`) for now.
- Store only `editSecretHash` (SHA-256 + server salt).
- Collab token is short-lived (e.g. 10 minutes), signed with env secret.
- Hocuspocus never trusts client role directly; Convex verification is source of truth.

## Implementation Steps (Concrete)

1. Add Convex schema entries and anon share functions.
2. Add Next API routes for create + token issuance.
3. Add new `s/[shareId]` page and a minimal anon share shell.
4. Add landing-page anonymous upload CTA and drag/drop.
5. Add Hocuspocus namespace branching for `share:*`.
6. Add Convex HTTP routes for anon collab load/store/auth.
7. Add guardrails (size/rate/expiry/noindex).
8. Add cleanup job for expired shares (scheduled).
9. Add tests and manual verification matrix.

## Testing Plan

### Unit

- Path/type/size validation.
- Edit key hashing + verification.
- Token issuance + expiration checks.

### Integration

- Create share -> open view URL.
- Open edit URL in two tabs -> realtime sync works.
- View URL cannot mutate doc.
- Expired share returns proper state.
- Oversized realtime payload follows oversize path.

### Manual

- Chrome/Safari drag-drop.
- Mobile open view URL.
- Abuse cases: too many uploads, invalid file types, invalid edit keys.

## Rollout

- Stage 1: hidden behind feature flag.
- Stage 2: enable for a small cohort.
- Stage 3: default on, monitor create volume + websocket load + abuse signals.

## Open Questions (Decision Needed)

1. Should default shared link be strictly read-only, with separate edit link? (recommended: yes)
2. Share expiration default: 7, 30, or 90 days? (recommended: 30)
3. Max markdown upload size for v1: 256 KB, 512 KB, or 1 MB? (recommended: 512 KB)
4. v1 scope single-file only, or multi-file bundle? (recommended: single-file)
5. Keep anonymous comments out of scope for v1? (recommended: yes)
6. Should edit link auto-rotate/revoke from UI in v1? (recommended: no, add in v2)

&nbsp;