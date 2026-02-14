# Lessons: Auto-Switching Document Mode (Failed Approach)

## What Was Attempted

Merge Read and Edit modes into a single "Document" mode that auto-transitions:
- Default: TipTap rendered content with `editable: false`
- Click on document: `editor.setEditable(true)`, cursor appears
- 3 seconds idle: `editor.setEditable(false)`, cursor disappears
- CollabEditor always mounted (no remounting), CRDT stays connected

### Files changed
- `types.ts` — added `UserFacingMode`
- `use-idle-timeout.ts` — new hook for 3s idle timer
- `use-doc-mode.ts` — rewritten with `activateEdit()`/`deactivateEdit()`
- `collab-editor.tsx` — added `editable` prop, `setEditable()` toggle, click-to-edit handler, browser-level mouseup for comments in non-editable mode
- `document-surface.tsx` — always render CollabEditor for supported files (read + edit), ReadRenderer only for unsupported
- `document-toolbar.tsx` — merged Read+Edit into single Document button
- `with-md-shell.tsx` — wired idle timeout, new props

## Why It Didn't Work

### Bug 1: Idle timeout race condition
`useIdleTimeout` initialized with `isIdle = true`. When the user clicked to edit, `activateEdit()` set `mode='edit'`, which enabled the idle timer (`mode === 'edit' && autoMode`). But `isIdle` was already `true`, so the deactivation effect in WithMdShell fired immediately, snapping back to read mode. Fix attempted: reset to `isIdle = false` when `enabled` transitions to `true`.

### Bug 2: Rules of Hooks violation
`useCallback` for `handleWrapperClick` was placed after two early returns (`if (!editor)` and the realtime fallback). This broke React's hook ordering — when `editor` was `null` on first render, the hook was skipped, then called on subsequent renders, corrupting React's internal hook state. Fix attempted: moved `useCallback` above early returns.

### Fundamental Issues (not fixable with patches)

1. **TipTap `setEditable()` is not designed for rapid toggling as a UX pattern.** It's meant for permission-level control (e.g., "this user can/cannot edit"), not as a view/edit mode toggle. Internal ProseMirror input handlers, decorations, and plugins may not cleanly re-initialize on each toggle. The editor was initialized with `editable: false` and toggling to `true` at runtime may not set up cursor/input handling correctly.

2. **Click-to-edit layered on ProseMirror is fragile.** ProseMirror captures mouse events even in non-editable mode. The wrapper `onClick` handler competes with ProseMirror's internal event handling. `window.getSelection()?.isCollapsed` check to distinguish clicks from text selections is unreliable — ProseMirror may manipulate the selection before our handler runs.

3. **Dual selection paths create complexity.** In editable mode, TipTap's `onSelectionUpdate` handles selection. In non-editable mode, a browser `mouseup` listener handles it. Switching between these two systems based on the `editable` flag is error-prone, especially during transitions.

4. **The `onUpdate` ref guard is a code smell.** Using `editableRef.current` inside TipTap's `onUpdate` callback to conditionally fire `onContentChange` means the callback behavior changes without TipTap knowing. TipTap may have internal assumptions about callback consistency.

5. **The original component-swap approach (Read/Edit) was simpler and more reliable.** Each mode had a purpose-built component. The "avoid CRDT reconnection" motivation may have been premature optimization — reconnection overhead might be negligible in practice.

## Key Takeaway

Don't try to repurpose `editor.setEditable()` as a UX-level view/edit toggle. TipTap's editable flag is a capability control, not a mode switch. If Read and Edit need different interaction models (click-to-edit, idle timeout, dual selection paths), they're better served by separate components or a different architectural approach entirely.
