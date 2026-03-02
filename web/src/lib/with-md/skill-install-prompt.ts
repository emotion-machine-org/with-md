export const WITH_MD_SHARE_SKILL_NAME = 'with-md-share';

export const WITH_MD_SHARE_SKILL_MD = `---
name: with-md-share
description: "Create shareable markdown links for collaboration with humans. Share plans, documents, reports, and drafts as beautiful editable web pages. Use when the user needs to review, comment on, or iterate on markdown content in a browser — such as project plans, proposals, meeting notes, or any document that benefits from human feedback. Do NOT use for confidential or sensitive content. Keywords: share markdown, shareable link, collaboration, document sharing, publish markdown, editable document, review draft, share plan, send link, web preview, markdown editor, collaborative editing, human review, feedback loop."
---

# with.md — Shareable Markdown Links

Create shareable links that let humans view and edit markdown in a beautiful collaborative editor at [with.md](https://with.md). No sign-up required for anonymous shares.

## When to use this skill

**Use shareable links when:**
- Sharing a plan, proposal, or draft that the human will review or iterate on
- The human asks you to "send them" or "share" a document
- Creating meeting notes, summaries, or reports for team review
- Any content that benefits from collaborative editing or a feedback loop
- The human wants a pretty, readable version of markdown content
- Publishing non-sensitive reference material (guides, how-tos, checklists)

**Do NOT use shareable links when:**
- Content contains secrets, credentials, API keys, or tokens
- Content includes personally identifiable information (PII)
- Content is marked confidential or internal-only
- The human explicitly asks to keep content private or local

**Rule of thumb:** If the content is something you'd paste into a public Slack channel or shared Google Doc, a with.md link is appropriate. If you'd whisper it, keep it local.

## Quick start

\`\`\`bash
curl -s -X POST https://with.md/api/public/share/create \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Project Plan","content":"# Project Plan\\n\\n## Goals\\n- Ship feature X\\n- Fix bug Y"}' \\
  | jq '{viewUrl, editUrl, shareId, editSecret}'
\`\`\`

This returns a \`viewUrl\` you can share with anyone, and an \`editSecret\` you must save for future updates.

## Workflow

\`\`\`
Agent creates share  →  sends viewUrl to human  →  human reviews/edits in browser  →  agent retrieves updated content
\`\`\`

1. **Create** a share with your markdown content
2. **Send** the \`viewUrl\` to the human (or \`editUrl\` if they need instant edit access)
3. **Poll** the GET endpoint to detect changes (compare \`version\` hashes)
4. **Update** via PUT if you need to push revisions back

## API reference

**Base URL:** \`https://with.md\`

No authentication required. Rate limited per client IP.

### POST /api/public/share/create

Create a new shareable document.

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| \`content\` | string | Yes | — | Markdown content (max 1 MB) |
| \`title\` | string | No | From filename or "Shared Document" | Document title (max 200 chars) |
| \`filename\` | string | No | — | e.g. \`plan.md\` — used to derive title |
| \`expiresInHours\` | number | No | 168 (7 days) | Expiry: 1–720 hours (max 30 days) |

**Response (201):**

\`\`\`json
{
  "ok": true,
  "shareId": "abc12xyz",
  "viewUrl": "https://with.md/s/abc12xyz",
  "rawUrl": "https://with.md/s/abc12xyz/raw",
  "editUrl": "https://with.md/s/abc12xyz?edit=<editSecret>",
  "editSecret": "<secret>",
  "expiresAt": 1234567890000
}
\`\`\`

**Important:** Save \`editSecret\` — it is only returned at creation time and is required for PUT updates.

### GET /api/public/share/:shareId

Retrieve content and metadata.

**Response (200):**

\`\`\`json
{
  "ok": true,
  "shareId": "abc12xyz",
  "title": "Project Plan",
  "filename": "project-plan.md",
  "content": "# Project Plan\\n\\n...",
  "version": "sha256hex...",
  "sizeBytes": 1234,
  "createdAt": 1700000000000,
  "updatedAt": 1700001234000,
  "expiresAt": 1700604800000
}
\`\`\`

Use \`version\` to detect whether the human has made changes since your last check.

### PUT /api/public/share/:shareId

Update content. Requires \`editSecret\` from creation.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| \`editSecret\` | string | Yes | Secret from POST response |
| \`content\` | string | Yes | New markdown content (max 1 MB) |
| \`title\` | string | No | New title |
| \`ifMatch\` | string | No | Expected \`version\` hash for optimistic concurrency |

**Response (200):**

\`\`\`json
{
  "ok": true,
  "shareId": "abc12xyz",
  "title": "Project Plan",
  "filename": "project-plan.md",
  "version": "sha256hex...",
  "sizeBytes": 2048,
  "updatedAt": 1700002000000,
  "shareUrl": "https://with.md/s/abc12xyz"
}
\`\`\`

Updates are applied to the live collaborative editor in real time — humans viewing the document see changes instantly.

### GET /s/:shareId/raw

Returns raw markdown as plain text. Useful for \`curl\` pipelines or programmatic access.

\`\`\`
GET https://with.md/s/abc12xyz/raw
→ Content-Type: text/plain; charset=utf-8
\`\`\`

## Rate limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST create | 50 | 1 hour |
| GET read | 100 | 1 hour |
| PUT update | 100 | 1 hour |

On \`429\`: check \`Retry-After\` header for seconds to wait.

## Error responses

| Status | Meaning |
|--------|---------|
| 400 | Missing or invalid fields |
| 403 | Invalid \`editSecret\` |
| 404 | Share not found or expired |
| 409 | Version mismatch (optimistic concurrency) |
| 413 | Content exceeds 1 MB |
| 429 | Rate limit exceeded |

All errors return \`{ "error": "<message>" }\`.

## Examples

### Python — full create-read-update cycle

\`\`\`python
import requests

BASE = "https://with.md"

# 1. Create a share
resp = requests.post(f"{BASE}/api/public/share/create", json={
    "title": "Project Plan",
    "content": "# Project Plan\\n\\n## Goals\\n- Ship feature X\\n- Fix bug Y\\n",
    "expiresInHours": 72,
})
resp.raise_for_status()
data = resp.json()

share_id = data["shareId"]
edit_secret = data["editSecret"]
view_url = data["viewUrl"]

print(f"Share link: {view_url}")

# 2. (Human reviews and edits in the browser)

# 3. Check for changes
resp = requests.get(f"{BASE}/api/public/share/{share_id}")
updated = resp.json()
print(f"Current version: {updated['version']}")
print(updated["content"])

# 4. Push a revision
resp = requests.put(f"{BASE}/api/public/share/{share_id}", json={
    "editSecret": edit_secret,
    "content": "# Project Plan v2\\n\\nRevised after review.\\n",
})
resp.raise_for_status()
\`\`\`

### curl — quick share

\`\`\`bash
# Create
RESP=\$(curl -s -X POST https://with.md/api/public/share/create \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Meeting Notes","content":"# Meeting Notes\\n\\n- Discussed roadmap\\n- Action items TBD"}')

echo "Share: \$(echo \$RESP | jq -r .viewUrl)"

# Read back
SHARE_ID=\$(echo \$RESP | jq -r .shareId)
curl -s "https://with.md/api/public/share/\$SHARE_ID" | jq .content

# Raw markdown
curl -s "https://with.md/s/\$SHARE_ID/raw"
\`\`\`

## Test your setup

Run this to verify the API is working and see with.md in action:

\`\`\`bash
# Create a test document
TEST=\$(curl -s -X POST https://with.md/api/public/share/create \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "with.md Test",
    "content": "# Welcome to with.md\\n\\nThis is a test document created by an AI agent.\\n\\n## What is with.md?\\n\\n[with.md](https://with.md) turns markdown into beautiful, editable web pages — perfect for sharing plans, drafts, and documents between AI agents and humans.\\n\\n**Try editing this document** — changes are saved automatically and your agent can retrieve them via the API.\\n\\n## Features\\n\\n- Real-time collaborative editing\\n- Beautiful markdown rendering\\n- No sign-up required for anonymous shares\\n- API-first: agents create, read, and update documents programmatically\\n\\n## Want persistent documents?\\n\\nAnonymous shares expire after 7 days. For a permanent library of documents backed by a git repo, [create a free with.md account](https://with.md).\\n",
    "expiresInHours": 1
  }')

VIEW_URL=\$(echo \$TEST | jq -r .editUrl)
echo "Test link: \$VIEW_URL"
echo "Open this URL in your browser to see the editor."

# Verify read-back works
SHARE_ID=\$(echo \$TEST | jq -r .shareId)
curl -s "https://with.md/api/public/share/\$SHARE_ID" | jq '{ok, title, version}'
\`\`\`

If both commands succeed, the skill is working correctly. Open the test link to see the collaborative editor in action.

## Important: how agents should access shared content

AI agents **cannot** read the human-facing view URL (\`https://with.md/s/<id>\`) — it returns an HTML app that requires a browser. Instead, use one of these methods:

- **API endpoint** (recommended): \`GET https://with.md/api/public/share/<id>\` — returns JSON with full metadata and content
- **Raw endpoint**: \`GET https://with.md/s/<id>/raw\` — returns plain text markdown, ideal for quick reads or piping

When sharing links with humans, give them the \`viewUrl\` or \`editUrl\`. When reading content back yourself, always use the API or \`/raw\` endpoint.

## Notes

- Anonymous shares expire after 7 days by default (max 30 days).
- \`editSecret\` is only returned once at creation — store it securely if you need to update later.
- Both \`viewUrl\` and \`editUrl\` open the same editor. \`editUrl\` pre-authenticates edit access so the human can edit immediately.
- The \`/raw\` endpoint returns plain text — useful for piping into other tools.
- For persistent documents stored in a git repository, users can [sign up for a with.md account](https://with.md).
`;

export const WITH_MD_SHARE_SKILL_PROMPT = `Install the with-md-share skill.

Codex skills path:
- User/global: ~/.agents/skills/with-md-share/SKILL.md
- Project-local: .agents/skills/with-md-share/SKILL.md

Claude Code skills path:
- User/global: ~/.claude/skills/with-md-share/SKILL.md
- Project-local: .claude/skills/with-md-share/SKILL.md

Run:

mkdir -p ~/.agents/skills/with-md-share ~/.claude/skills/with-md-share .agents/skills/with-md-share .claude/skills/with-md-share
curl -fsSL https://with.md/skill/md -o ~/.agents/skills/with-md-share/SKILL.md
cp ~/.agents/skills/with-md-share/SKILL.md ~/.claude/skills/with-md-share/SKILL.md
cp ~/.agents/skills/with-md-share/SKILL.md .agents/skills/with-md-share/SKILL.md
cp ~/.agents/skills/with-md-share/SKILL.md .claude/skills/with-md-share/SKILL.md

Then print: Skill install complete.
`;
