import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockLocalStorage, resetMockLocalStorage, type MockStorage } from '../helpers/localStorageMock';
import {
  createTask,
  rejectInvalidName,
  reportStorageWriteFailure,
  deleteTask,
  abortDeleteSilently,
  retryOrRestoreDelete,
  discardOpenAndDelete,
} from '../../src/services/taskService';
import type { Task } from '../../src/types/task';

let mock: MockStorage;
beforeEach(() => {
  mock = installMockLocalStorage();
  resetMockLocalStorage(mock);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

const existing: Task = {
  id: 'old-1',
  name: 'Old',
  createdAt: 1,
  sessions: [],
};

describe('createTask — CREATE_TASK_OK (idle → idle)', () => {
  it('happy path: creates task with trimmed name and persists', () => {
    const task = createTask({ name: '  Hello  ' }, [existing]);
    expect(task.name).toBe('Hello');
    expect(task.sessions).toEqual([]);
    expect(task.id).toBeTruthy();
    const persisted = JSON.parse(mock.__store.get('webtimer:state:v1')!);
    expect(persisted.tasks.length).toBe(2);
    expect(persisted.tasks[0].id).toBe(task.id);
  });

  it('error path: storage write failure bubbles as StorageWriteError', () => {
    mock.__writeThrows = true;
    expect(() => createTask({ name: 'X' }, [])).toThrow();
  });
});

describe('rejectInvalidName — CREATE_TASK_INVALID', () => {
  it('happy path (empty): returns EmptyName error', () => {
    const err = rejectInvalidName({ name: '   ' });
    expect(err.kind).toBe('EmptyName');
    expect(err.field).toBe('name');
  });

  it('error path (too long): returns NameTooLong error', () => {
    const err = rejectInvalidName({ name: 'a'.repeat(500) });
    expect(err.kind).toBe('NameTooLong');
  });
});

describe('reportStorageWriteFailure — CREATE_TASK_STORAGE_FAIL', () => {
  it('happy path: builds StorageWriteError with attempt=1, reverted=true', () => {
    const err = reportStorageWriteFailure({ name: 'X' }, new Error('quota'));
    expect(err.kind).toBe('StorageWriteFailed');
    expect(err.attempt).toBe(1);
    expect(err.reverted).toBe(true);
  });

  it('error path: preserves cause reference', () => {
    const cause = new Error('orig');
    const err = reportStorageWriteFailure({ name: 'X' }, cause);
    expect(err.cause).toBe(cause);
  });
});

describe('deleteTask — DELETE_TASK_OK', () => {
  it('happy path: removes task and persists', () => {
    const r = deleteTask({ taskId: 'old-1', confirmed: true }, [existing]);
    expect(r).toEqual({ deletedId: 'old-1', removed: true });
    const persisted = JSON.parse(mock.__store.get('webtimer:state:v1')!);
    expect(persisted.tasks.length).toBe(0);
  });

  it('error path: storage failure throws', () => {
    mock.__writeThrows = true;
    expect(() => deleteTask({ taskId: 'old-1', confirmed: true }, [existing])).toThrow();
  });
});

describe('abortDeleteSilently — DELETE_TASK_CANCELLED', () => {
  it('happy path: no storage write, removed: false', () => {
    const r = abortDeleteSilently({ taskId: 'old-1', confirmed: false });
    expect(r).toEqual({ deletedId: 'old-1', removed: false });
    expect(mock.__store.size).toBe(0);
  });

  it('error path: still does nothing on storage unavailable', () => {
    mock.__writeThrows = true;
    const r = abortDeleteSilently({ taskId: 'old-1', confirmed: false });
    expect(r.removed).toBe(false);
  });
});

describe('retryOrRestoreDelete — DELETE_TASK_STORAGE_FAIL', () => {
  it('happy path: restore succeeds → reverted=true attempt=2', () => {
    const err = retryOrRestoreDelete({ taskId: 'old-1', confirmed: true }, [existing], new Error('boom'));
    expect(err.kind).toBe('StorageWriteFailed');
    expect(err.attempt).toBe(2);
    expect(err.reverted).toBe(true);
  });

  it('error path: second write also fails → reverted=false', () => {
    mock.__writeThrows = true;
    const err = retryOrRestoreDelete({ taskId: 'old-1', confirmed: true }, [existing], new Error('boom'));
    expect(err.reverted).toBe(false);
    expect(err.attempt).toBe(2);
  });
});

describe('discardOpenAndDelete — DELETE_RUNNING_TASK', () => {
  const runningTask: Task = {
    id: 'run-1',
    name: 'Running',
    createdAt: 1,
    sessions: [{ startedAt: 10, endedAt: null }],
  };

  it('happy path: removes running task and open session', () => {
    const r = discardOpenAndDelete({ taskId: 'run-1', confirmed: true }, [runningTask, existing]);
    expect(r).toEqual({ deletedId: 'run-1', removed: true });
    const persisted = JSON.parse(mock.__store.get('webtimer:state:v1')!);
    expect(persisted.tasks.map((t: Task) => t.id)).toEqual(['old-1']);
  });

  it('error path: throws when storage write fails', () => {
    mock.__writeThrows = true;
    expect(() => discardOpenAndDelete({ taskId: 'run-1', confirmed: true }, [runningTask])).toThrow();
  });
});
