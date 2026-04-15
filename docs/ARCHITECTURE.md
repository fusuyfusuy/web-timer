# Architecture

## State machine

The app is modeled as a statechart (`.mcd/statechart.mmd`). Top-level states:

| State | Meaning |
|-------|---------|
| `booting` | Hydrating from `localStorage` |
| `idle` | Task list visible, no timer running |
| `idle_running` | Exactly one task has an open session |
| `error_validation` | Invalid task name submitted |
| `error_storage_write` | Persistence failed (quota / unavailable) |
| `error_task_not_found` | Target task id missing from list |
| `error_corrupt` | Stored JSON unparseable or schema-invalid |
| `error_storage_unavailable` | `localStorage` throws on probe |
| `error_schema_mismatch` | Stored data was written by another schema version |

32 transitions. Every transition has an action function in `src/services/` or `src/storage/`. The **single-timer invariant** is enforced by only allowing one open session across all tasks; `idle_running` → `idle_running` via `switchRunningTask` closes the current session before opening a new one.

## Data model

```ts
Task = {
  id: string           // crypto.randomUUID()
  name: string         // trimmed, 1–200 chars
  createdAt: number    // epoch ms
  sessions: Session[]
}

Session = {
  startedAt: number
  endedAt:   number | null   // null = open
}

PersistedState = {
  schemaVersion: 1
  tasks: Task[]
}
```

Task total is **derived** from `sessions` — never stored independently. `computeTaskTotalMs` sums closed durations and adds `now - startedAt` for any open session.

## Storage

Single localStorage key: `webtimer:v1:state`. On corrupt parse the raw blob is moved to `webtimer:v1:state.backup` before the user is offered a reset. On quota / unavailable errors the app falls back to memory-only mode with a persistent warning.

## Error handling

| Class | Recovery |
|-------|----------|
| Validation (empty name, too long) | ABORT, inline message |
| Storage write | RETRY once, then ABORT; revert in-memory change |
| Corrupt storage | ABORT load, stash blob, prompt reset |
| Schema mismatch | ABORT load, prompt migration/reset |
| Clock skew (endedAt < startedAt) | Clamp duration to 0, close session |
| Multiple open sessions on load | Keep most recent; clamp others' `endedAt = startedAt` |

## Tick loop

While a task is running, `setInterval(1000)` calls `recomputeTotalsWithOpen` → re-renders the live HH:MM:SS. On stop the interval is cleared.
