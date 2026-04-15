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

const tasks: Task[] = [{ id: 'a', name: 'A', createdAt: 1, sessions: [] }];

describe('dismissError — DISMISS_ERROR (error_validation/error_storage_write → idle)', () => {
  it('happy path: returns IdleSnapshot from memory, no storage writes', () => {
    const r = dismissError({ now: 0 }, tasks, null);
    expect(r).toEqual({ tasks, runningTaskId: null });
    expect(mock.__store.size).toBe(0);
  });

  it('error path: preserves runningTaskId when present', () => {
    const r = dismissError({ now: 0 }, tasks, 'a');
    expect(r.runningTaskId).toBe('a');
  });
});

describe('refreshTaskList — DISMISS_ERROR (error_task_not_found → idle)', () => {
  it('happy path: reloads tasks from storage', () => {
    mock.__store.set(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        tasks: [{ id: 'z', name: 'Z', createdAt: 9, sessions: [] }],
      }),
    );
    const r = refreshTaskList({ now: 0 });
    expect(r.tasks.length).toBe(1);
    expect(r.tasks[0].id).toBe('z');
    expect(r.runningTaskId).toBeNull();
  });

  it('error path: storage read fails → empty snapshot', () => {
    mock.__readThrows = true;
    const r = refreshTaskList({ now: 0 });
    expect(r).toEqual({ tasks: [], runningTaskId: null });
  });
});

describe('resetCorruptStorage — USER_RESET_CORRUPT (error_corrupt → idle)', () => {
  it('happy path: clears storage and returns empty snapshot', () => {
    mock.__store.set(STORAGE_KEY, 'x');
    mock.__store.set(STORAGE_BACKUP_KEY, 'y');
    const r = resetCorruptStorage({ now: 0 });
    expect(r).toEqual({ tasks: [], runningTaskId: null });
    expect(mock.__store.size).toBe(0);
  });

  it('error path: remove throw is swallowed', () => {
    mock.__store.set(STORAGE_KEY, 'x');
    mock.__removeThrows = true;
    const r = resetCorruptStorage({ now: 0 });
    expect(r).toEqual({ tasks: [], runningTaskId: null });
  });
});

describe('acknowledgeMemoryOnly — DISMISS_ERROR (error_storage_unavailable → idle)', () => {
  it('happy path: returns current in-memory tasks, no storage reads', () => {
    const r = acknowledgeMemoryOnly({ now: 0 }, tasks);
    expect(r).toEqual({ tasks, runningTaskId: null });
  });

  it('error path: empty in-memory tasks still returns valid snapshot', () => {
    const r = acknowledgeMemoryOnly({ now: 0 }, []);
    expect(r).toEqual({ tasks: [], runningTaskId: null });
  });
});

describe('resetOnSchemaMismatch — USER_RESET_SCHEMA (error_schema_mismatch → idle)', () => {
  it('happy path: clears storage and returns empty', () => {
    mock.__store.set(STORAGE_KEY, 'old');
    const r = resetOnSchemaMismatch({ now: 0 });
    expect(r).toEqual({ tasks: [], runningTaskId: null });
    expect(mock.__store.has(STORAGE_KEY)).toBe(false);
  });

  it('error path: swallows remove throws', () => {
    mock.__removeThrows = true;
    const r = resetOnSchemaMismatch({ now: 0 });
    expect(r).toEqual({ tasks: [], runningTaskId: null });
  });
});
