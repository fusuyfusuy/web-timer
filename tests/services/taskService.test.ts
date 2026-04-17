import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockLocalStorage, resetMockLocalStorage, type MockStorage } from '../helpers/localStorageMock';
import {
  createTask,
  rejectInvalidName,
  reportStorageWriteFailure,
  deleteTask,
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
  timerMode: 'countup',
  countdownDurationMs: null,
  scheduledStartAt: null,
  scheduledEndAt: null
};

describe('createTask', () => {
  it('happy path: creates task with trimmed name and persists', () => {
    const task = createTask({ name: '  Hello  ' }, [existing]);
    expect(task.name).toBe('Hello');
    expect(task.sessions).toEqual([]);
    const persisted = JSON.parse(mock.__store.get('webtimer:state:v1')!);
    expect(persisted.tasks).toHaveLength(2);
  });
});

describe('deleteTask', () => {
  it('happy path: removes task and persists', () => {
    const r = deleteTask({ taskId: 'old-1', confirmed: true }, [existing]);
    expect(r.removed).toBe(true);
    const persisted = JSON.parse(mock.__store.get('webtimer:state:v1')!);
    expect(persisted.tasks).toHaveLength(0);
  });
});

describe('discardOpenAndDelete', () => {
  const runningTask: Task = {
    ...existing,
    id: 'run-1',
    sessions: [{ startedAt: 10, endedAt: null, pauses: [] }],
  };

  it('happy path: removes running task and open session', () => {
    const r = discardOpenAndDelete({ taskId: 'run-1', confirmed: true }, [runningTask, existing]);
    expect(r.removed).toBe(true);
    const persisted = JSON.parse(mock.__store.get('webtimer:state:v1')!);
    expect(persisted.tasks).toHaveLength(1);
    expect(persisted.tasks[0].id).toBe('old-1');
  });
});
