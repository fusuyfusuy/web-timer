# Requirements: webtimer-local-task-tracking-web-app

## Actors

- **User** — Single anonymous local user of the browser. Has full permissions over all data stored on their own device. Can initiate: creating tasks, editing tasks, deleting tasks, starting a timer on a task, stopping a timer on a task, viewing tasks and their totals.
- **Browser Storage (localStorage / IndexedDB)** — Passive system actor. Persists task and timer data across page reloads. Can initiate: returning cached data on app load; signaling quota-exceeded / unavailability errors.
- **System Clock** — Passive system actor providing wall-clock time used to compute elapsed durations for running and completed timer sessions.

## Core Flows

### Flow: Create Task
1. User opens the app; system loads persisted tasks from local storage and renders them.
2. User enters a task name into a "new task" input.
3. User submits (button click or Enter).
4. System validates the name is non-empty and within length limit.
5. System creates a task with a unique id, name, createdAt timestamp, empty session list, and total=0.
6. System persists the updated task list to local storage.
7. System renders the new task in the list.

### Flow: Start Timer
1. User clicks "Start" on a task row.
2. System checks whether any other task currently has a running timer.
3. If another task is running, system stops that task's timer first (see Stop Timer flow steps 3–6) before starting the new one.
4. System records a new open session with startedAt = now and no endedAt on the target task.
5. System persists the change to local storage.
6. System updates the UI to show the task as running, with a live-updating elapsed display.

### Flow: Stop Timer
1. User clicks "Stop" on the task whose timer is currently running.
2. System reads the open session's startedAt.
3. System sets endedAt = now on the open session.
4. System computes session duration = endedAt - startedAt and adds it to the task's cumulative total.
5. System persists the updated task and sessions to local storage.
6. System updates the UI to show the task as not running and displays the new total.

### Flow: View Totals
1. User opens or returns to the app.
2. System hydrates tasks from local storage.
3. For each task, system computes display total = sum of completed session durations + (now - startedAt) if a session is currently open.
4. System renders each task with its name and formatted total (e.g. HH:MM:SS).
5. If a task is running, the display total updates at a regular tick (e.g. every 1s) until stopped.

### Flow: Delete Task
1. User clicks "Delete" on a task row.
2. System confirms the action (lightweight confirm, e.g. native confirm dialog).
3. If the task has a running timer, system stops it first (finalizing its session) before removal — or simply discards the open session since the task is being deleted.
4. System removes the task and its sessions from the in-memory list.
5. System persists the updated list to local storage.
6. System removes the task's row from the UI.

### Flow: Rehydrate On Load
1. Browser loads the page.
2. System reads task list from local storage.
3. If storage is empty or missing, system starts with an empty task list.
4. If a task has an open session (startedAt set, endedAt null) from a previous visit, system treats the timer as still running and resumes the live display from that startedAt.
5. System renders the UI.

## Business Constraints

- All persistence is client-side only (localStorage or IndexedDB). No network/backend calls.
- Task name must be a non-empty string after trimming whitespace.
- Task name length is capped at 200 characters.
- Task id must be unique within the local dataset (UUID or equivalent).
- At most one timer may be running at any given time across all tasks (single-timer invariant).
- A session's endedAt must be >= its startedAt.
- Task total time is derived from the session list; it is not an independently mutable field.
- All timestamps are stored as epoch milliseconds (UTC).
- Data survives page reloads and browser restarts for as long as the browser retains the storage.
- No authentication, no multi-user support, no sync across devices.

## Error Conditions

### Create Task Errors
| Condition | Trigger | Recovery |
|-----------|---------|----------|
| EmptyName | User submits whitespace-only or empty name | ABORT (show inline validation, keep input focused) |
| NameTooLong | Name exceeds 200 chars | ABORT (show inline validation) |
| StorageQuotaExceeded | localStorage/IndexedDB write fails due to quota | ABORT (show non-blocking error toast; task not persisted) |
| StorageUnavailable | Storage API throws (private mode, disabled) | ABORT (show persistent banner; operate in memory-only with warning) |

### Start Timer Errors
| Condition | Trigger | Recovery |
|-----------|---------|----------|
| TaskNotFound | Target task id no longer exists | ABORT (refresh task list) |
| AlreadyRunningOnSameTask | User clicks Start on a task whose timer is already running | ABORT (no-op; button should be disabled/hidden) |
| StorageWriteFailed | Persisting the new session fails | RETRY once, then ABORT with error toast; revert in-memory change |

### Stop Timer Errors
| Condition | Trigger | Recovery |
|-----------|---------|----------|
| NoOpenSession | Stop clicked but task has no open session | ABORT (no-op; reconcile UI) |
| NegativeDuration | endedAt < startedAt (clock skew) | ABORT session accumulation (clamp duration to 0) and log; still close the session |
| StorageWriteFailed | Persisting the stop event fails | RETRY once, then ABORT with error toast; keep session open in memory so user can retry |

### View Totals Errors
| Condition | Trigger | Recovery |
|-----------|---------|----------|
| CorruptStorageData | JSON.parse fails or schema mismatch on load | ABORT read; show recovery prompt offering to reset local data; keep corrupt blob under a backup key |
| StorageReadUnavailable | Storage API unavailable on load | ABORT persistence; start with empty in-memory list and show warning |

### Delete Task Errors
| Condition | Trigger | Recovery |
|-----------|---------|----------|
| UserCancelled | Confirm dialog cancelled | ABORT silently |
| StorageWriteFailed | Persisting deletion fails | RETRY once, then ABORT with error toast; restore task in UI |

### Rehydrate On Load Errors
| Condition | Trigger | Recovery |
|-----------|---------|----------|
| SchemaVersionMismatch | Stored data was written by an incompatible older/newer schema | ABORT load; show migration/reset prompt |
| MultipleOpenSessions | Invariant violation: more than one task has an open session | ABORT: close all but the most recently started one (clamp others' endedAt to their startedAt) |

## Out of Scope

- Backend / server-side persistence, authentication, or user accounts.
- Cross-device sync or cloud backup.
- Multi-user sharing, collaboration, or task assignment.
- Editing historical sessions (manual time entry, adjusting past session start/end).
- Task categories, tags, projects, priorities, due dates, or descriptions beyond a name.
- Reports, charts, exports (CSV/JSON), or aggregate analytics beyond per-task total.
- Pomodoro intervals, countdown timers, notifications, or reminders.
- Concurrent/parallel timers across multiple tasks (single-timer invariant holds).
- Offline-first service worker install / PWA manifest (app works offline by nature of being local, but no installable PWA shell).
- Keyboard shortcuts beyond the Enter-to-submit convention.
- Internationalization / localization.
- Theming beyond a single default look.
- Undo/redo.
- Automated tests beyond what is required by the harness (not a product feature).

## Resolved Ambiguities

1. **Single vs multiple concurrent timers?** — chose: single timer (at most one task running at a time). Reason: simpler invariant, matches typical time-tracking UX, avoids ambiguous totals when the user forgets to stop.
2. **Storage backend: localStorage or IndexedDB?** — chose: localStorage. Reason: dataset is small (tasks + session list of timestamps), synchronous API is simpler, no schema migrations needed for Phase 0. IndexedDB can be revisited if session count grows.
3. **Do we store individual session records or only a running total?** — chose: store individual sessions (startedAt, endedAt). Reason: needed to correctly resume across reloads, to handle clock-skew edge cases, and to derive the total deterministically from raw data.
4. **Task edit (rename) in scope?** — chose: out of scope for Phase 0. Reason: prompt explicitly lists only create, start/stop, and view totals. Edit can be added later without reshaping the schema.
5. **Task delete in scope?** — chose: in scope. Reason: without delete the local dataset grows unbounded and is unusable; this is treated as table-stakes even though not listed explicitly.
6. **Behavior when Start is clicked on task B while task A is running?** — chose: auto-stop A, then start B. Reason: enforces the single-timer invariant without surfacing a modal; matches typical timer-app UX.
7. **Time display format?** — chose: HH:MM:SS, updating every 1 second while running. Reason: readable at a glance, matches common timer conventions, 1s tick is cheap.
8. **Timestamp representation?** — chose: epoch milliseconds (UTC, `Date.now()`). Reason: trivial arithmetic for durations, no timezone ambiguity, native JS.
9. **Confirmation before delete?** — chose: native `confirm()` dialog. Reason: lowest-complexity guard against accidental deletion; custom modal is styling work out of scope for Phase 0.
10. **Handling of open sessions left by a previous browser visit?** — chose: treat as still running and resume the live display from its original startedAt. Reason: honors user intent (they never clicked Stop) and the elapsed math stays correct; user can stop it whenever they return.
11. **Handling corrupt/incompatible stored data on load?** — chose: show a reset prompt and preserve the corrupt blob under a backup key. Reason: avoids silent data loss while not blocking app usage.
12. **Frontend stack choice (framework, bundler)?** — chose: defer to Phase 1 (Architect). Reason: Phase 0 scope is requirements, not technology selection; the prompt gave no preference.
13. **Sort order of task list?** — chose: newest created first (reverse-chronological). Reason: the most recently added task is typically the one the user wants to act on.
