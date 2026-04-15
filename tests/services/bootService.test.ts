import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockLocalStorage, resetMockLocalStorage, type MockStorage } from '../helpers/localStorageMock';
import {
  hydrateTasks,
  resumeOpenSession,
  stashCorruptAndPrompt,
  startMemoryOnly,
  promptMigrationReset,
  reconcileMultipleOpenSessions,
} from '../../src/services/bootService';
import { PERSISTED_SCHEMA_VERSION, STORAGE_BACKUP_KEY } from '../../src/types/task';

let mock: MockStorage;
beforeEach(() => {
  mock = installMockLocalStorage();
  resetMockLocalStorage(mock);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

const makeRaw = (tasks: unknown[]) =>
  JSON.stringify({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks });

describe('hydrateTasks — BOOT_OK (booting → idle)', () => {
  it('happy path: empty storage → empty list', () => {
    const r = hydrateTasks({ now: 0, rawStorage: null });
    expect(r).toEqual({ tasks: [], runningTaskId: null });
  });

  it('happy path: parses and returns all tasks with no open sessions', () => {
    const raw = makeRaw([{ id: 'a', name: 'A', createdAt: 1, sessions: [{ startedAt: 1, endedAt: 2 }] }]);
    const r = hydrateTasks({ now: 100, rawStorage: raw });
    expect(r.runningTaskId).toBeNull();
    expect(r.tasks.length).toBe(1);
  });

  it('error path: corrupt raw → throws (caller routes to stashCorruptAndPrompt)', () => {
    expect(() => hydrateTasks({ now: 0, rawStorage: '{bogus' })).toThrow();
  });
});

describe('resumeOpenSession — BOOT_OK_OPEN_SESSION (booting → idle_running)', () => {
  it('happy path: exactly one open session → runningTaskId returned', () => {
    const raw = makeRaw([
      { id: 'a', name: 'A', createdAt: 1, sessions: [{ startedAt: 1, endedAt: null }] },
    ]);
    const r = resumeOpenSession({ now: 100, rawStorage: raw });
    expect(r.runningTaskId).toBe('a');
  });

  it('error path: multiple open sessions → throws (caller routes to reconcileMultipleOpenSessions)', () => {
    const raw = makeRaw([
      { id: 'a', name: 'A', createdAt: 1, sessions: [{ startedAt: 1, endedAt: null }] },
      { id: 'b', name: 'B', createdAt: 2, sessions: [{ startedAt: 2, endedAt: null }] },
    ]);
    expect(() => resumeOpenSession({ now: 100, rawStorage: raw })).toThrow();
  });
});

describe('stashCorruptAndPrompt — BOOT_CORRUPT', () => {
  it('happy path: stashes raw under backup key and returns prompt', () => {
    const r = stashCorruptAndPrompt({ now: 0, rawStorage: '{corrupt' });
    expect(r.backupKey).toBe(STORAGE_BACKUP_KEY);
    expect(r.promptMessage).toMatch(/reset/i);
    expect(mock.__store.get(STORAGE_BACKUP_KEY)).toBe('{corrupt');
  });

  it('error path: null raw still returns prompt without throwing', () => {
    const r = stashCorruptAndPrompt({ now: 0, rawStorage: null });
    expect(r.backupKey).toBe(STORAGE_BACKUP_KEY);
  });
});

describe('startMemoryOnly — BOOT_STORAGE_UNAVAILABLE', () => {
  it('happy path: returns warning', () => {
    const r = startMemoryOnly({ now: 0, rawStorage: null });
    expect(r.warning).toMatch(/localStorage/i);
  });

  it('error path: does not throw even when called repeatedly', () => {
    expect(() => startMemoryOnly({ now: 0, rawStorage: null })).not.toThrow();
    expect(() => startMemoryOnly({ now: 1, rawStorage: null })).not.toThrow();
  });
});

describe('promptMigrationReset — BOOT_SCHEMA_MISMATCH', () => {
  it('happy path: extracts stored version and returns prompt', () => {
    const raw = JSON.stringify({ schemaVersion: 99, tasks: [] });
    const r = promptMigrationReset({ now: 0, rawStorage: raw });
    expect(r.storedVersion).toBe(99);
    expect(r.expectedVersion).toBe(PERSISTED_SCHEMA_VERSION);
  });

  it('error path: unparseable raw → storedVersion null', () => {
    const r = promptMigrationReset({ now: 0, rawStorage: '{bad' });
    expect(r.storedVersion).toBeNull();
  });
});

describe('reconcileMultipleOpenSessions — BOOT_MULTI_OPEN', () => {
  it('happy path: keeps most recent open, clamps others', () => {
    const raw = makeRaw([
      { id: 'a', name: 'A', createdAt: 1, sessions: [{ startedAt: 10, endedAt: null }] },
      { id: 'b', name: 'B', createdAt: 2, sessions: [{ startedAt: 50, endedAt: null }] },
    ]);
    const r = reconcileMultipleOpenSessions({ now: 100, rawStorage: raw });
    expect(r.runningTaskId).toBe('b');
    const a = r.tasks.find((t) => t.id === 'a');
    expect(a?.sessions[0].endedAt).toBe(10);
  });

  it('error path: corrupt raw throws', () => {
    expect(() => reconcileMultipleOpenSessions({ now: 0, rawStorage: '{bad' })).toThrow();
  });
});
