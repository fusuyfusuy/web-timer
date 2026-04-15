// bootService — application hydration and boot reconciliation.
// Covers statechart actions: hydrateTasks, resumeOpenSession, stashCorruptAndPrompt,
// startMemoryOnly, promptMigrationReset, reconcileMultipleOpenSessions.
import type {
  BootInput,
  HydrateResult,
  CorruptRecoveryResult,
  MemoryOnlyResult,
  SchemaMismatchResult,
} from '../types/inputs';
import { parsePersistedState, stashCorruptBlob, writePersistedState } from '../storage/localStorageAdapter';
import { PERSISTED_SCHEMA_VERSION, STORAGE_BACKUP_KEY } from '../types/task';
import { hasOpenSession } from '../lib/time';

export function hydrateTasks(input: BootInput): HydrateResult {
  if (input.rawStorage === null) {
    return { tasks: [], runningTaskId: null };
  }

  const parseResult = parsePersistedState(input.rawStorage);
  if (!parseResult.ok) {
    throw parseResult.error;
  }

  const hasOpen = parseResult.state.tasks.some(t => hasOpenSession(t));
  if (hasOpen) {
    throw new Error('MultipleOpenSessions');
  }

  return { tasks: parseResult.state.tasks, runningTaskId: null };
}

export function resumeOpenSession(input: BootInput): HydrateResult {
  const parseResult = parsePersistedState(input.rawStorage!);
  if (!parseResult.ok) {
    throw parseResult.error;
  }

  const tasksWithOpen = parseResult.state.tasks.filter(t => hasOpenSession(t));
  if (tasksWithOpen.length !== 1) {
    throw new Error('MultipleOpenSessions');
  }

  return { tasks: parseResult.state.tasks, runningTaskId: tasksWithOpen[0].id };
}

export function stashCorruptAndPrompt(input: BootInput): CorruptRecoveryResult {
  if (input.rawStorage !== null) {
    stashCorruptBlob(input.rawStorage);
  }
  return {
    backupKey: STORAGE_BACKUP_KEY,
    promptMessage: 'Stored data is corrupt. Reset to start fresh? Your data has been backed up.',
  };
}

export function startMemoryOnly(_input: BootInput): MemoryOnlyResult {
  void _input;
  return { warning: 'localStorage is unavailable. Data will not be saved across reloads.' };
}

export function promptMigrationReset(input: BootInput): SchemaMismatchResult {
  let storedVersion: number | null = null;
  try {
    const parsed = JSON.parse(input.rawStorage!);
    storedVersion = typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed ? parsed.schemaVersion : null;
  } catch {
    storedVersion = null;
  }
  return {
    storedVersion,
    expectedVersion: PERSISTED_SCHEMA_VERSION,
    promptMessage: 'Stored data format is incompatible. Reset to start fresh?',
  };
}

export function reconcileMultipleOpenSessions(input: BootInput): HydrateResult {
  const parseResult = parsePersistedState(input.rawStorage!);
  if (!parseResult.ok) {
    throw parseResult.error;
  }

  const openPairs: Array<{ taskIndex: number; sessionIndex: number; startedAt: number }> = [];
  for (let ti = 0; ti < parseResult.state.tasks.length; ti++) {
    const task = parseResult.state.tasks[ti];
    for (let si = 0; si < task.sessions.length; si++) {
      const session = task.sessions[si];
      if (session.endedAt === null) {
        openPairs.push({ taskIndex: ti, sessionIndex: si, startedAt: session.startedAt });
      }
    }
  }

  openPairs.sort((a, b) => b.startedAt - a.startedAt);
  const mostRecentPair = openPairs[0];

  const finalTasks = parseResult.state.tasks.map((task, ti) => ({
    ...task,
    sessions: task.sessions.map((session, si) => {
      const pair = openPairs.find(p => p.taskIndex === ti && p.sessionIndex === si);
      if (pair && pair !== mostRecentPair) {
        return { ...session, endedAt: session.startedAt };
      }
      return session;
    }),
  }));

  try {
    writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: finalTasks });
  } catch {
  }

  return { tasks: finalTasks, runningTaskId: parseResult.state.tasks[mostRecentPair.taskIndex].id };
}
