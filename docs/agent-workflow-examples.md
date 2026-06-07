# Agent workflow examples

These examples show the loop with.md is built for: an agent creates a markdown share, a human edits it in the browser, and the agent reads the edited markdown back before taking the next step.

Use these when you want a human to shape the work before the agent commits to a direction. The agent should share the `editUrl` when the human needs to change the document, then use the API or raw markdown endpoint to read the final text back. Keep `editSecret` private unless you are intentionally giving edit access through the generated edit link.

## Example 1: agent review before work starts

Use this when an agent is about to make product, content, or code changes and the human needs to tighten the brief first.

### What the agent creates

The agent creates a markdown share with a short review brief:

```markdown
# Review before agent work

## Goal
Draft the onboarding email rewrite.

## Proposed approach
- Keep the email under 150 words.
- Lead with the user's next action.
- Avoid launch claims until the founder confirms them.

## Decisions needed
- Which user segment should this email speak to first?
- What is the one action the email should ask for?

## Done when
The founder has edited the goal, constraints, and done state so the agent can work without guessing.
```

The agent creates the share:

```bash
curl -s -X POST https://with.md/api/public/share/create \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Review before agent work",
    "filename": "agent-review-brief.md",
    "content": "# Review before agent work\n\n## Goal\nDraft the onboarding email rewrite.\n\n## Proposed approach\n- Keep the email under 150 words.\n- Lead with the user'\''s next action.\n- Avoid launch claims until the founder confirms them.\n\n## Decisions needed\n- Which user segment should this email speak to first?\n- What is the one action the email should ask for?\n\n## Done when\nThe founder has edited the goal, constraints, and done state so the agent can work without guessing.\n"
  }'
```

It sends the returned `editUrl` to the human.

### What the human edits

The human edits the share in with.md. A useful first edit is to replace broad asks with one firm instruction:

```markdown
## Decisions needed
- Write this for technical founders who already use agents.
- Ask them to paste one rough plan into with.md and edit it once.
```

### What the agent reads back

The agent fetches the latest content and checks the `version`:

```bash
curl -s https://with.md/api/public/share/<shareId> | jq '{version, content}'
```

The readback tells the agent what changed before it starts. The agent then works from the edited goal, constraints, and done state, not from the original draft.

**First-use action:** Create one review brief in with.md before the next agent task, then edit only the `Done when` line so the agent has a concrete finish state.

## Example 2: technical founder planning

Use this when a founder needs to quickly correct a technical plan without living in issue trackers, tickets, or code review.

### What the agent creates

The agent creates a markdown share with a compact implementation plan:

```markdown
# Technical founder plan

## Outcome
Let agents create markdown shares for humans and read edited content back safely.

## Plan
1. Add a public share creation path for agent drafts.
2. Return a human edit link and a programmatic read endpoint.
3. Store the share version so the agent can detect human edits.
4. Keep update writes behind the edit secret.

## Founder check
- Is the default share public enough for first use?
- Which docs should mention this workflow first?
- What should an agent do if the human edits while the agent is writing back?

## Done when
The plan names the first shippable slice and the risk the founder cares about most.
```

The agent sends the `editUrl` so the founder can change priorities, remove risky scope, or add a missing constraint.

### What the human edits

The founder edits the plan directly. For example:

```markdown
## Founder check
- Start with anonymous shares only.
- Mention the workflow in the skill guide and README first.
- If the version changes, re-fetch and ask before overwriting.
```

### What the agent reads back

The agent reads the edited plan through the API:

```bash
curl -s https://with.md/api/public/share/<shareId> | jq -r .content
```

If the agent later writes a cleaned-up version back to the same share, it uses the latest `version` as `ifMatch`:

```bash
curl -s -X PUT https://with.md/api/public/share/<shareId> \
  -H "Content-Type: application/json" \
  -d '{
    "editSecret": "<editSecret>",
    "ifMatch": "<latestVersion>",
    "content": "<revised markdown>"
  }'
```

That keeps the human edit from being overwritten by a stale agent update.

**First-use action:** Create one technical plan share in with.md and edit the `Founder check` section down to the single constraint the agent must not violate.

## Example 3: repository documentation review

Use this when an agent drafts documentation changes and the human needs to review the wording before the agent opens or updates a pull request.

### What the agent creates

The agent creates a markdown share with the proposed documentation text and the exact repo destination:

```markdown
# Repository docs review

## Destination
docs/share-api.md

## Proposed addition
Agents should use with.md when a markdown draft needs human edits before it becomes source-of-truth documentation.

Workflow:
1. Create a markdown share with the draft.
2. Send the edit link to the reviewer.
3. Read the edited markdown back from the API.
4. Apply the accepted text to the repository.

## Reviewer check
- Is this language accurate for the current API?
- Is anything missing before this becomes product documentation?

## Done when
The reviewed text can be applied to the repository without another rewrite pass.
```

The agent creates the share from the draft, sends the `editUrl`, and keeps the `shareId` for readback.

### What the human edits

The reviewer edits the proposed wording in with.md. A practical edit is to add the boundary that protects the repo:

```markdown
Workflow:
1. Create a markdown share with the draft.
2. Send the edit link to the reviewer.
3. Read the edited markdown back from the API.
4. Apply the accepted text to the repository.
5. Show a diff before committing the repository change.
```

### What the agent reads back

The agent fetches the edited markdown:

```bash
curl -s https://with.md/s/<shareId>/raw
```

It applies only the reviewed section to the repo file, then shows the diff or opens a pull request. The share stays useful as the review record, while the repository remains the durable source of truth.

**First-use action:** Create one repository docs review share in with.md for a README or docs change, then add one reviewer requirement before the agent applies the text to the repo.
