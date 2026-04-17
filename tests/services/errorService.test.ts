import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockLocalStorage, resetMockLocalStorage, type MockStorage } from '../helpers/localStorageMock';
import {
  dismissError,
  refreshTaskList,
  resetCorruptStorage,
  acknowledgeMemoryOnly,
  resetOnSchemaMismatch,
} from '../../src/services/errorService';
import {
  PERSISTED_SCHEMA_VERSION,
  STORAGE_KEY,
  STORAGE_BACKUP_KEY,
} from '../../src/types/task';
import type { Task } from '../../src/types/task';

let mock: MockStorage;
beforeEach(() => {
  mock = installMockLocalStorage();
  resetMockLocalStorage(mock);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

const tasks: Task[] = [{ id: 'a', name: 'A', createdAt: 1, sessions: [], timerMode: 'countup', countdownDurationMs: null, scheduledStartAt: null, scheduledEndAt: null }];

describe('dismissError', () => {
  it('happy path: returns IdleSnapshot from memory', () => {
    const r = dismissError({ now: 0 }, tasks);
    expect(r).toEqual({ tasks });
  });
});

describe('refreshTaskList', () => {
  it('happy path: reloads tasks from storage', () => {
    mock.__store.set(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        tasks: [{ id: 'z', name: 'Z', createdAt: 9, sessions: [], timerMode: 'countup', countdownDurationMs: null, scheduledStartAt: null, scheduledEndAt: null }],
      }),
    );
    const r = refreshTaskList({ now: 0 });
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].id).toBe('z');
  });

  it('error path: storage read fails → empty snapshot', () => {
    mock.__readThrows = true;
    const r = refreshTaskList({ now: 0 });
    expect(r).toEqual({ tasks: [] });
  });
});

describe('resetCorruptStorage', () => {
  it('happy path: clears storage and returns empty snapshot', () => {
    mock.__store.set(STORAGE_KEY, 'x');
    mock.__store.set(STORAGE_BACKUP_KEY, 'y');
    const r = resetCorruptStorage({ now: 0 });
    expect(r).toEqual({ tasks: [] });
    expect(mock.__store.size).toBe(0);
  });
});

describe('acknowledgeMemoryOnly', () => {
  it('happy path: returns current in-memory tasks', () => {
    const r = acknowledgeMemoryOnly({ now: 0 }, tasks);
    expect(r).toEqual({ tasks });
  });
});

describe('resetOnSchemaMismatch', () => {
  it('happy path: clears storage and returns empty', () => {
    mock.__store.set(STORAGE_KEY, 'old');
    const r = resetOnSchemaMismatch({ now: 0 });
    expect(r).toEqual({ tasks: [] });
    expect(mock.__store.has(STORAGE_KEY)).toBe(false);
  });
});
