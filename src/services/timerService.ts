// timerService — start/stop/switch timer sessions.
// Covers statechart actions: startSessionOnTask, switchRunningTask, ignoreAlreadyRunning,
// stopSessionOnTask, clampNegativeAndClose, reportTaskNotFound, retryOrRevertStart,
// retryOrKeepOpen, reconcileNoOpenSession.
import type { Task } from '../types/task';
import type { StartTimerInput, StopTimerInput } from '../types/inputs';
import type { TaskNotFoundError, StorageWriteError, NoOpenSessionError } from '../types/errors';
import { PERSISTED_SCHEMA_VERSION } from '../types/task';
import { writePersistedState } from '../storage/localStorageAdapter';
import { getOpenSession } from '../lib/time';

export function startSessionOnTask(input: StartTimerInput, currentTasks: Task[]): Task[] {
  const task = currentTasks.find(t => t.id === input.taskId);
  if (!task) {
    throw { kind: 'TaskNotFound', taskId: input.taskId, message: `Task ${input.taskId} not found` } as TaskNotFoundError;
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

export function switchRunningTask(
  input: StartTimerInput,
  currentTasks: Task[],
  runningTaskId: string,
): Task[] {
  const runningTask = currentTasks.find(t => t.id === runningTaskId);
  if (!runningTask) {
    throw { kind: 'TaskNotFound', taskId: runningTaskId, message: `Running task ${runningTaskId} not found` } as TaskNotFoundError;
  }

  const openSession = getOpenSession(runningTask);
  if (!openSession) {
    throw { kind: 'NoOpenSession', taskId: runningTaskId, message: 'No open session on running task' } as NoOpenSessionError;
  }

  const closedEndedAt = input.now < openSession.startedAt ? openSession.startedAt : input.now;
  const updatedRunningTask: Task = {
    ...runningTask,
    sessions: runningTask.sessions.map(s => s === openSession ? { ...s, endedAt: closedEndedAt } : s)
  };

  const targetTask = currentTasks.find(t => t.id === input.taskId);
  if (!targetTask) {
    throw { kind: 'TaskNotFound', taskId: input.taskId, message: `Task ${input.taskId} not found` } as TaskNotFoundError;
  }

  const updatedTargetTask: Task = {
    ...targetTask,
    sessions: [...targetTask.sessions, { startedAt: input.now, endedAt: null, pauses: [] }]
  };

  const updatedTasks = currentTasks.map(t => {
    if (t.id === runningTaskId) return updatedRunningTask;
    if (t.id === input.taskId) return updatedTargetTask;
    return t;
  });

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

  console.warn(`Start called on already-running task: ${input.taskId}`);
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

  console.warn(`Negative duration detected: now=${input.now}, startedAt=${openSession.startedAt}`);

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
): StorageWriteError {
  void _input;
  const retryResult = writePersistedState({ schemaVersion: PERSISTED_SCHEMA_VERSION, tasks: previousTasks });

  const reverted = retryResult.ok;

  return {
    kind: 'StorageWriteFailed',
    message: 'Failed to start timer',
    attempt: 2,
    reverted,
    cause
  };
}

export function retryOrKeepOpen(
  _input: StopTimerInput,
  previousTasks: Task[],
  cause: unknown,
): StorageWriteError {
  void _input;
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
  _input: StopTimerInput,
  _currentTasks: Task[],
): NoOpenSessionError {
  void _input;
  void _currentTasks;
  console.warn(`No open session found on task: ${_input.taskId}`);

  return {
    kind: 'NoOpenSession',
    taskId: _input.taskId,
    message: 'No open session found on task'
  };
}
