# Contributing

Thanks for contributing to `with.md`.

## Development setup

From repo root:

```bash
npm install
npx convex dev
npm run dev:hocuspocus
npm run dev:web
```

## Validation before opening a PR

Run:

```bash
npm run test:web
npm --workspace web run build
npx tsc --noEmit -p hocuspocus-server/tsconfig.json
```

## Pull request guidelines

- Keep changes scoped and focused.
- Include tests for behavioral changes.
- Preserve core invariants documented in `AGENTS.md`:
  - GitHub remains source of truth.
  - Realtime load/store stays idempotent.
  - Avoid stale state leaks during rapid repo/file switches.
- Document any migration, env var, or operational changes in `README.md`.

## Commit style

- Use clear commit messages describing user-visible behavior.
- Prefer incremental commits over large mixed changes.

## Reporting bugs / requesting features

- Open a GitHub issue with steps to reproduce.
- Include logs, screenshots, and affected paths where possible.
