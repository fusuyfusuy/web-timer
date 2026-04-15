// taskService — create/delete task, validation.
// Covers statechart actions: createTask, rejectInvalidName, reportStorageWriteFailure,
// deleteTask, abortDeleteSilently, retryOrRestoreDelete, discardOpenAndDelete.
import type { Task } from '../types/task';
import type { TaskInput, DeleteTaskInput, DeleteResult } from '../types/inputs';
import type { ValidationError, StorageWriteError } from '../types/errors';
import { TASK_NAME_MAX_LENGTH, PERSISTED_SCHEMA_VERSION, TaskNameSchema } from '../types/task';
import { generateId } from '../lib/id';
import { writePersistedState } from '../storage/localStorageAdapter';

export function createTask(input: TaskInput, currentTasks: Task[]): Task {
  const trimmedName = input.name.trim();
  TaskNameSchema.parse(trimmedName);

  const newTask: Task = {
    id: generateId(),
    name: trimmedName,
    createdAt: Date.now(),
    sessions: [],
  };

  const updatedTasks = [newTask, ...currentTasks];
  const result = writePersistedState({
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    tasks: updatedTasks,
  });

  if (!result.ok) {
    throw result.error;
  }

  return newTask;
}

export function rejectInvalidName(input: TaskInput): ValidationError {
  const trimmed = input.name.trim();

  if (trimmed.length === 0) {
    return {
      kind: 'EmptyName',
      field: 'name',
      message: 'Task name must be non-empty',
    };
  }

  if (trimmed.length > TASK_NAME_MAX_LENGTH) {
    return {
      kind: 'NameTooLong',
      field: 'name',
      message: `Task name must be <= ${TASK_NAME_MAX_LENGTH} chars`,
    };
  }

  return {
    kind: 'EmptyName',
    field: 'name',
    message: 'Task name failed validation',
  };
}

export function reportStorageWriteFailure(_input: TaskInput, cause: unknown): StorageWriteError {
  void _input;
  return {
    kind: 'StorageWriteFailed',
    message: 'Failed to persist new task',
    attempt: 1,
    reverted: true,
    cause,
  };
}

export function deleteTask(input: DeleteTaskInput, currentTasks: Task[]): DeleteResult {
  const updatedTasks = currentTasks.filter((t) => t.id !== input.taskId);

  const result = writePersistedState({
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    tasks: updatedTasks,
  });

  if (!result.ok) {
    throw result.error;
  }

  return {
    deletedId: input.taskId,
    removed: true,
  };
}

export function abortDeleteSilently(input: DeleteTaskInput): DeleteResult {
  return {
    deletedId: input.taskId,
    removed: false,
  };
}

export function retryOrRestoreDelete(
  _input: DeleteTaskInput,
  currentTasks: Task[],
  cause: unknown,
): StorageWriteError {
  void _input;
  const retryResult = writePersistedState({
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    tasks: currentTasks,
  });

  if (retryResult.ok) {
    return {
      kind: 'StorageWriteFailed',
      message: 'Failed to delete task',
      attempt: 2,
      reverted: true,
      cause,
    };
  }

  return {
    kind: 'StorageWriteFailed',
    message: 'Failed to delete task',
    attempt: 2,
    reverted: false,
    cause,
  };
}

export function discardOpenAndDelete(input: DeleteTaskInput, currentTasks: Task[]): DeleteResult {
  const updatedTasks = currentTasks.filter((t) => t.id !== input.taskId);

  const result = writePersistedState({
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    tasks: updatedTasks,
  });

  if (!result.ok) {
    throw result.error;
  }

  return {
    deletedId: input.taskId,
    removed: true,
  };
}
