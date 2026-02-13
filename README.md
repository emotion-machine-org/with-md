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

### 1) Install workspace deps

```bash
cd with-md
npm install
```

### 2) Start Convex

```bash
cd with-md
npx convex dev
```

### 3) Configure env

Set the same shared secret in Convex and Hocuspocus:

```bash
cd with-md
npx convex env set HOCUSPOCUS_CONVEX_SECRET "<your-secret>"
```

`web/.env.local`:

```env
NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
NEXT_PUBLIC_HOCUSPOCUS_URL=ws://localhost:3001
NEXT_PUBLIC_WITHMD_ENABLE_REALTIME=1
NEXT_PUBLIC_WITHMD_ENABLE_REALTIME_EXPERIMENTAL=0
```

`hocuspocus-server/.env`:

```env
CONVEX_URL=https://<your-deployment>.convex.cloud
HOCUSPOCUS_CONVEX_SECRET=<same-secret-as-above>
PORT=3001
```

### 4) Start Hocuspocus

```bash
cd with-md/hocuspocus-server
npm run dev
```

### 5) Start web UI

```bash
cd with-md/web
npm run dev
```

## Notes

- This workspace is intentionally independent from `/web` and `/server`.
- The web app is now bound to Convex (no in-memory mock adapter).
- On first load, if Convex has no repos, seed data is created automatically.
- Realtime collab transport is behind an experimental flag (`NEXT_PUBLIC_WITHMD_ENABLE_REALTIME_EXPERIMENTAL=1`).
- `Push` / `Re-sync` are currently queue/status operations. Wire your Git worker to consume `pushQueue` for full GitHub commits.
