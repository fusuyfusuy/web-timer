// timerService — start/stop/pause timer sessions.
import type { Task } from '../types/task';
import type { StartTimerInput, StopTimerInput } from '../types/inputs';
import type { TaskNotFoundError, NoOpenSessionError } from '../types/errors';
import { PERSISTED_SCHEMA_VERSION } from '../types/task';
import { writePersistedState } from '../storage/localStorageAdapter';
import { getOpenSession, hasOpenSession } from '../lib/time';

export function startSessionOnTask(input: StartTimerInput, currentTasks: Task[]): Task[] {
  const task = currentTasks.find(t => t.id === input.taskId);
  if (!task) {
    throw { kind: 'TaskNotFound', taskId: input.taskId, message: `Task ${input.taskId} not found` } as TaskNotFoundError;
  }

  // If already running, just return current state
  if (hasOpenSession(task)) {
    return currentTasks;
  }

  const updatedTask: Task = {
    ...task,
    sessions: [...task.sessions, { startedAt: input.now, endedAt: null, pauses: [] }]
  };

  const updatedTasks = currentTasks.map(t => t.id === task.id ? updatedTask : t);
  const result = writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: updatedTasks });

  if (!result.ok) {
    throw result.error;
  }

  return updatedTasks;
}

export function ignoreAlreadyRunning(input: StartTimerInput, currentTasks: Task[]): Task[] {
  const task = currentTasks.find(t => t.id === input.taskId);
  if (!task) {
    throw { kind: 'TaskNotFound', taskId: input.taskId, message: `Task ${input.taskId} not found` } as TaskNotFoundError;
  }
  return currentTasks;
}

export function stopSessionOnTask(input: StopTimerInput, currentTasks: Task[]): Task[] {
  const task = currentTasks.find(t => t.id === input.taskId);
  if (!task) {
    throw { kind: 'TaskNotFound', taskId: input.taskId, message: `Task ${input.taskId} not found` } as TaskNotFoundError;
  }

  const openSession = getOpenSession(task);
  if (!openSession) {
    throw { kind: 'NoOpenSession', taskId: input.taskId, message: 'No open session found on task' } as NoOpenSessionError;
  }

  const updatedTask: Task = {
    ...task,
    sessions: task.sessions.map(s => s === openSession ? { ...s, endedAt: input.now } : s)
  };

  const updatedTasks = currentTasks.map(t => t.id === task.id ? updatedTask : t);
  const result = writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: updatedTasks });

  if (!result.ok) {
    throw result.error;
  }

  return updatedTasks;
}

export function clampNegativeAndClose(input: StopTimerInput, currentTasks: Task[]): Task[] {
  const task = currentTasks.find(t => t.id === input.taskId);
  if (!task) {
    throw { kind: 'TaskNotFound', taskId: input.taskId, message: `Task ${input.taskId} not found` } as TaskNotFoundError;
  }

  const openSession = getOpenSession(task);
  if (!openSession) {
    throw { kind: 'NoOpenSession', taskId: input.taskId, message: 'No open session found on task' } as NoOpenSessionError;
  }

  const updatedTask: Task = {
    ...task,
    sessions: task.sessions.map(s => s === openSession ? { ...s, endedAt: openSession.startedAt } : s)
  };

  const updatedTasks = currentTasks.map(t => t.id === task.id ? updatedTask : t);
  const result = writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: updatedTasks });

  if (!result.ok) {
    throw result.error;
  }

  return updatedTasks;
}

export function pauseSessionOnTask(input: StopTimerInput, currentTasks: Task[]): Task[] {
  const task = currentTasks.find(t => t.id === input.taskId);
  if (!task) {
    throw { kind: 'TaskNotFound', taskId: input.taskId, message: `Task ${input.taskId} not found` } as TaskNotFoundError;
  }

  const openSession = getOpenSession(task);
  if (!openSession) {
    throw { kind: 'NoOpenSession', taskId: input.taskId, message: 'No open session found on task' } as NoOpenSessionError;
  }

  const updatedTask: Task = {
    ...task,
    sessions: task.sessions.map(s => s === openSession
      ? { ...s, pauses: [...(s.pauses ?? []), { pausedAt: input.now, resumedAt: null }] }
      : s
    )
  };

  const updatedTasks = currentTasks.map(t => t.id === task.id ? updatedTask : t);
  const result = writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: updatedTasks });

  if (!result.ok) {
    throw result.error;
  }

  return updatedTasks;
}

export function resumeSessionOnTask(input: StopTimerInput, currentTasks: Task[]): Task[] {
  const task = currentTasks.find(t => t.id === input.taskId);
  if (!task) {
    throw { kind: 'TaskNotFound', taskId: input.taskId, message: `Task ${input.taskId} not found` } as TaskNotFoundError;
  }

  const openSession = getOpenSession(task);
  if (!openSession) {
    throw { kind: 'NoOpenSession', taskId: input.taskId, message: 'No open session found on task' } as NoOpenSessionError;
  }

  const updatedTask: Task = {
    ...task,
    sessions: task.sessions.map(s => s === openSession
      ? { ...s, pauses: (s.pauses ?? []).map(p => p.resumedAt === null ? { ...p, resumedAt: input.now } : p) }
      : s
    )
  };

  const updatedTasks = currentTasks.map(t => t.id === task.id ? updatedTask : t);
  const result = writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: updatedTasks });

  if (!result.ok) {
    throw result.error;
  }

  return updatedTasks;
}

export function reportTaskNotFound(input: StartTimerInput): TaskNotFoundError {
  return {
    kind: 'TaskNotFound',
    taskId: input.taskId,
    message: `Task ${input.taskId} not found`
  };
}

export function retryOrRevertStart(
  _input: StartTimerInput,
  previousTasks: Task[],
  cause: unknown,
): any {
  const result = writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: previousTasks });
  return {
    kind: 'StorageWriteFailed',
    message: 'Failed to start timer',
    attempt: 2,
    reverted: result.ok,
    cause
  };
}

export function retryOrKeepOpen(
  _input: StopTimerInput,
  previousTasks: Task[],
  cause: unknown,
): any {
  writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: previousTasks });
  return {
    kind: 'StorageWriteFailed',
    message: 'Failed to stop timer; session kept open',
    attempt: 2,
    reverted: false,
    cause
  };
}

export function reconcileNoOpenSession(
  input: StopTimerInput,
  _currentTasks: Task[],
): NoOpenSessionError {
  return {
    kind: 'NoOpenSession',
    taskId: input.taskId,
    message: 'No open session found on task'
  };
}
