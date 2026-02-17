# with.md — Pre-Production Review

## CRITICAL (Must fix before prod)

### 1. Hardcoded `"local-dev-token"` auth bypass
**`web/src/components/with-md/document-surface.tsx:80`**
```
authToken="local-dev-token"
```
The collab auth token is hardcoded. Combined with `convex/collab.ts:285-286` which has `// TODO: validate Clerk/GitHub identity and repo access. return { ok: true };`, **any user can authenticate to any document**. This is the single biggest blocker — the entire collab auth path is wide open.

**Fix**: Pass the real session token from the shell, and implement actual identity + repo-access validation in `collab.authenticate`.

### 2. XSS in table-block innerHTML
**`web/src/components/with-md/tiptap/table-block.ts:47-48`**
```typescript
const html = marked.parse(raw || '', { gfm: true, async: false });
dom.innerHTML = typeof html === 'string' ? html : '';
```
User-controlled markdown → `marked.parse()` → raw `innerHTML`. A collaborator can inject `<img onerror="...">` or `<script>` tags via a table's raw markdown. This is a stored XSS vector — the payload persists in the Yjs doc and fires for everyone who opens the file.

**Fix**: Use DOMPurify (or `marked`'s `sanitize` option) before assigning to `innerHTML`.

### 3. `javascript:` link XSS
**`web/src/components/with-md/format-toolbar.tsx:55`**
```typescript
.setLink({ href: linkInput.trim() })
```
No URL validation. A user can set `href` to `javascript:alert(document.cookie)`. TipTap will render this as a clickable link.

**Fix**: Validate that `href` starts with `https://`, `http://`, or `mailto:` before setting.

### 4. Fallback session secret in production
**`web/src/lib/with-md/session.ts:13`**
```typescript
password: process.env.SESSION_SECRET ?? 'fallback-dev-secret-must-be-32-chars!!'
```
If `SESSION_SECRET` env var is missing in production, all sessions use a publicly-known key. Anyone can forge cookies.

**Fix**: Throw at startup if `SESSION_SECRET` is not set in production. Remove the fallback.

### 5. Weak/default pepper for anonymous share edit secrets
**`convex/anonShares.ts:18-19`**
```typescript
const DEFAULT_EDIT_SECRET_PEPPER = 'withmd-anon-share-edit-secret';
const EDIT_SECRET_PEPPER = process.env.WITHMD_ANON_SHARE_EDIT_SECRET_PEPPER ?? DEFAULT_EDIT_SECRET_PEPPER;
```
Same pattern — if the env var isn't set, the pepper is publicly known, making offline brute-force of edit secrets trivial. Same issue exists for `WITHMD_REPO_SHARE_TOKEN_SECRET`.

**Fix**: Require these env vars; fail loud on boot if missing.

---

## HIGH (Should fix before prod)

### 6. No authorization on Convex mutations
Comment/suggestion/activity mutations accept user-provided `authorId`/`actorId` without verifying it matches the authenticated user. Anyone can impersonate anyone. Key files: `convex/comments.ts`, `convex/suggestions.ts`, `convex/activities.ts`.

### 7. No authorization on `mdFiles.importLocalBatch`
**`convex/mdFiles.ts`** — Any user can import files into any repo by passing an arbitrary `repoId`.

### 8. Rate-limit TOCTOU bypass on anonymous shares
**`convex/anonShares.ts:159-203`** — Two concurrent requests can both read `count < maxPerDay` and both increment, exceeding the limit. The check-then-act is not atomic.

### 9. shortId collision race
**`convex/anonShares.ts:215-221`** — No unique constraint on `shortId`. Two concurrent creates with the same shortId can both pass the existence check.

### 10. No .env files in .gitignore root pattern
`.gitignore` only has `.env.local` — the `hocuspocus-server/.env` pattern relies on not being at root. Worth adding a blanket `*.env` or `**/.env` rule. The real `.env` files aren't tracked (confirmed), but this is fragile.

---

## MEDIUM (Fix soon after launch)

### 11. Memory leak in Hocuspocus global maps
`bootstrapInFlightByDoc`, `oversizedReportByDoc`, `loadedVersionByDoc` in `hocuspocus-server/src/index.ts` grow unbounded. When a document is unloaded, these entries are never cleaned. Over days/weeks, this leaks memory.

### 12. Orphaned Yjs storage blobs
When files are overwritten or oversized-marked, old `yjsStateStorageId` blobs aren't always cleaned up. Storage will grow indefinitely.

### 13. Async effect race conditions in shell
**`web/src/components/with-md/with-md-shell.tsx`** — Multiple `await` sequences set state without cancellation guards. Fast file/repo switching can cause stale writes (e.g., comments from file A appearing on file B).

### 14. `pushQueue` entries have empty author attribution
**`convex/collab.ts:421-431`** — `authorLogins: []`, `authorEmails: []` means GitHub commits have no author attribution.

### 15. Activity table missing `_creationTime` index
`activities` table has no index that supports efficient time-ordered queries. As the table grows, `listByRepo` will degrade.

### 16. Dead/unused modules still shipped
- `activity-panel.tsx` — not imported anywhere
- `presence-strip.tsx` — not imported anywhere
- `use-idle-timeout.ts` — not imported anywhere
- `use-syntax-support.ts` — not imported anywhere

These add bundle size and confusion.

---

## LOW (Polish / future)

### 17. Accessibility: nested interactive elements
`comments-sidebar.tsx` has a clickable `span` with `role="button"` nested inside a `button` — invalid HTML and breaks keyboard/screen-reader navigation.

### 18. No file size limit on drag-drop import
Landing page and import overlay accept files without checking size. A 100MB+ file will hang the browser.

### 19. `Math.random()` for comment mark IDs
**`convex/comments.ts:48`** — Fallback ID uses `Math.random().toString(36).slice(2,8)` which is not collision-resistant for concurrent users. Should use `crypto.randomUUID()`.

### 20. `ReactMarkdown` in repo-share-shell may render raw HTML
Older `react-markdown` + `remark-gfm` configs don't strip HTML by default. If share content contains `<script>`, it could execute.

---

## Summary: Blockers before prod

| # | Issue | Effort |
|---|-------|--------|
| 1 | Remove `local-dev-token`, implement real collab auth | Medium |
| 2 | Sanitize `innerHTML` in table-block (DOMPurify) | Small |
| 3 | Validate link URLs (block `javascript:`) | Small |
| 4 | Require `SESSION_SECRET` in prod, remove fallback | Small |
| 5 | Require secret pepper env vars, remove defaults | Small |
| 6 | Add auth checks to Convex mutations | Medium |
