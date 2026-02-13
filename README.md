# with.md

Self-contained implementation workspace for with.md (filesystem-first markdown collaboration).

## Structure

- `web/`: Next.js UI (Read/Edit/Source modes, comments, activity panel, syntax gate)
- `convex/`: Convex schema + function contracts (tombstones, source save path, comment anchor metadata)
- `hocuspocus-server/`: Yjs/Hocuspocus bridge with Convex hooks
- `backgrounds/`: visual assets

## MVP Behavior

- Fast markdown `Read` mode
- `Edit` mode (TipTap/Yjs; guarded by syntax support)
- Always-editable `Source` mode with explicit save/apply actions
- Anchored comments with approximate recovery (`textQuote/context/heading/line`)
- Manual `Push` and `Re-sync`

## Run (after installing deps)

### Web

```bash
cd web
npm install
npm run dev
```

### Hocuspocus

```bash
cd hocuspocus-server
npm install
npm run dev
```

## Notes

- This workspace is intentionally independent from `/web` and `/server`.
- Convex integration is represented with function contracts and adapter boundaries.
