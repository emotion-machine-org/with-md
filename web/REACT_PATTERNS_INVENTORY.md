# React Pattern Inventory (`web/`)

## Scope
This inventory covers React and React-adjacent UI code in `web/src`:
- Next.js pages/layout client boundaries
- UI components in `src/components/with-md`
- Custom hooks in `src/hooks/with-md`

It does not review Convex backend code or Hocuspocus server code.

## Quick footprint
Hook usage detected in `src`:
- `useState`: 14
- `useEffect`: 25
- `useMemo`: 12
- `useCallback`: 15
- `useRef`: 5
- `useReducer`: 0
- `createContext` / `useContext`: 0 / 0

Heavy hook concentration:
- `src/components/with-md/with-md-shell.tsx`
- `src/components/with-md/collab-editor.tsx`
- `src/hooks/with-md/use-collab-doc.ts`

## Pattern inventory

### 1) Top-level architecture pattern
- Pattern: single orchestrator + mostly dumb leaf components.
- Evidence: `src/components/with-md/with-md-shell.tsx:25` (main orchestrator), child composition at `src/components/with-md/with-md-shell.tsx:387`.
- Evidence: `src/components/with-md/document-surface.tsx:31` routes to rich editor vs source editor.

### 2) Mode model pattern
- Pattern: two modes only (`document` and `source`), no separate read mode.
- Evidence: `src/components/with-md/document-surface.tsx:54` and toolbar toggle `src/components/with-md/document-toolbar.tsx:86`.
- Pattern: syntax gate prevents rich edit for unsupported syntax.
- Evidence: `src/hooks/with-md/use-doc-mode.ts:7`, `src/components/with-md/document-toolbar.tsx:137`.

### 3) State management pattern
- Pattern: local component state only; no global store/context.
- Evidence: many local `useState` declarations in `src/components/with-md/with-md-shell.tsx:27`.
- Pattern: duplicated content representations (`currentFile.content`, `sourceValue`, `savedContent`).
- Evidence: `src/components/with-md/with-md-shell.tsx:33`, `src/components/with-md/with-md-shell.tsx:34`, sync logic at `src/components/with-md/with-md-shell.tsx:94`.

### 4) Async data and side-effect pattern
- Pattern: effect-driven bootstrapping and fetches.
- Evidence: app bootstrap `src/components/with-md/with-md-shell.tsx:43`, repo picker load `src/components/with-md/repo-picker.tsx:17`, auth check `src/hooks/with-md/use-auth.ts:22`.
- Pattern: timer-based autosave behavior.
- Evidence: `src/components/with-md/with-md-shell.tsx:172` and `src/components/with-md/with-md-shell.tsx:198`.

### 5) Memoization and callbacks pattern
- Pattern: selective `useMemo` for derived sets/maps and heavy editor rail layout.
- Evidence: `src/components/with-md/collab-editor.tsx:791`, `src/components/with-md/collab-editor.tsx:812`.
- Pattern: broad use of `useCallback` mostly for prop stability and async actions.
- Evidence: action handlers in `src/components/with-md/with-md-shell.tsx:222` onward.

### 6) Controlled input pattern
- Pattern: controlled textareas for source editing and comments.
- Evidence: `src/components/with-md/source-editor.tsx:10`, `src/components/with-md/comments-sidebar.tsx:75`.
- Pattern: per-thread reply draft state keyed by thread id.
- Evidence: `src/components/with-md/collab-editor.tsx:396`.

### 7) Imperative integration pattern (Tiptap/Yjs)
- Pattern: imperative editor bridge with React wrapper and many sync effects.
- Evidence: editor init `src/components/with-md/collab-editor.tsx:400`, effects `src/components/with-md/collab-editor.tsx:491` onward.
- Pattern: CRDT provider lifecycle wrapped in custom hook.
- Evidence: `src/hooks/with-md/use-collab-doc.ts:45`.
- Pattern: ProseMirror/Tiptap typing escapes via `unknown` casts.
- Evidence: `src/components/with-md/collab-editor.tsx:424`, `src/components/with-md/collab-editor.tsx:536`, `src/components/with-md/collab-editor.tsx:595`.

### 8) Browser API / imperative DOM pattern
- Pattern: explicit DOM/event APIs where editor behavior needs it.
- Evidence: `document.createTreeWalker` in `src/components/with-md/collab-editor.tsx:126`, window listeners `src/components/with-md/collab-editor.tsx:761`.
- Pattern: theme/background mutation from toolbar.
- Evidence: `src/components/with-md/document-toolbar.tsx:38` and `src/components/with-md/document-toolbar.tsx:50`.
- Pattern: inline script to avoid theme flicker before hydration.
- Evidence: `src/app/layout.tsx:15`.

### 9) Comment UX pattern
- Pattern: comment creation from selection + anchored rehydration.
- Evidence: mark request flow `src/components/with-md/with-md-shell.tsx:247`, mark application `src/components/with-md/collab-editor.tsx:586`, recovery `src/components/with-md/collab-editor.tsx:639`.

### 10) Dead/unused module pattern (current snapshot)
- `src/components/with-md/activity-panel.tsx` appears unreferenced.
- `src/components/with-md/presence-strip.tsx` appears unreferenced.
- `src/hooks/with-md/use-idle-timeout.ts` appears unreferenced.
- `src/hooks/with-md/use-syntax-support.ts` appears unreferenced.

## Anti-pattern / smell assessment

### High severity
1. Monolithic orchestrator with mixed concerns.
- Why it smells: `WithMdShell` owns routing/bootstrap, save policy, comments, sidebars, mode management, and GitHub actions in one component.
- Risk: difficult reasoning, regression-prone edits, high coupling.
- Evidence: `src/components/with-md/with-md-shell.tsx:25` through `src/components/with-md/with-md-shell.tsx:520`.

2. Effect async race/cancellation gaps.
- Why it smells: async effects call `setState` after awaited work without cancellation guards.
- Risk: stale writes when navigating quickly between repos/files; hard-to-reproduce state flicker.
- Evidence: `src/components/with-md/with-md-shell.tsx:43`, `src/components/with-md/repo-picker.tsx:17`, `src/hooks/with-md/use-auth.ts:22`, `src/app/with-md/page.tsx:18`.

### Medium severity
1. State duplication and drift risk.
- Why it smells: same logical document content is tracked in multiple local states.
- Risk: subtle mismatch bugs between editor/source/autosave state.
- Evidence: `src/components/with-md/with-md-shell.tsx:33`, `src/components/with-md/with-md-shell.tsx:34`, update/reset logic at `src/components/with-md/with-md-shell.tsx:94` and `src/components/with-md/with-md-shell.tsx:448`.

2. Accessibility anti-pattern: nested interactive control.
- Why it smells: clickable `span` with `role="button"` inside a real `button` card.
- Risk: invalid interactive nesting, keyboard/AT inconsistency.
- Evidence: parent button `src/components/with-md/comments-sidebar.tsx:120`, nested delete control `src/components/with-md/comments-sidebar.tsx:131`.

3. Heavy polling + expensive layout calculations in editor component.
- Why it smells: interval retry loops + repeated DOM position scans in a large component.
- Risk: performance degradation for long docs/large comment sets.
- Evidence: hydration polling `src/components/with-md/collab-editor.tsx:510`, cursor retry `src/components/with-md/collab-editor.tsx:730`, thread layout compute `src/components/with-md/collab-editor.tsx:812`.

4. Type-safety escapes in critical editing code.
- Why it smells: broad `as unknown as ...` casting around editor state/commands.
- Risk: runtime breakage hidden from TypeScript.
- Evidence: `src/components/with-md/collab-editor.tsx:424`, `src/components/with-md/collab-editor.tsx:536`, `src/components/with-md/collab-editor.tsx:595`.

5. Unsanitized HTML write path in custom table node view.
- Why it smells: markdown -> HTML rendered then assigned via `innerHTML`.
- Risk: XSS vector if malicious content reaches this path.
- Evidence: `src/components/with-md/tiptap/table-block.ts:47` and `src/components/with-md/tiptap/table-block.ts:48`.

### Low severity
1. Unused code present.
- Risk: maintenance noise and false confidence in “existing” features.
- Evidence files: `src/components/with-md/activity-panel.tsx:1`, `src/components/with-md/presence-strip.tsx:1`, `src/hooks/with-md/use-idle-timeout.ts:1`, `src/hooks/with-md/use-syntax-support.ts:1`.

2. LocalStorage/document access embedded in UI component helpers.
- Risk: testability and SSR assumptions become implicit.
- Evidence: `src/components/with-md/document-toolbar.tsx:38`.

## Overall judgement
The codebase is not chaotic, but it currently relies on a few high-risk patterns:
- one very large stateful orchestrator
- one very large imperative editor component
- uncancelled async effects

The architecture is workable, but these hotspots are where most future bugs and regressions will come from unless refactored.
