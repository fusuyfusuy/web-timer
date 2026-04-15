# WebTimer

Local-only task time tracker. Create tasks, start/stop a timer on any task, see total time spent per task. All data lives in `localStorage` — no backend, no account, no sync.

## Quick start

```bash
bun install
bun run dev       # vite dev server
bun run test      # vitest (85 tests)
bun run typecheck # tsc --noEmit
bun run build     # typecheck + vite build → dist/
```

Open the URL Vite prints.

## Features

- Create, start/stop timer, delete tasks
- **Single-timer invariant** — starting a timer on task B auto-stops task A
- HH:MM:SS display, 1-second tick
- Survives reloads; an open session from a previous visit resumes live
- Graceful recovery for corrupt data, schema drift, quota exhaustion, private-mode storage

## Stack

- TypeScript + Vite
- `zod` for runtime validation
- `vitest` + `jsdom` for tests
- Bun as package manager and script runner

## Project layout

```
src/
  lib/         id + time helpers (HH:MM:SS, duration math)
  storage/     localStorage adapter (versioned key, error classification)
  services/    state-machine action functions (one per transition)
  ui/          DOM rendering + event handlers
  types/       zod schemas & inferred TS types
  main.ts      entry point
tests/         oracle tests per service file
.mcd/          design artifacts (see docs/ARCHITECTURE.md)
docs/
```

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — state machine, data model, error handling
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — scripts, testing, adding features
- [`.mcd/requirements.md`](.mcd/requirements.md) — original product requirements
- [`.mcd/statechart.mmd`](.mcd/statechart.mmd) — Mermaid state diagram

## Origin

Scaffolded via [MCD-Flow](https://github.com/) — a requirements → manifest → statechart → skeleton → fill → verify pipeline. Every function in `src/services/` maps to exactly one state-machine transition defined in `.mcd/manifest.json`.
