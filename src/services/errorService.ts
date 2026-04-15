// errorService — error dismissal and recovery handlers.
// Covers statechart actions: dismissError, refreshTaskList, resetCorruptStorage,
// acknowledgeMemoryOnly, resetOnSchemaMismatch.
import type { Task } from '../types/task';
import type { DismissInput, IdleSnapshot } from '../types/inputs';
import { readPersistedState, parsePersistedState, clearPersistedState } from '../storage/localStorageAdapter';

/**
 * dismissError
 */
export function dismissError(
  _input: DismissInput,
  currentTasks: Task[],
  runningTaskId: string | null,
): IdleSnapshot {
  void _input;
  return { tasks: currentTasks, runningTaskId };
}

/**
 * refreshTaskList
 */
export function refreshTaskList(_input: DismissInput): IdleSnapshot {
  void _input;
  const readResult = readPersistedState();
  if (!readResult.ok) {
    return { tasks: [], runningTaskId: null };
  }

  if (readResult.raw === null) {
    return { tasks: [], runningTaskId: null };
  }

  const parseResult = parsePersistedState(readResult.raw);
  if (!parseResult.ok) {
    return { tasks: [], runningTaskId: null };
  }

  const parsedState = parseResult.state;
  let runningTaskId: string | null = null;

  for (const task of parsedState.tasks) {
    const hasOpenSession = task.sessions.some((session) => session.endedAt === null);
    if (hasOpenSession) {
      runningTaskId = task.id;
      break;
    }
  }

  return { tasks: parsedState.tasks, runningTaskId };
}

/**
 * resetCorruptStorage
 */
export function resetCorruptStorage(_input: DismissInput): IdleSnapshot {
  void _input;
  clearPersistedState();
  return { tasks: [], runningTaskId: null };
}

/**
 * acknowledgeMemoryOnly
 */
export function acknowledgeMemoryOnly(
  _input: DismissInput,
  currentTasks: Task[],
): IdleSnapshot {
  void _input;
  return { tasks: currentTasks, runningTaskId: null };
}

/**
 * resetOnSchemaMismatch
 */
export function resetOnSchemaMismatch(_input: DismissInput): IdleSnapshot {
  void _input;
  clearPersistedState();
  return { tasks: [], runningTaskId: null };
}
