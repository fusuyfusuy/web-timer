// errorService — error dismissal and recovery handlers.
import type { Task } from '../types/task';
import type { DismissInput, IdleSnapshot } from '../types/inputs';
import { readPersistedState, parsePersistedState, clearPersistedState } from '../storage/localStorageAdapter';

/**
 * dismissError
 */
export function dismissError(
  _input: DismissInput,
  currentTasks: Task[],
): IdleSnapshot {
  void _input;
  return { tasks: currentTasks };
}

/**
 * refreshTaskList
 */
export function refreshTaskList(_input: DismissInput): IdleSnapshot {
  void _input;
  const readResult = readPersistedState();
  if (!readResult.ok) {
    return { tasks: [] };
  }

  if (readResult.raw === null) {
    return { tasks: [] };
  }

  const parseResult = parsePersistedState(readResult.raw);
  if (!parseResult.ok) {
    return { tasks: [] };
  }

  return { tasks: parseResult.state.tasks };
}

/**
 * resetCorruptStorage
 */
export function resetCorruptStorage(_input: DismissInput): IdleSnapshot {
  void _input;
  clearPersistedState();
  return { tasks: [] };
}

/**
 * acknowledgeMemoryOnly
 */
export function acknowledgeMemoryOnly(
  _input: DismissInput,
  currentTasks: Task[],
): IdleSnapshot {
  void _input;
  return { tasks: currentTasks };
}

/**
 * resetOnSchemaMismatch
 */
export function resetOnSchemaMismatch(_input: DismissInput): IdleSnapshot {
  void _input;
  clearPersistedState();
  return { tasks: [] };
}
