# Development

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- A modern browser with `localStorage` and `crypto.randomUUID`

## Scripts

| Command | What it does |
|---------|--------------|
| `bun install` | Install dependencies from `bun.lock` |
| `bun run dev` | Vite dev server with HMR |
| `bun run build` | `tsc --noEmit` + `vite build` → `dist/` |
| `bun run preview` | Serve the built bundle |
| `bun run typecheck` | `tsc --noEmit` only |
| `bun run test` | Run vitest once (85 tests) |
| `bun run lint` | ESLint `src/` |

## Test strategy

Every state-machine action has both a happy-path and an error-path test. Tests live in `tests/` mirroring the `src/` layout. UI-layer code (`src/ui/app.ts`) is exercised indirectly via service tests — there is no jsdom-rendered component harness.

## Adding a feature

This project was scaffolded with [MCD-Flow](https://github.com/). To extend it cleanly:

1. Update `.mcd/requirements.md` with the new flow.
2. Add the new states / transitions / actions to `.mcd/manifest.json` and `.mcd/statechart.mmd`.
3. Add the action function stub to the appropriate service file with a `CONTRACT:` comment block.
4. Write the oracle test in `tests/`.
5. Implement.
6. `bun run typecheck && bun run test`.

For mechanical runs of the full pipeline, use `/mcd "<feature prompt>"` inside Claude Code.

## Invariants (do not break without also updating the manifest)

- At most one task has an open session at any time.
- Task total is derived, not stored.
- All timestamps are epoch ms (UTC) via `Date.now()`.
- Persistence happens only through `localStorageAdapter` — no direct `localStorage` calls from services.
