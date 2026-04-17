import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockLocalStorage, resetMockLocalStorage, type MockStorage } from '../helpers/localStorageMock';
import {
  startSessionOnTask,
  ignoreAlreadyRunning,
  stopSessionOnTask,
  clampNegativeAndClose,
  reportTaskNotFound,
  retryOrRevertStart,
  retryOrKeepOpen,
  reconcileNoOpenSession,
  pauseSessionOnTask,
  resumeSessionOnTask,
} from '../../src/services/timerService';
import type { Task } from '../../src/types/task';

let mock: MockStorage;
beforeEach(() => {
  mock = installMockLocalStorage();
  resetMockLocalStorage(mock);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

const idleTask: Task = { id: 't1', name: 'T1', createdAt: 1, sessions: [], timerMode: 'countup', countdownDurationMs: null, scheduledStartAt: null, scheduledEndAt: null };
const runningTask: Task = {
  id: 't2',
  name: 'T2',
  createdAt: 2,
  sessions: [{ startedAt: 100, endedAt: null, pauses: [] }],
  timerMode: 'countup',
  countdownDurationMs: null,
  scheduledStartAt: null,
  scheduledEndAt: null
};

describe('startSessionOnTask', () => {
  it('happy path: appends open session', () => {
    const tasks = startSessionOnTask({ taskId: 't1', now: 1000 }, [idleTask]);
    expect(tasks[0].sessions).toEqual([{ startedAt: 1000, endedAt: null, pauses: [] }]);
  });

  it('happy path: allows multiple simultaneous tasks', () => {
    const tasks = startSessionOnTask({ taskId: 't1', now: 1000 }, [idleTask, runningTask]);
    expect(tasks.find(t => t.id === 't1')!.sessions).toHaveLength(1);
    expect(tasks.find(t => t.id === 't2')!.sessions[0].endedAt).toBeNull();
  });
});

describe('ignoreAlreadyRunning', () => {
  it('happy path: returns task list unchanged', () => {
    const result = ignoreAlreadyRunning({ taskId: 't2', now: 900 }, [runningTask]);
    expect(result).toEqual([runningTask]);
  });
});

describe('stopSessionOnTask', () => {
  it('happy path: closes open session', () => {
    const tasks = stopSessionOnTask({ taskId: 't2', now: 500 }, [runningTask]);
    expect(tasks[0].sessions[0].endedAt).toBe(500);
  });
});

describe('pauseSessionOnTask', () => {
  it('happy path: adds pause interval', () => {
    const tasks = pauseSessionOnTask({ taskId: 't2', now: 150 }, [runningTask]);
    expect(tasks[0].sessions[0].pauses).toHaveLength(1);
    expect(tasks[0].sessions[0].pauses![0].resumedAt).toBeNull();
  });
});

describe('resumeSessionOnTask', () => {
  it('happy path: closes pause interval', () => {
    const pausedTask: Task = {
      ...runningTask,
      sessions: [{ ...runningTask.sessions[0], pauses: [{ pausedAt: 120, resumedAt: null }] }]
    };
    const tasks = resumeSessionOnTask({ taskId: 't2', now: 180 }, [pausedTask]);
    expect(tasks[0].sessions[0].pauses![0].resumedAt).toBe(180);
  });
});
