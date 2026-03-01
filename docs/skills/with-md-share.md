# with-md-share Skill Guide

Use this workflow when the user asks to publish markdown for humans and keep syncing edits through with.md links.

## Use Cases

1. "Share this markdown with someone."
2. "Give me a link where a human can edit this doc."
3. "Poll for updates from a shared document."
4. "Update a shared doc programmatically."

## API Contract

Primary reference: [`docs/share-api.md`](../share-api.md)

## Workflow

1. Create share:
   - `POST /api/public/share/create` with `content` (+ optional `title`, `filename`, `expiresInHours`).
   - Persist `shareId`, `editSecret`, `viewUrl`, `rawUrl`, `expiresAt`.
2. Send human-facing link:
   - Use `viewUrl`.
3. Poll or fetch latest:
   - `GET /api/public/share/:shareId`.
   - Compare `version` to detect changes.
4. Update content:
   - `PUT /api/public/share/:shareId` with `editSecret` + `content`.
   - Send `ifMatch` when you need optimistic concurrency.
5. Optional raw retrieval:
   - `GET /s/:shareId/raw`.

## Repo Share Variant

If you have a repo share token:

1. Read: `GET /api/public/repo-share/:token`
2. Update: `PUT /api/public/repo-share/:token` with `editSecret` + `content` (+ optional `ifMatch`)
3. Raw: `GET /r/:token/raw`

## Guardrails

1. Keep `editSecret` private; never show it in user-facing messages unless explicitly requested.
2. Treat `version` as the source of truth for change detection.
3. On `409`, re-fetch latest content and merge before retry.
4. Respect `429` and retry using `Retry-After`.
