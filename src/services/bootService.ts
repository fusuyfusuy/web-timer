// bootService — application hydration and boot reconciliation.
import type {
  BootInput,
  HydrateResult,
  CorruptRecoveryResult,
  MemoryOnlyResult,
  SchemaMismatchResult,
} from '../types/inputs';
import { parsePersistedState, stashCorruptBlob } from '../storage/localStorageAdapter';
import { PERSISTED_SCHEMA_VERSION, STORAGE_BACKUP_KEY } from '../types/task';

export function hydrateTasks(input: BootInput): HydrateResult {
  if (input.rawStorage === null) {
    return { tasks: [], hasActive: false };
  }

  const parseResult = parsePersistedState(input.rawStorage);
  if (!parseResult.ok) {
    throw parseResult.error;
  }

  const hasActive = parseResult.state.tasks.some(t => t.sessions.some(s => s.endedAt === null));

  return { tasks: parseResult.state.tasks, hasActive };
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
