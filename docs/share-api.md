# with.md Share API (v1)

Base URL: `https://with.md`

## Purpose

Use this API when an agent needs to:

1. publish markdown for a human,
2. wait for human edits in the browser,
3. retrieve or update markdown programmatically.

## Anonymous Share API

### `POST /api/public/share/create`

Creates a new anonymous share.

Request JSON:

```json
{
  "content": "# Title\n\nBody",
  "title": "Optional title",
  "filename": "optional-name.md",
  "expiresInHours": 72
}
```

Response `201`:

```json
{
  "ok": true,
  "shareId": "abc123xy",
  "viewUrl": "https://with.md/s/abc123xy",
  "rawUrl": "https://with.md/s/abc123xy/raw",
  "editUrl": "https://with.md/s/abc123xy?edit=...",
  "editSecret": "...",
  "expiresAt": 1773000000000
}
```

Notes:

1. `editSecret` is required for later updates.
2. Max content size is 1 MB.

### `GET /api/public/share/:shareId`

Fetches current markdown and metadata.

Response `200`:

```json
{
  "ok": true,
  "shareId": "abc123xy",
  "title": "Shared Document",
  "filename": "shared-document.md",
  "content": "# Title\n\nBody",
  "version": "sha256...",
  "sizeBytes": 123,
  "createdAt": 1772000000000,
  "updatedAt": 1772001000000,
  "expiresAt": 1773000000000
}
```

### `PUT /api/public/share/:shareId`

Updates content for an existing anonymous share.

Request JSON:

```json
{
  "editSecret": "...",
  "content": "# Updated\n\nBody",
  "title": "Optional new title",
  "ifMatch": "sha256..."
}
```

Notes:

1. `ifMatch` is optional optimistic concurrency.
2. You can also send `If-Match: "sha256..."` header.
3. If expected version mismatches, API returns `409`.

## Repo-Share API

Repo-share links are created by authenticated users via UI/server APIs. Agents can read and edit via these public endpoints once they have token + edit secret.

### `GET /api/public/repo-share/:token`

Returns markdown for a repo-backed shared document.

Response `200`:

```json
{
  "ok": true,
  "token": "token",
  "shareId": "token",
  "title": "README",
  "filename": "readme.md",
  "path": "docs/readme.md",
  "content": "# ...",
  "version": "sha256...",
  "sizeBytes": 1024,
  "updatedAt": 1772001000000,
  "expiresAt": 1773000000000,
  "viewUrl": "https://with.md/r/token",
  "rawUrl": "https://with.md/r/token/raw"
}
```

### `PUT /api/public/repo-share/:token`

Updates a repo-shared document with the edit secret.

Request JSON:

```json
{
  "editSecret": "...",
  "content": "# Updated\n\nBody",
  "ifMatch": "sha256..."
}
```

Response `200`:

```json
{
  "ok": true,
  "token": "token",
  "shareId": "token",
  "path": "docs/readme.md",
  "title": "README",
  "filename": "readme.md",
  "version": "sha256...",
  "updatedAt": 1772001000000,
  "sizeBytes": 1024,
  "shareUrl": "https://with.md/r/token",
  "rawUrl": "https://with.md/r/token/raw"
}
```

## Raw Markdown Endpoints

1. Anonymous shares: `GET /s/:shareId/raw`
2. Repo shares: `GET /r/:token/raw`

These return plain text markdown for programmatic clients.

## Error Codes (common)

1. `400` invalid request body or missing required fields.
2. `403` invalid edit secret.
3. `404` share not found or expired.
4. `409` version mismatch (`ifMatch` failed).
5. `413` payload too large (>1 MB).
6. `429` rate limited.
