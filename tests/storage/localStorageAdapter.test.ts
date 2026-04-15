import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockLocalStorage, resetMockLocalStorage, type MockStorage } from '../helpers/localStorageMock';
import {
  readPersistedState,
  parsePersistedState,
  writePersistedState,
  clearPersistedState,
  stashCorruptBlob,
  isStorageAvailable,
} from '../../src/storage/localStorageAdapter';
import { PERSISTED_SCHEMA_VERSION, STORAGE_KEY, STORAGE_BACKUP_KEY } from '../../src/types/task';

let mock: MockStorage;
beforeEach(() => {
  mock = installMockLocalStorage();
  resetMockLocalStorage(mock);
});

describe('readPersistedState', () => {
  it('happy path: returns raw string when present', () => {
    mock.__store.set(STORAGE_KEY, '{"schemaVersion":1,"tasks":[]}');
    const r = readPersistedState();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.raw).toBe('{"schemaVersion":1,"tasks":[]}');
  });

  it('happy path: returns null raw when absent', () => {
    const r = readPersistedState();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.raw).toBeNull();
  });

  it('error path: returns StorageReadUnavailable when localStorage throws', () => {
    mock.__readThrows = true;
    const r = readPersistedState();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('StorageReadUnavailable');
  });
});

describe('parsePersistedState', () => {
  it('happy path: parses valid blob', () => {
    const raw = JSON.stringify({
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      tasks: [{ id: 'a', name: 'Alpha', createdAt: 1, sessions: [] }],
    });
    const r = parsePersistedState(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.tasks[0].id).toBe('a');
  });

  it('error path: CorruptStorageData on JSON syntax error', () => {
    const r = parsePersistedState('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('CorruptStorageData');
  });

  it('error path: SchemaVersionMismatch on wrong version', () => {
    const r = parsePersistedState(JSON.stringify({ schemaVersion: 999, tasks: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('SchemaVersionMismatch');
  });

  it('error path: CorruptStorageData on schema-invalid body', () => {
    const r = parsePersistedState(JSON.stringify({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: 'nope' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('CorruptStorageData');
  });
});

describe('writePersistedState', () => {
  it('happy path: writes serialised blob', () => {
    const r = writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: [] });
    expect(r.ok).toBe(true);
    expect(mock.__store.get(STORAGE_KEY)).toContain('"schemaVersion":1');
  });

  it('error path: StorageQuotaExceeded surfaced', () => {
    mock.__writeThrows = 'quota';
    const r = writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('StorageQuotaExceeded');
  });

  it('error path: StorageWriteFailed on generic throw', () => {
    mock.__writeThrows = true;
    const r = writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('StorageWriteFailed');
  });
});

describe('clearPersistedState', () => {
  it('happy path: removes both keys', () => {
    mock.__store.set(STORAGE_KEY, 'x');
    mock.__store.set(STORAGE_BACKUP_KEY, 'y');
    expect(() => clearPersistedState()).not.toThrow();
    expect(mock.__store.has(STORAGE_KEY)).toBe(false);
    expect(mock.__store.has(STORAGE_BACKUP_KEY)).toBe(false);
  });

  it('error path: swallows removeItem errors', () => {
    mock.__removeThrows = true;
    expect(() => clearPersistedState()).not.toThrow();
  });
});

describe('stashCorruptBlob', () => {
  it('happy path: writes raw blob to backup key', () => {
    stashCorruptBlob('raw-corrupt');
    expect(mock.__store.get(STORAGE_BACKUP_KEY)).toBe('raw-corrupt');
  });

  it('error path: swallows write errors silently', () => {
    mock.__writeThrows = true;
    expect(() => stashCorruptBlob('raw')).not.toThrow();
  });
});

describe('isStorageAvailable', () => {
  it('happy path: true when round-trip succeeds', () => {
    expect(isStorageAvailable()).toBe(true);
  });

  it('error path: false when setItem throws', () => {
    mock.__writeThrows = true;
    expect(isStorageAvailable()).toBe(false);
  });
});
