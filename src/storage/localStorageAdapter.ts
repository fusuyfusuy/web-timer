// LocalStorage adapter — read/write/clear persisted state with versioning and error classification.
import type { PersistedState } from '../types/task';
import { PERSISTED_SCHEMA_VERSION, STORAGE_KEY, STORAGE_BACKUP_KEY, PersistedStateSchema } from '../types/task';
import type { StorageError, StorageWriteError } from '../types/errors';

/**
 * readPersistedState
 */
export function readPersistedState():
  | { ok: true; raw: string | null }
  | { ok: false; error: StorageError } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return { ok: true, raw };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'StorageReadUnavailable',
        message: 'localStorage unavailable',
        cause: err
      }
    };
  }
}

/**
 * parsePersistedState
 */
export function parsePersistedState(raw: string):
  | { ok: true; state: PersistedState }
  | { ok: false; error: StorageError } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'CorruptStorageData',
        message: 'JSON parse failed',
        cause: err
      }
    };
  }

  if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed) {
    const schemaVersion = (parsed as Record<string, unknown>).schemaVersion;
    if (schemaVersion !== PERSISTED_SCHEMA_VERSION) {
      return {
        ok: false,
        error: {
          kind: 'SchemaVersionMismatch',
          message: `Expected schemaVersion ${PERSISTED_SCHEMA_VERSION}, got ${schemaVersion}`,
          cause: undefined
        }
      };
    }
  }

  const result = PersistedStateSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: {
        kind: 'CorruptStorageData',
        message: result.error.message,
        cause: result.error
      }
    };
  }

  return { ok: true, state: result.data };
}

/**
 * writePersistedState
 */
export function writePersistedState(state: PersistedState):
  | { ok: true }
  | { ok: false; error: StorageWriteError } {
  const serialised = JSON.stringify(state);
  try {
    window.localStorage.setItem(STORAGE_KEY, serialised);
    return { ok: true };
  } catch (err) {
    const isQuotaExceeded = err instanceof Error && err.name === 'QuotaExceededError';
    const errorKind: 'StorageQuotaExceeded' | 'StorageWriteFailed' = isQuotaExceeded ? 'StorageQuotaExceeded' : 'StorageWriteFailed';
    return {
      ok: false,
      error: {
        kind: errorKind,
        message: isQuotaExceeded ? 'Storage quota exceeded' : 'Write to storage failed',
        cause: err,
        attempt: 1,
        reverted: false
      }
    };
  }
}

/**
 * clearPersistedState
 */
export function clearPersistedState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // swallow
  }
  try {
    window.localStorage.removeItem(STORAGE_BACKUP_KEY);
  } catch {
    // swallow
  }
}

/**
 * stashCorruptBlob
 */
export function stashCorruptBlob(raw: string): void {
  try {
    window.localStorage.setItem(STORAGE_BACKUP_KEY, raw);
  } catch {
    // swallow
  }
}

/**
 * isStorageAvailable
 */
export function isStorageAvailable(): boolean {
  try {
    window.localStorage.setItem('__probe__', '1');
    window.localStorage.removeItem('__probe__');
    return true;
  } catch {
    return false;
  }
}
