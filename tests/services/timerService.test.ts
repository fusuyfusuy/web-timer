import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockLocalStorage, resetMockLocalStorage, type MockStorage } from '../helpers/localStorageMock';
import {
  startSessionOnTask,
  switchRunningTask,
  ignoreAlreadyRunning,
  stopSessionOnTask,
  clampNegativeAndClose,
  reportTaskNotFound,
  retryOrRevertStart,
  retryOrKeepOpen,
  reconcileNoOpenSession,
} from '../../src/services/timerService';
import type { Task } from '../../src/types/task';

let mock: MockStorage;
beforeEach(() => {
  mock = installMockLocalStorage();
  resetMockLocalStorage(mock);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

const idleTask: Task = { id: 't1', name: 'T1', createdAt: 1, sessions: [] };
const runningTask: Task = {
  id: 't2',
  name: 'T2',
  createdAt: 2,
  sessions: [{ startedAt: 100, endedAt: null, pauses: [] }],
};

describe('startSessionOnTask — START_TIMER (idle → idle_running)', () => {
  it('happy path: appends open session', () => {
    const updated = startSessionOnTask({ taskId: 't1', now: 1000 }, [idleTask]);
    expect(updated.sessions).toEqual([{ startedAt: 1000, endedAt: null, pauses: [] }]);
  });

  it('error path: throws TaskNotFoundError for unknown task', () => {
    expect(() => startSessionOnTask({ taskId: 'nope', now: 1000 }, [idleTask])).toThrow();
  });
});

describe('switchRunningTask — START_TIMER (idle_running → idle_running, different task)', () => {
  it('happy path: closes old open session, starts new one', () => {
    const updated = switchRunningTask({ taskId: 't1', now: 500 }, [runningTask, idleTask], 't2');
    expect(updated.id).toBe('t1');
    expect(updated.sessions).toEqual([{ startedAt: 500, endedAt: null, pauses: [] }]);
    const persisted = JSON.parse(mock.__store.get('webtimer:state:v1')!);
    const oldTask = persisted.tasks.find((t: Task) => t.id === 't2');
    expect(oldTask.sessions[0].endedAt).toBe(500);
  });

  it('error path: target task missing → throws TaskNotFoundError', () => {
    expect(() => switchRunningTask({ taskId: 'missing', now: 500 }, [runningTask], 't2')).toThrow();
  });
});

describe('ignoreAlreadyRunning — START_TIMER_SAME', () => {
  it('happy path: returns task unchanged, no write', () => {
    const result = ignoreAlreadyRunning({ taskId: 't2', now: 900 }, [runningTask]);
    expect(result).toEqual(runningTask);
    expect(mock.__store.size).toBe(0);
  });

  it('error path: unknown task id throws', () => {
    expect(() => ignoreAlreadyRunning({ taskId: 'nope', now: 900 }, [runningTask])).toThrow();
  });
});

describe('stopSessionOnTask — STOP_TIMER', () => {
  it('happy path: closes open session', () => {
    const updated = stopSessionOnTask({ taskId: 't2', now: 500 }, [runningTask]);
    expect(updated.sessions[0].endedAt).toBe(500);
  });

  it('error path: throws NoOpenSessionError when no open session', () => {
    const closed: Task = { id: 't3', name: 'c', createdAt: 3, sessions: [{ startedAt: 1, endedAt: 2 }] };
    expect(() => stopSessionOnTask({ taskId: 't3', now: 9 }, [closed])).toThrow();
  });
});

describe('clampNegativeAndClose — STOP_TIMER_NEGATIVE', () => {
  it('happy path: clamps endedAt to startedAt', () => {
    const updated = clampNegativeAndClose({ taskId: 't2', now: 50 }, [runningTask]);
    expect(updated.sessions[0].endedAt).toBe(100);
  });

  it('error path: throws when no open session', () => {
    expect(() => clampNegativeAndClose({ taskId: 't1', now: 50 }, [idleTask])).toThrow();
  });
});

describe('reportTaskNotFound — START_TIMER_NOT_FOUND', () => {
  it('happy path: returns TaskNotFoundError with taskId', () => {
    const err = reportTaskNotFound({ taskId: 'x', now: 1 });
    expect(err.kind).toBe('TaskNotFound');
    expect(err.taskId).toBe('x');
  });

  it('error path: does not throw', () => {
    expect(() => reportTaskNotFound({ taskId: 'any', now: 0 })).not.toThrow();
  });
});

describe('retryOrRevertStart — START_TIMER_STORAGE_FAIL', () => {
  it('happy path: successful revert → reverted=true, attempt=2', () => {
    const err = retryOrRevertStart({ taskId: 't1', now: 1 }, [idleTask], new Error('boom'));
    expect(err.attempt).toBe(2);
    expect(err.reverted).toBe(true);
  });

  it('error path: revert fails → reverted=false', () => {
    mock.__writeThrows = true;
    const err = retryOrRevertStart({ taskId: 't1', now: 1 }, [idleTask], new Error('boom'));
    expect(err.reverted).toBe(false);
  });
});

describe('retryOrKeepOpen — STOP_TIMER_STORAGE_FAIL', () => {
  it('happy path: returns StorageWriteError keeping session open', () => {
    const err = retryOrKeepOpen({ taskId: 't2', now: 500 }, [runningTask], new Error('boom'));
    expect(err.kind).toBe('StorageWriteFailed');
    expect(err.reverted).toBe(false);
    expect(err.attempt).toBe(2);
  });

  it('error path: still returns error even if retry write also fails', () => {
    mock.__writeThrows = true;
    const err = retryOrKeepOpen({ taskId: 't2', now: 500 }, [runningTask], new Error('boom'));
    expect(err.kind).toBe('StorageWriteFailed');
  });
});

describe('reconcileNoOpenSession — STOP_TIMER_NO_OPEN', () => {
  it('happy path: returns NoOpenSessionError', () => {
    const err = reconcileNoOpenSession({ taskId: 't1', now: 1 }, [idleTask]);
    expect(err.kind).toBe('NoOpenSession');
    expect(err.taskId).toBe('t1');
  });

  it('error path: still returns error even when task is missing', () => {
    const err = reconcileNoOpenSession({ taskId: 'absent', now: 1 }, [idleTask]);
    expect(err.kind).toBe('NoOpenSession');
  });
});
