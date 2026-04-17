import type { Task, TaskView, TimerMode } from '../types/task';
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
  pauseSessionOnTask,
  resumeSessionOnTask,
} from '../services/timerService';
import { recomputeTotals, recomputeTotalsWithOpen } from '../services/tickService';
import { getOpenSession, isPaused } from '../lib/time';

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
let selectedMode: TimerMode = 'countup';

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
    const taskWithOpen = tasksWithOpen[0];
    const paused = isPaused(taskWithOpen);
    appState = {
      currentState: paused ? 'idle_paused' : 'idle_running',
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
  if ((state.currentState === 'idle_running' || state.currentState === 'idle_paused') && state.runningTaskId !== null) {
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
    if (views.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'No tasks yet. Create one above.';
      taskListContainer.appendChild(empty);
    } else {
      for (const view of views) {
        const row = renderTaskRow(view);
        taskListContainer.appendChild(row);
      }
    }
  }

  const errorBanner = document.getElementById('error-banner');
  const errorMessage = document.getElementById('error-message');
  if (state.error !== null) {
    if (errorBanner) errorBanner.hidden = false;
    if (errorMessage) errorMessage.textContent = state.error.message;
  } else {
    if (errorBanner) errorBanner.hidden = true;
  }

  const addTaskSubmit = document.getElementById('add-task-btn');
  if (addTaskSubmit && addTaskSubmit instanceof HTMLButtonElement) {
    addTaskSubmit.disabled =
      state.currentState === 'error_validation' ||
      state.currentState === 'error_storage_write';
  }

  checkScheduledTasks(now);
}

export function renderTaskRow(view: TaskView): HTMLElement {
  const row = document.createElement('li');
  row.dataset.taskId = view.id;
  row.className = 'task-card';

  if (view.isRunning && !view.isPaused) row.classList.add('running');
  if (view.isPaused) row.classList.add('paused');
  if (view.isCountdown) row.classList.add('countdown');
  if (view.isExpired) row.classList.add('expired');

  const task = appState.tasks.find(t => t.id === view.id);
  if (task?.scheduledStartAt && task.scheduledStartAt > Date.now() && !view.isRunning) {
    row.classList.add('scheduled');
  }

  const info = document.createElement('div');
  info.className = 'task-info';

  const name = document.createElement('div');
  name.className = 'task-name';
  name.textContent = view.name;

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  if (view.isCountdown) {
    meta.textContent = view.isExpired ? "Time's up!" : 'Countdown';
  } else if (view.isPaused) {
    meta.textContent = 'Paused';
  } else if (view.isRunning) {
    meta.textContent = 'Running';
  }

  if (task?.scheduledStartAt && task.scheduledStartAt > Date.now() && !view.isRunning) {
    const dt = new Date(task.scheduledStartAt);
    meta.textContent = `Starts at ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  info.appendChild(name);
  info.appendChild(meta);

  const timer = document.createElement('div');
  timer.className = 'task-timer';
  timer.textContent = view.formattedTotal;

  const actions = document.createElement('div');
  actions.className = 'task-actions';

  if (view.isPaused) {
    const resumeBtn = document.createElement('button');
    resumeBtn.className = 'action-btn resume';
    resumeBtn.textContent = 'Resume';
    resumeBtn.type = 'button';
    resumeBtn.addEventListener('click', () => handleResumeTimer(view.id));

    const stopBtn = document.createElement('button');
    stopBtn.className = 'action-btn stop';
    stopBtn.textContent = 'Stop';
    stopBtn.type = 'button';
    stopBtn.addEventListener('click', () => handleStopTimer(view.id));

    actions.appendChild(resumeBtn);
    actions.appendChild(stopBtn);
  } else if (view.isRunning) {
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'action-btn pause';
    pauseBtn.textContent = 'Pause';
    pauseBtn.type = 'button';
    pauseBtn.addEventListener('click', () => handlePauseTimer(view.id));

    const stopBtn = document.createElement('button');
    stopBtn.className = 'action-btn stop';
    stopBtn.textContent = 'Stop';
    stopBtn.type = 'button';
    stopBtn.addEventListener('click', () => handleStopTimer(view.id));

    actions.appendChild(pauseBtn);
    actions.appendChild(stopBtn);
  } else {
    const startBtn = document.createElement('button');
    startBtn.className = 'action-btn start';
    startBtn.textContent = 'Start';
    startBtn.type = 'button';
    startBtn.addEventListener('click', () => handleStartTimer(view.id));
    actions.appendChild(startBtn);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'action-btn delete';
  deleteBtn.textContent = '\u00d7';
  deleteBtn.type = 'button';
  deleteBtn.addEventListener('click', () => handleDeleteTask(view.id));
  actions.appendChild(deleteBtn);

  row.appendChild(info);
  row.appendChild(timer);
  row.appendChild(actions);

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

  const hoursEl = document.getElementById('cd-hours') as HTMLInputElement | null;
  const minsEl = document.getElementById('cd-minutes') as HTMLInputElement | null;
  const secsEl = document.getElementById('cd-seconds') as HTMLInputElement | null;
  const startEl = document.getElementById('scheduled-start') as HTMLInputElement | null;
  const endEl = document.getElementById('scheduled-end') as HTMLInputElement | null;

  let countdownDurationMs: number | null = null;
  if (selectedMode === 'countdown') {
    const h = parseInt(hoursEl?.value || '0', 10) || 0;
    const m = parseInt(minsEl?.value || '0', 10) || 0;
    const s = parseInt(secsEl?.value || '0', 10) || 0;
    countdownDurationMs = ((h * 3600) + (m * 60) + s) * 1000;
    if (countdownDurationMs <= 0) countdownDurationMs = 5 * 60 * 1000;
  }

  const scheduledStartAt = startEl?.value ? new Date(startEl.value).getTime() : null;
  const scheduledEndAt = endEl?.value ? new Date(endEl.value).getTime() : null;

  try {
    const newTask = createTask({ name: nameInput }, appState.tasks);
    const taskWithOptions: Task = {
      ...newTask,
      timerMode: selectedMode,
      countdownDurationMs,
      scheduledStartAt,
      scheduledEndAt,
    };

    appState = {
      ...appState,
      currentState: appState.currentState === 'idle_running' || appState.currentState === 'idle_paused'
        ? appState.currentState : 'idle',
      tasks: [taskWithOptions, ...appState.tasks.filter(t => t.id !== newTask.id)],
      error: null,
    };

    const inputEl = document.getElementById('task-name-input');
    if (inputEl && inputEl instanceof HTMLInputElement) inputEl.value = '';
    if (startEl) startEl.value = '';
    if (endEl) endEl.value = '';

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

    if ((appState.currentState === 'idle_running' || appState.currentState === 'idle_paused') && appState.runningTaskId) {
      if (appState.currentState === 'idle_paused') {
        handleStopTimer(appState.runningTaskId);
      }
      if (appState.runningTaskId && appState.runningTaskId !== taskId) {
        updatedTask = switchRunningTask(
          { taskId, now },
          appState.tasks,
          appState.runningTaskId,
        );
      } else {
        updatedTask = startSessionOnTask({ taskId, now }, appState.tasks);
      }
    } else {
      updatedTask = startSessionOnTask({ taskId, now }, appState.tasks);
    }

    appState = {
      ...appState,
      currentState: 'idle_running',
      tasks: appState.tasks.map((t) => (t.id === taskId ? updatedTask : t)),
      runningTaskId: taskId,
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

export function handlePauseTimer(taskId: string): void {
  const now = Date.now();
  try {
    const updatedTask = pauseSessionOnTask({ taskId, now }, appState.tasks);
    appState = {
      ...appState,
      currentState: 'idle_paused',
      tasks: appState.tasks.map(t => t.id === taskId ? updatedTask : t),
      error: null,
    };
    renderApp(appState);
  } catch (err) {
    const error = retryOrKeepOpen({ taskId, now }, appState.tasks, err);
    appState = { ...appState, currentState: 'error_storage_write', error };
    renderApp(appState);
  }
}

export function handleResumeTimer(taskId: string): void {
  const now = Date.now();
  try {
    const updatedTask = resumeSessionOnTask({ taskId, now }, appState.tasks);
    appState = {
      ...appState,
      currentState: 'idle_running',
      tasks: appState.tasks.map(t => t.id === taskId ? updatedTask : t),
      error: null,
    };
    startTickInterval();
    renderApp(appState);
  } catch (err) {
    const error = retryOrKeepOpen({ taskId, now }, appState.tasks, err);
    appState = { ...appState, currentState: 'error_storage_write', error };
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

function checkScheduledTasks(now: number): void {
  for (const task of appState.tasks) {
    if (task.scheduledStartAt && task.scheduledStartAt <= now && !appState.runningTaskId) {
      const hasAnySessions = task.sessions.length > 0;
      if (!hasAnySessions) {
        task.scheduledStartAt = null;
        handleStartTimer(task.id);
        return;
      }
    }
    if (task.scheduledEndAt && task.scheduledEndAt <= now && appState.runningTaskId === task.id) {
      task.scheduledEndAt = null;
      handleStopTimer(task.id);
      return;
    }
  }
}

function startTickInterval(): void {
  if (tickIntervalId === null) {
    tickIntervalId = window.setInterval(() => {
      if (appState.currentState === 'idle_running' || appState.currentState === 'idle_paused') {
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

  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as TimerMode;
      selectedMode = mode;
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cdSettings = document.getElementById('countdown-settings');
      if (cdSettings) cdSettings.hidden = mode !== 'countdown';
    });
  });

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
