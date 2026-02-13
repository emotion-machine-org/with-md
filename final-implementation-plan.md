# with.md — Final Implementation Plan (Web UI MVP)

## 1. Objective
Build a desktop-first web UI for filesystem-first markdown collaboration that is:
- Beautiful and calm (editorial, cinematic, graceful).
- Fast in read mode, collaborative in rich-text edit mode.
- Safe for real-world markdown with an always-editable Source mode.
- Compatible with git-first backend semantics (manual push, re-sync, low-noise diffs).

This plan is designed for one-pass agentic execution by Codex/Claude Code.

## 2. Locked Decisions
These are fixed and implemented as constraints:
- Source mode is editable.
- Approximate comment recovery is acceptable when CRDT anchors are unavailable.
- Unsupported markdown syntax may fall back to Source mode.
- MVP can be desktop-first (no full responsive polish required).
- One global visual theme for MVP.

## 3. MVP Scope
In scope:
- File list + document page with three modes:
  - `Read` (rendered markdown, no Hocuspocus connection)
  - `Edit` (TipTap + Yjs + Hocuspocus)
  - `Source` (editable markdown)
- Anchored comments with sidebar threads.
- Approximate anchor recovery strategy.
- Manual `Push to GitHub` and `Re-sync` actions.
- Activity feed panel and unpushed changes badge.
- Syntax safety gate (supported -> Edit allowed; unsupported -> Source default).

Out of scope for MVP:
- Full mobile UX parity.
- PR/branch workflows.
- Perfect round-trip fidelity for every markdown dialect.
- Rich MDX/custom directive visual editing.

## 4. Product Behavior (User Flows)
### 4.1 Open a file
1. User opens markdown file.
2. App renders `Read` mode immediately from backend markdown string.
3. App shows comments in sidebar (using best-known anchor data).
4. App runs syntax compatibility check.

### 4.2 Enter rich collaborative editing
1. User clicks editor surface or `Edit` toggle.
2. If syntax supported, app initializes Yjs + IndexedDB + Hocuspocus + TipTap.
3. User edits with presence cursors.
4. Debounced persistence updates backend markdown + Yjs state.

### 4.3 Enter Source mode
1. User toggles `Source`.
2. Source textarea/CodeMirror is editable.
3. User can `Apply to doc` (for supported files) or `Save source` (unsupported files).
4. For supported files, apply action reparses markdown into TipTap doc.

### 4.4 Add comment
1. User selects text in Edit mode.
2. App sets custom comment mark with `commentMarkId`.
3. App stores metadata in backend with anchor snapshot.
4. Sidebar updates in realtime.

### 4.5 Recover comments after CRDT reset
1. If mark missing, app attempts reattach using quote/context/heading/line heuristics.
2. If not found, comment still shows in sidebar with approximate location.

## 5. Frontend Architecture
## 5.1 State machine
Use a strict UI mode state:

```ts
type DocMode = 'read' | 'edit' | 'source';

interface DocState {
  mode: DocMode;
  syntaxSupported: boolean;
  hasDirtySourceBuffer: boolean;
  collabConnected: boolean;
}
```

Rules:
- `read -> edit` only if `syntaxSupported === true`.
- `read -> source` always allowed.
- `source` is always editable.
- `edit <-> source` allowed, but source changes require explicit apply/save action.

## 5.2 Global visual theme
Use one theme matching the provided mood and screenshot:
- Background image: `background_0.jpeg` (default global).
- Dark translucent content card.
- Serif heading for document title and section heads.
- Sans for UI controls.
- Low-saturation accent colors for comments/activity badges.

## 5.3 Data boundaries
Frontend only depends on explicit backend contracts:
- File content and metadata.
- Comments CRUD + suggestions + activity feed.
- Collaboration auth/load/store/disconnect endpoints for Hocuspocus.
- Push/re-sync actions.

No frontend assumptions about git internals.

## 6. Backend Contract (Frontend-facing)
Define/confirm these endpoints before implementation:

```ts
// file fetch
GET /api/with-md/repos/:repoId/files/:fileId
// returns: { mdFileId, path, content, contentHash, fileCategory, editHeartbeat, ... }

// comments
GET    /api/with-md/files/:mdFileId/comments
POST   /api/with-md/files/:mdFileId/comments
PATCH  /api/with-md/comments/:commentId
DELETE /api/with-md/comments/:commentId

// suggestions
GET  /api/with-md/files/:mdFileId/suggestions
POST /api/with-md/files/:mdFileId/suggestions
POST /api/with-md/suggestions/:id/accept
POST /api/with-md/suggestions/:id/reject

// activity
GET /api/with-md/repos/:repoId/activity

// git ops
POST /api/with-md/repos/:repoId/push
POST /api/with-md/repos/:repoId/resync

// collab for Hocuspocus
POST /api/collab/authenticate
POST /api/collab/loadDocument
POST /api/collab/storeDocument
POST /api/collab/onAllDisconnected
```

## 7. File Plan (Web App)
Create this module inside existing Next app:

```text
web/src/app/(authenticated)/with-md/page.tsx
web/src/app/(authenticated)/with-md/[repoId]/[...filePath]/page.tsx

web/src/components/with-md/with-md-shell.tsx
web/src/components/with-md/file-tree.tsx
web/src/components/with-md/document-toolbar.tsx
web/src/components/with-md/document-surface.tsx
web/src/components/with-md/read-renderer.tsx
web/src/components/with-md/source-editor.tsx
web/src/components/with-md/collab-editor.tsx
web/src/components/with-md/comments-sidebar.tsx
web/src/components/with-md/activity-panel.tsx
web/src/components/with-md/presence-strip.tsx

web/src/components/with-md/tiptap/comment-mark.ts
web/src/components/with-md/tiptap/editor-extensions.ts

web/src/hooks/with-md/use-doc-mode.ts
web/src/hooks/with-md/use-collab-doc.ts
web/src/hooks/with-md/use-comment-anchors.ts
web/src/hooks/with-md/use-syntax-support.ts

web/src/lib/with-md/api.ts
web/src/lib/with-md/types.ts
web/src/lib/with-md/syntax.ts
web/src/lib/with-md/anchor.ts
web/src/lib/with-md/markdown-diff.ts

web/src/styles/with-md.css
web/public/with-md/backgrounds/background_0.jpeg
```

## 8. Dependencies
From `web/`:

```bash
npm i @tiptap/core @tiptap/react @tiptap/starter-kit @tiptap/markdown @tiptap/extension-collaboration @tiptap/extension-collaboration-cursor @hocuspocus/provider yjs y-indexeddb
```

Optional (if needed for source editor quality):

```bash
npm i @uiw/react-codemirror
```

## 9. Core Data Types

```ts
export interface MdFile {
  mdFileId: string;
  repoId: string;
  path: string;
  content: string;
  contentHash: string;
  fileCategory: 'readme' | 'prompt' | 'agent' | 'claude' | 'docs' | 'other';
  editHeartbeat?: number;
  pendingGithubContent?: string;
}

export interface CommentAnchorSnapshot {
  commentMarkId: string;
  textQuote: string;
  prefix: string;
  suffix: string;
  headingPath: string[];
  fallbackLine: number;
}

export interface CommentRecord {
  id: string;
  mdFileId: string;
  authorId: string;
  body: string;
  resolvedAt?: number;
  resolvedBy?: string;
  parentCommentId?: string;
  anchor: CommentAnchorSnapshot;
}
```

## 10. Syntax Safety Gate
Implement deterministic safety detection before enabling TipTap Edit mode.

```ts
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;
const MDX_RE = /<\w+[\s\S]*?>|\{[^\n]*\}/;
const DIRECTIVE_RE = /^:{2,}\w+/m;

export function detectUnsupportedSyntax(md: string): {
  supported: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (FRONTMATTER_RE.test(md)) reasons.push('frontmatter');
  if (DIRECTIVE_RE.test(md)) reasons.push('directives');
  if (MDX_RE.test(md)) reasons.push('mdx_or_embedded_jsx');

  return {
    supported: reasons.length === 0,
    reasons,
  };
}
```

Behavior:
- `supported=true`: user can choose Read/Edit/Source.
- `supported=false`: default to Source with non-blocking warning banner.

## 11. TipTap Comment Mark (Custom)
Use custom mark, not TipTap Comments extension, to avoid markdown-conversion fragility.

```ts
import { Mark } from '@tiptap/core';

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes() {
    return {
      commentMarkId: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      {
        'data-comment-id': HTMLAttributes.commentMarkId,
        class: 'withmd-comment-highlight',
      },
      0,
    ];
  },
});
```

## 12. Collab Hook (Yjs + Hocuspocus + IndexedDB)

```ts
export function useCollabDoc(params: {
  mdFileId: string;
  token: string;
  user: { name: string; color: string };
  enabled: boolean;
}) {
  const ydoc = useMemo(() => new Y.Doc(), [params.mdFileId]);

  useEffect(() => {
    if (!params.enabled) return;
    const persistence = new IndexeddbPersistence(`withmd-${params.mdFileId}`, ydoc);
    return () => persistence.destroy();
  }, [params.enabled, params.mdFileId, ydoc]);

  const provider = useMemo(() => {
    if (!params.enabled) return null;
    return new HocuspocusProvider({
      url: process.env.NEXT_PUBLIC_HOCUSPOCUS_URL!,
      name: params.mdFileId,
      document: ydoc,
      token: params.token,
    });
  }, [params.enabled, params.mdFileId, params.token, ydoc]);

  return { ydoc, provider };
}
```

## 13. Source Mode (Editable)
For MVP simplicity and safety:
- Source mode has its own editable buffer.
- Changes are explicit via buttons.
- No hidden autosync between source textarea and live TipTap doc.

Buttons:
- `Apply to Edit Doc` (supported files, reparses markdown into TipTap content).
- `Save Source` (unsupported files, writes markdown directly to backend and queues push item).
- `Discard Source Changes`.

## 14. Comment Anchor Snapshot + Recovery
When creating comment, capture:
- selected quote
- 32-char prefix and suffix context
- heading path at selection
- fallback line number

Recovery order:
1. Find exact `textQuote` unique match.
2. If multiple matches, score by prefix/suffix proximity.
3. If no match, restrict search to `headingPath` section and retry.
4. If still not found, place sidebar link using `fallbackLine`.

Pseudo-code:

```ts
export function recoverAnchor(md: string, anchor: CommentAnchorSnapshot): {start: number; end: number} | null {
  const exactMatches = findAllIndices(md, anchor.textQuote);
  if (exactMatches.length === 1) return span(exactMatches[0], anchor.textQuote.length);

  if (exactMatches.length > 1) {
    const scored = exactMatches
      .map((i) => ({ i, score: contextScore(md, i, anchor.prefix, anchor.suffix) }))
      .sort((a, b) => b.score - a.score);
    return span(scored[0].i, anchor.textQuote.length);
  }

  const section = findSectionByHeadingPath(md, anchor.headingPath);
  if (section) {
    const j = section.indexOf(anchor.textQuote);
    if (j >= 0) return span(section.start + j, anchor.textQuote.length);
  }

  return null;
}
```

## 15. Markdown Fidelity Guard (Client + Backend)
Rules:
- Preserve original markdown when there is no meaningful semantic change.
- Prevent noisy diffs from pure serializer normalization.

Implement helper:

```ts
export function hasMeaningfulDiff(nextMd: string, prevMd: string): boolean {
  const normalize = (s: string) =>
    s
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/__([^_]+)__/g, '**$1**')
      .trim();

  return normalize(nextMd) !== normalize(prevMd);
}
```

Use this guard before patching canonical `mdFile.content`.

## 16. UI Composition
Layout (desktop-first):
- Full-screen scenic background + dark vignette overlay.
- Center document panel (`max-width: 940px`) with glass effect.
- Right sidebar for comments/activity.
- Compact top toolbar with mode toggle + push/resync status.

Style tokens (`web/src/styles/with-md.css`):

```css
:root {
  --withmd-bg-overlay: rgba(10, 16, 18, 0.68);
  --withmd-panel: rgba(12, 14, 18, 0.82);
  --withmd-border: rgba(255, 255, 255, 0.14);
  --withmd-text: rgba(245, 247, 250, 0.94);
  --withmd-muted: rgba(210, 216, 224, 0.72);
  --withmd-comment: rgba(255, 209, 102, 0.28);
}

.withmd-bg {
  background-image: linear-gradient(var(--withmd-bg-overlay), var(--withmd-bg-overlay)), url('/with-md/backgrounds/background_0.jpeg');
  background-size: cover;
  background-position: center;
}

.withmd-panel {
  background: var(--withmd-panel);
  border: 1px solid var(--withmd-border);
  backdrop-filter: blur(3px);
}
```

## 17. Implementation Steps (One-pass Order)
Execute in this order:

1. Create module skeleton files listed in Section 7.
2. Add dependencies (Section 8).
3. Copy `with-md/backgrounds/background_0.jpeg` to `web/public/with-md/backgrounds/`.
4. Build shell (`with-md-shell.tsx`) + toolbar + file tree placeholders.
5. Implement read renderer (react-markdown + remark-gfm).
6. Implement syntax safety hook (`detectUnsupportedSyntax`).
7. Implement Source editor (editable + save/apply/discard).
8. Implement collab hook + TipTap editor + presence.
9. Implement custom comment mark + selection-to-comment flow.
10. Implement comments sidebar and click linking.
11. Implement approximate anchor recovery utilities.
12. Wire push/resync buttons and activity panel.
13. Add fidelity guard helper and hook into save paths.
14. Add test suite and run checks.

## 18. Acceptance Criteria
Functional:
- File opens in read mode instantly.
- Source mode is always editable.
- Supported files can enter collaborative edit mode with cursors.
- Unsupported files open in source mode with warning and can still be edited/saved.
- Comments can be created from selected text and shown in sidebar.
- After synthetic anchor loss, at least one recovery strategy resolves most comments.
- Push/resync actions visible and invokable.

Quality:
- No crashes when switching modes repeatedly.
- No data loss in browser refresh while editing (IndexedDB recovery).
- Noise-only markdown changes are reduced by meaningful-diff guard.

## 19. Testing Plan
Unit tests:
- `syntax.ts`: markdown feature detection.
- `anchor.ts`: quote/context/heading-based recovery logic.
- `markdown-diff.ts`: semantic-diff guard.

Integration tests (component-level):
- mode transitions `read -> edit -> source -> edit`.
- source apply flow updates editor document.
- comment create and sidebar highlight linking.

Manual checks:
- Open 10 representative markdown docs.
- Verify supported vs unsupported routing.
- Verify comment behavior with and without active collab session.
- Verify push and resync button states.

## 20. Risks and Mitigations
Risk: TipTap markdown conversion normalizes formatting.
Mitigation: semantic-diff guard + source mode fallback.

Risk: comment marks lost after Yjs reset.
Mitigation: approximate anchor recovery using quote/context/heading/line.

Risk: unsupported syntax silently mangled.
Mitigation: preflight syntax gate and source-default behavior.

Risk: source/edit mode conflicts.
Mitigation: explicit apply/save actions; avoid hidden dual-write behavior.

## 21. Deliverables
At end of one-pass implementation, agent should produce:
- Working `/with-md` route in `web` app.
- Read/Edit/Source modes with required behavior.
- Comment sidebar with anchored mark flow.
- Global visual theme matching provided direction.
- Tests passing for core utilities and mode transitions.

## 22. References
- TipTap Markdown docs: https://tiptap.dev/docs/editor/markdown
- TipTap Markdown custom serialization: https://tiptap.dev/docs/editor/markdown/advanced-usage/custom-serializing
- TipTap comments overview: https://tiptap.dev/docs/comments/getting-started/overview
- Peritext paper: https://www.inkandswitch.com/peritext/
- Loro rich text article: https://loro.dev/blog/loro-richtext

