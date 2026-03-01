export const WITH_MD_SHARE_SKILL_NAME = 'with-md-share';

export const WITH_MD_SHARE_SKILL_MD = `---
name: with-md-share
description: Use with.md public share APIs to create share links, fetch edited markdown, and update shared docs safely with version checks.
---

# with-md-share

Use this workflow when a user asks to publish markdown for humans and keep syncing edits through with.md links.

Base URL: https://with.md

## Endpoints

### Anonymous shares

1. Create share: POST /api/public/share/create
2. Read share: GET /api/public/share/:shareId
3. Update share: PUT /api/public/share/:shareId
4. Raw markdown: GET /s/:shareId/raw

### Repo shares

1. Read repo share: GET /api/public/repo-share/:token
2. Update repo share: PUT /api/public/repo-share/:token
3. Raw markdown: GET /r/:token/raw

## Workflow

1. Create share
   - POST https://with.md/api/public/share/create
   - Body: { content, title?, filename?, expiresInHours? }
   - Save: shareId, editSecret, viewUrl, rawUrl, expiresAt
2. Send human-facing link
   - Use viewUrl
3. Poll/fetch latest
   - GET https://with.md/api/public/share/:shareId
   - Compare version to detect changes
4. Update safely
   - PUT https://with.md/api/public/share/:shareId
   - Body: { editSecret, content, ifMatch? }
   - Prefer ifMatch (or If-Match header) for optimistic concurrency
5. Repo-share variant
   - Read: GET https://with.md/api/public/repo-share/:token
   - Update: PUT https://with.md/api/public/repo-share/:token
   - Body: { editSecret, content, ifMatch? }
   - Raw: GET https://with.md/r/:token/raw

## Expected errors

1. 400 invalid request
2. 403 invalid edit secret
3. 404 missing or expired share
4. 409 version mismatch
5. 413 payload too large (>1MB)
6. 429 rate limited

## Guardrails

1. Never expose editSecret unless explicitly requested.
2. Treat version as source of truth for concurrency.
3. On 409, re-fetch latest and merge before retry.
4. Respect 429 Retry-After.
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
