// app.ts — DOM rendering controller. Dispatches user events into services and re-renders on state change.

import type { Task, TaskView } from '../types/task';
import type { AppError } from '../types/errors';
import type { StateName } from '../types/events';
import { TaskNameSchema } from '../types/task';
import {
  isStorageAvailable,
  readPersistedState,
  parsePersistedState,
} from '../storage/localStorageAdapter';
import {
  hydrateTasks,
  resumeOpenSession,
  stashCorruptAndPrompt,
  startMemoryOnly,
  promptMigrationReset,
  reconcileMultipleOpenSessions,
} from '../services/bootService';
import {
  createTask,
  rejectInvalidName,
  reportStorageWriteFailure,
  deleteTask,
  abortDeleteSilently,
  retryOrRestoreDelete,
  discardOpenAndDelete,
} from '../services/taskService';
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
} from '../services/timerService';
import { recomputeTotals, recomputeTotalsWithOpen } from '../services/tickService';
import { getOpenSession } from '../lib/time';

export interface AppState {
  currentState: StateName;
  tasks: Task[];
  runningTaskId: string | null;
  error: AppError | null;
}

let appState: AppState = {
  currentState: 'booting',
  tasks: [],
  runningTaskId: null,
  error: null,
};

let tickIntervalId: number | null = null;

export function initApp(): void {
  if (!isStorageAvailable()) {
    const memResult = startMemoryOnly({ now: Date.now(), rawStorage: null });
    appState = {
      currentState: 'error_storage_unavailable',
      tasks: [],
      runningTaskId: null,
      error: {
        kind: 'StorageUnavailable',
        message: memResult.warning,
      },
    };
    renderApp(appState);
    bindEventListeners();
    return;
  }

  const readResult = readPersistedState();
  if (!readResult.ok) {
    appState = {
      currentState: 'error_storage_unavailable',
      tasks: [],
      runningTaskId: null,
      error: readResult.error,
    };
    renderApp(appState);
    bindEventListeners();
    return;
  }

  const rawStorage = readResult.raw;

  if (rawStorage === null) {
    const hydrateResult = hydrateTasks({ now: Date.now(), rawStorage: null });
    appState = {
      currentState: 'idle',
      tasks: hydrateResult.tasks,
      runningTaskId: hydrateResult.runningTaskId,
      error: null,
    };
    renderApp(appState);
    bindEventListeners();
    return;
  }

  const parseResult = parsePersistedState(rawStorage);
  if (!parseResult.ok) {
    if (parseResult.error.kind === 'SchemaVersionMismatch') {
      const schemaMismatchResult = promptMigrationReset({
        now: Date.now(),
        rawStorage,
      });
      appState = {
        currentState: 'error_schema_mismatch',
        tasks: [],
        runningTaskId: null,
        error: {
          kind: 'SchemaVersionMismatch',
          message: schemaMismatchResult.promptMessage,
        },
      };
    } else {
      const corruptResult = stashCorruptAndPrompt({
        now: Date.now(),
        rawStorage,
      });
      appState = {
        currentState: 'error_corrupt',
        tasks: [],
        runningTaskId: null,
        error: {
          kind: 'CorruptStorageData',
          message: corruptResult.promptMessage,
        },
      };
    }
    renderApp(appState);
    bindEventListeners();
    return;
  }

  const tasksWithOpen = parseResult.state.tasks.filter(
    (t) => t.sessions.some((s) => s.endedAt === null),
  );

  let hydrateResult;
  if (tasksWithOpen.length === 0) {
    hydrateResult = hydrateTasks({ now: Date.now(), rawStorage });
    appState = {
      currentState: 'idle',
      tasks: hydrateResult.tasks,
      runningTaskId: hydrateResult.runningTaskId,
      error: null,
    };
  } else if (tasksWithOpen.length === 1) {
    hydrateResult = resumeOpenSession({ now: Date.now(), rawStorage });
    appState = {
      currentState: 'idle_running',
      tasks: hydrateResult.tasks,
      runningTaskId: hydrateResult.runningTaskId,
      error: null,
    };
    startTickInterval();
  } else {
    hydrateResult = reconcileMultipleOpenSessions({
      now: Date.now(),
      rawStorage,
    });
    appState = {
      currentState: 'idle_running',
      tasks: hydrateResult.tasks,
      runningTaskId: hydrateResult.runningTaskId,
      error: null,
    };
    startTickInterval();
  }

  renderApp(appState);
  bindEventListeners();
}

export function renderApp(state: AppState): void {
  const now = Date.now();

  let views: TaskView[];
  if (state.currentState === 'idle_running' && state.runningTaskId !== null) {
    const tickResult = recomputeTotalsWithOpen(
      { now },
      state.tasks,
      state.runningTaskId,
    );
    views = tickResult.views;
  } else {
    const tickResult = recomputeTotals({ now }, state.tasks);
    views = tickResult.views;
  }

  const taskListContainer = document.getElementById('task-list');
  if (taskListContainer) {
    taskListContainer.innerHTML = '';
    for (const view of views) {
      const row = renderTaskRow(view, view.isRunning);
      taskListContainer.appendChild(row);
    }
  }

  const errorBanner = document.getElementById('error-banner');
  const errorMessage = document.getElementById('error-message');
  if (state.error !== null) {
    if (errorBanner) {
      errorBanner.hidden = false;
    }
    if (errorMessage) {
      errorMessage.textContent = state.error.message;
    }
  } else {
    if (errorBanner) {
      errorBanner.hidden = true;
    }
  }

  const addTaskSubmit = document.getElementById('add-task-btn');
  if (addTaskSubmit && addTaskSubmit instanceof HTMLButtonElement) {
    if (
      state.currentState === 'error_validation' ||
      state.currentState === 'error_storage_write'
    ) {
      addTaskSubmit.disabled = true;
    } else {
      addTaskSubmit.disabled = false;
    }
  }
}

export function renderTaskRow(view: TaskView, isRunning: boolean): HTMLElement {
  const row = document.createElement('li');
  row.dataset.taskId = view.id;

  const nameSpan = document.createElement('span');
  nameSpan.textContent = view.name;
  nameSpan.style.marginRight = '10px';

  const totalSpan = document.createElement('span');
  totalSpan.textContent = view.formattedTotal;
  totalSpan.style.marginRight = '10px';

  const toggleButton = document.createElement('button');
  toggleButton.textContent = isRunning ? 'Stop' : 'Start';
  toggleButton.type = 'button';
  toggleButton.style.marginRight = '5px';
  toggleButton.addEventListener('click', () => {
    if (isRunning) {
      handleStopTimer(view.id);
    } else {
      handleStartTimer(view.id);
    }
  });

  const deleteButton = document.createElement('button');
  deleteButton.textContent = 'Delete';
  deleteButton.type = 'button';
  deleteButton.addEventListener('click', () => {
    handleDeleteTask(view.id);
  });

  row.appendChild(nameSpan);
  row.appendChild(totalSpan);
  row.appendChild(toggleButton);
  row.appendChild(deleteButton);

  return row;
}

export function handleCreateTask(nameInput: string): void {
  const validationResult = TaskNameSchema.safeParse(nameInput.trim());
  if (!validationResult.success) {
    const error = rejectInvalidName({ name: nameInput });
    appState = {
      ...appState,
      currentState: 'error_validation',
      error,
    };
    renderApp(appState);
    return;
  }

  try {
    const newTask = createTask({ name: nameInput }, appState.tasks);
    appState = {
      ...appState,
      currentState: appState.currentState === 'idle_running' ? 'idle_running' : 'idle',
      tasks: [newTask, ...appState.tasks],
      error: null,
    };

    const inputEl = document.getElementById('task-name-input');
    if (inputEl && inputEl instanceof HTMLInputElement) {
      inputEl.value = '';
    }

    renderApp(appState);
  } catch (err) {
    const error = reportStorageWriteFailure({ name: nameInput }, err);
    appState = {
      ...appState,
      currentState: 'error_storage_write',
      error,
    };
    renderApp(appState);
  }
}

export function handleStartTimer(taskId: string): void {
  const now = Date.now();

  if (
    appState.currentState === 'idle_running' &&
    taskId === appState.runningTaskId
  ) {
    ignoreAlreadyRunning({ taskId, now }, appState.tasks);
    renderApp(appState);
    return;
  }

  try {
    let updatedTask: Task;

    if (appState.currentState === 'idle_running' && appState.runningTaskId) {
      updatedTask = switchRunningTask(
        { taskId, now },
        appState.tasks,
        appState.runningTaskId,
      );
    } else {
      updatedTask = startSessionOnTask({ taskId, now }, appState.tasks);
    }

    appState = {
      ...appState,
      currentState: 'idle_running',
      tasks: appState.tasks.map((t) => (t.id === taskId ? updatedTask : t)),
      error: null,
    };

    startTickInterval();
    renderApp(appState);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'kind' in err &&
      err.kind === 'TaskNotFound'
    ) {
      const error = reportTaskNotFound({ taskId, now });
      appState = {
        ...appState,
        currentState: 'error_task_not_found',
        error,
      };
    } else {
      const error = retryOrRevertStart(
        { taskId, now },
        appState.tasks,
        err,
      );
      appState = {
        ...appState,
        currentState: 'error_storage_write',
        error,
      };
    }
    renderApp(appState);
  }
}

export function handleStopTimer(taskId: string): void {
  const now = Date.now();

  const task = appState.tasks.find((t) => t.id === taskId);
  const openSession = task ? getOpenSession(task) : undefined;

  if (!openSession) {
    const error = reconcileNoOpenSession({ taskId, now }, appState.tasks);
    appState = {
      ...appState,
      currentState: 'idle_running',
      error,
    };
    renderApp(appState);
    return;
  }

  try {
    let updatedTask: Task;

    if (now < openSession.startedAt) {
      updatedTask = clampNegativeAndClose({ taskId, now }, appState.tasks);
    } else {
      updatedTask = stopSessionOnTask({ taskId, now }, appState.tasks);
    }

    const updatedTasks = appState.tasks.map((t) =>
      t.id === taskId ? updatedTask : t,
    );

    appState = {
      ...appState,
      currentState: 'idle',
      tasks: updatedTasks,
      runningTaskId: null,
      error: null,
    };

    clearTickInterval();
    renderApp(appState);
  } catch (err) {
    const error = retryOrKeepOpen(
      { taskId, now },
      appState.tasks,
      err,
    );
    appState = {
      ...appState,
      currentState: 'error_storage_write',
      error,
    };
    renderApp(appState);
  }
}

export function handleDeleteTask(taskId: string): void {
  const confirmed = window.confirm('Delete this task?');

  if (!confirmed) {
    abortDeleteSilently({ taskId, confirmed: false });
    renderApp(appState);
    return;
  }

  try {
    const wasRunning = appState.runningTaskId === taskId;

    if (wasRunning) {
      discardOpenAndDelete({ taskId, confirmed: true }, appState.tasks);
    } else {
      deleteTask({ taskId, confirmed: true }, appState.tasks);
    }

    const updatedTasks = appState.tasks.filter((t) => t.id !== taskId);

    appState = {
      ...appState,
      currentState: wasRunning ? 'idle' : appState.currentState,
      tasks: updatedTasks,
      runningTaskId: wasRunning ? null : appState.runningTaskId,
      error: null,
    };

    if (wasRunning) {
      clearTickInterval();
    }

    renderApp(appState);
  } catch (err) {
    const error = retryOrRestoreDelete(
      { taskId, confirmed: true },
      appState.tasks,
      err,
    );
    appState = {
      ...appState,
      currentState: 'error_storage_write',
      error,
    };
    renderApp(appState);
  }
}

function startTickInterval(): void {
  if (tickIntervalId === null) {
    tickIntervalId = window.setInterval(() => {
      if (appState.currentState === 'idle_running') {
        renderApp(appState);
      }
    }, 1000);
  }
}

function clearTickInterval(): void {
  if (tickIntervalId !== null) {
    window.clearInterval(tickIntervalId);
    tickIntervalId = null;
  }
}

function bindEventListeners(): void {
  const form = document.getElementById('create-task-form');
  if (form && form instanceof HTMLFormElement) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const inputEl = document.getElementById('task-name-input');
      if (inputEl && inputEl instanceof HTMLInputElement) {
        handleCreateTask(inputEl.value);
      }
    });
  }

  const dismissBtn = document.getElementById('dismiss-error-btn');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      appState = {
        ...appState,
        currentState: 'idle',
        error: null,
      };
      renderApp(appState);
    });
  }

  const resetBtn = document.getElementById('reset-storage-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      appState = {
        currentState: 'idle',
        tasks: [],
        runningTaskId: null,
        error: null,
      };
      renderApp(appState);
    });
  }
}
