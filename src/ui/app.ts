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

import { DOM_IDS, STORAGE_KEYS } from './constants';

export interface AppState {
  currentState: StateName;
  tasks: Task[];
  runningTaskId: string | null;
  fullscreenTaskId: string | null;
  error: AppError | null;
}

let appState: AppState = {
  currentState: 'booting',
  tasks: [],
  runningTaskId: null,
  fullscreenTaskId: null,
  error: null,
};

let tickIntervalId: number | null = null;
let selectedMode: TimerMode = (localStorage.getItem(STORAGE_KEYS.SELECTED_MODE) as TimerMode) || 'countup';

/**
 * Centralized state dispatcher to ensure UI is always in sync with state changes.
 */
function dispatch(update: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const next = typeof update === 'function' ? update(appState) : update;
  appState = { ...appState, ...next };
  renderApp(appState);
}

export function initApp(): void {
  if (!isStorageAvailable()) {
    const memResult = startMemoryOnly({ now: Date.now(), rawStorage: null });
    dispatch({
      currentState: 'error_storage_unavailable',
      tasks: [],
      runningTaskId: null,
      error: {
        kind: 'StorageUnavailable',
        message: memResult.warning,
      },
    });
    bindEventListeners();
    return;
  }

  const readResult = readPersistedState();
  if (!readResult.ok) {
    dispatch({
      currentState: 'error_storage_unavailable',
      tasks: [],
      runningTaskId: null,
      error: readResult.error,
    });
    bindEventListeners();
    return;
  }

  const rawStorage = readResult.raw;

  if (rawStorage === null) {
    const hydrateResult = hydrateTasks({ now: Date.now(), rawStorage: null });
    dispatch({
      currentState: 'idle',
      tasks: hydrateResult.tasks,
      runningTaskId: hydrateResult.runningTaskId,
      error: null,
    });
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
      dispatch({
        currentState: 'error_schema_mismatch',
        tasks: [],
        runningTaskId: null,
        error: {
          kind: 'SchemaVersionMismatch',
          message: schemaMismatchResult.promptMessage,
        },
      });
    } else {
      const corruptResult = stashCorruptAndPrompt({
        now: Date.now(),
        rawStorage,
      });
      dispatch({
        currentState: 'error_corrupt',
        tasks: [],
        runningTaskId: null,
        error: {
          kind: 'CorruptStorageData',
          message: corruptResult.promptMessage,
        },
      });
    }
    bindEventListeners();
    return;
  }

  const tasksWithOpen = parseResult.state.tasks.filter(
    (t) => t.sessions.some((s) => s.endedAt === null),
  );

  let hydrateResult;
  if (tasksWithOpen.length === 0) {
    hydrateResult = hydrateTasks({ now: Date.now(), rawStorage });
    dispatch({
      currentState: 'idle',
      tasks: hydrateResult.tasks,
      runningTaskId: hydrateResult.runningTaskId,
      error: null,
    });
  } else if (tasksWithOpen.length === 1) {
    hydrateResult = resumeOpenSession({ now: Date.now(), rawStorage });
    const taskWithOpen = tasksWithOpen[0];
    const paused = isPaused(taskWithOpen);
    dispatch({
      currentState: paused ? 'idle_paused' : 'idle_running',
      tasks: hydrateResult.tasks,
      runningTaskId: hydrateResult.runningTaskId,
      error: null,
    });
    startTickInterval();
  } else {
    hydrateResult = reconcileMultipleOpenSessions({
      now: Date.now(),
      rawStorage,
    });
    dispatch({
      currentState: 'idle_running',
      tasks: hydrateResult.tasks,
      runningTaskId: hydrateResult.runningTaskId,
      error: null,
    });
    startTickInterval();
  }

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

  const taskListContainer = document.getElementById(DOM_IDS.TASK_LIST);
  const fullscreenContainer = document.getElementById(DOM_IDS.FULLSCREEN_OVERLAY);

  if (state.fullscreenTaskId && fullscreenContainer) {
    const view = views.find(v => v.id === state.fullscreenTaskId);
    if (view) {
      renderFullscreen(fullscreenContainer, view);
      fullscreenContainer.hidden = false;
    } else {
      dispatch({ fullscreenTaskId: null });
    }
  } else if (fullscreenContainer) {
    fullscreenContainer.hidden = true;
    fullscreenContainer.innerHTML = '';
  }

  if (taskListContainer) {
    const currentRows = Array.from(taskListContainer.children).filter(el =>
      el.classList.contains('task-card'),
    ) as HTMLElement[];

    const isStructureSame =
      currentRows.length === views.length &&
      currentRows.every((row, i) => row.dataset.taskId === views[i].id);

    if (isStructureSame) {
      for (let i = 0; i < views.length; i++) {
        updateTaskRow(currentRows[i], views[i]);
      }
    } else {
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
  }

  const errorBanner = document.getElementById(DOM_IDS.ERROR_BANNER);
  const errorMessage = document.getElementById(DOM_IDS.ERROR_MESSAGE);
  if (state.error !== null) {
    if (errorBanner) errorBanner.hidden = false;
    if (errorMessage) errorMessage.textContent = state.error.message;
  } else {
    if (errorBanner) errorBanner.hidden = true;
  }

  const addTaskSubmit = document.getElementById(DOM_IDS.ADD_TASK_BTN);
  if (addTaskSubmit && addTaskSubmit instanceof HTMLButtonElement) {
    addTaskSubmit.disabled =
      state.currentState === 'error_validation' ||
      state.currentState === 'error_storage_write';
  }

  checkScheduledTasks(now);
}

export function updateTaskRow(row: HTMLElement, view: TaskView): void {
  const task = appState.tasks.find((t) => t.id === view.id);

  // Update classes
  row.className = 'task-card';
  if (view.isRunning && !view.isPaused) row.classList.add('running');
  if (view.isPaused) row.classList.add('paused');
  if (view.isCountdown) row.classList.add('countdown');
  if (view.isExpired) row.classList.add('expired');

  // Update progress for countdown
  if (view.isCountdown && view.remainingMs !== null && task?.countdownDurationMs) {
    const progress = Math.max(0, Math.min(100, (view.remainingMs / task.countdownDurationMs) * 100));
    row.style.setProperty('--progress', `${progress}%`);
  } else {
    row.style.removeProperty('--progress');
  }

  // Update text content
  const nameEl = row.querySelector('.task-name');
  if (nameEl) nameEl.textContent = view.name;

  const metaEl = row.querySelector('.task-meta');
  if (metaEl) {
    if (view.isCountdown) {
      metaEl.textContent = view.isExpired ? "Time's up!" : 'Countdown';
    } else if (view.isPaused) {
      metaEl.textContent = 'Paused';
    } else if (view.isRunning) {
      metaEl.textContent = 'Running';
    } else {
      metaEl.textContent = '';
    }
  }

  const timerEl = row.querySelector('.task-timer');
  if (timerEl) timerEl.textContent = view.formattedTotal;

  // Update actions only if state type changed
  const actionsEl = row.querySelector('.task-actions');
  if (actionsEl) {
    const hasResume = actionsEl.querySelector('.resume') !== null;
    const hasPause = actionsEl.querySelector('.pause') !== null;
    const hasStart = actionsEl.querySelector('.start') !== null;
    const hasExpand = actionsEl.querySelector('.expand') !== null;

    let needsRebuild = false;
    if (view.isPaused && !hasResume) needsRebuild = true;
    if (view.isRunning && !view.isPaused && !hasPause) needsRebuild = true;
    if (!view.isRunning && !hasStart) needsRebuild = true;
    if (!hasExpand) needsRebuild = true;

    if (needsRebuild) {
      actionsEl.innerHTML = '';
      if (view.isPaused) {
        const resumeBtn = document.createElement('button');
        resumeBtn.className = 'action-btn resume';
        resumeBtn.textContent = 'Resume';
        resumeBtn.title = 'Shortcut: Space';
        resumeBtn.type = 'button';
        resumeBtn.addEventListener('click', () => handleResumeTimer(view.id));

        const stopBtn = document.createElement('button');
        stopBtn.className = 'action-btn stop';
        stopBtn.textContent = 'Stop';
        stopBtn.type = 'button';
        stopBtn.addEventListener('click', () => handleStopTimer(view.id));

        actionsEl.appendChild(resumeBtn);
        actionsEl.appendChild(stopBtn);
      } else if (view.isRunning) {
        const pauseBtn = document.createElement('button');
        pauseBtn.className = 'action-btn pause';
        pauseBtn.textContent = 'Pause';
        pauseBtn.title = 'Shortcut: Space';
        pauseBtn.type = 'button';
        pauseBtn.addEventListener('click', () => handlePauseTimer(view.id));

        const stopBtn = document.createElement('button');
        stopBtn.className = 'action-btn stop';
        stopBtn.textContent = 'Stop';
        stopBtn.type = 'button';
        stopBtn.addEventListener('click', () => handleStopTimer(view.id));

        actionsEl.appendChild(pauseBtn);
        actionsEl.appendChild(stopBtn);
      } else {
        const startBtn = document.createElement('button');
        startBtn.className = 'action-btn start';
        startBtn.textContent = 'Start';
        startBtn.title = 'Shortcut: Space';
        startBtn.type = 'button';
        startBtn.addEventListener('click', () => handleStartTimer(view.id));
        actionsEl.appendChild(startBtn);
      }

      const expandBtn = document.createElement('button');
      expandBtn.className = 'action-btn expand';
      expandBtn.textContent = '⛶';
      expandBtn.title = 'Full Screen (Shortcut: F)';
      expandBtn.type = 'button';
      expandBtn.addEventListener('click', () => handleToggleFullscreen(view.id));
      actionsEl.appendChild(expandBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'action-btn delete';
      deleteBtn.textContent = '\u00d7';
      deleteBtn.type = 'button';
      deleteBtn.addEventListener('click', () => handleDeleteTask(view.id));
      actionsEl.appendChild(deleteBtn);
    }
  }
}

export function renderTaskRow(view: TaskView): HTMLElement {
  const row = document.createElement('li');
  row.dataset.taskId = view.id;

  const info = document.createElement('div');
  info.className = 'task-info';
  const name = document.createElement('div');
  name.className = 'task-name';
  const meta = document.createElement('div');
  meta.className = 'task-meta';
  info.appendChild(name);
  info.appendChild(meta);

  const timer = document.createElement('div');
  timer.className = 'task-timer';

  const actions = document.createElement('div');
  actions.className = 'task-actions';

  row.appendChild(info);
  row.appendChild(timer);
  row.appendChild(actions);

  updateTaskRow(row, view);

  return row;
}

export function handleCreateTask(nameInput: string): void {
  const validationResult = TaskNameSchema.safeParse(nameInput.trim());
  if (!validationResult.success) {
    const error = rejectInvalidName({ name: nameInput });
    dispatch({
      currentState: 'error_validation',
      error,
    });
    return;
  }

  const hoursEl = document.getElementById(DOM_IDS.CD_HOURS) as HTMLInputElement | null;
  const minsEl = document.getElementById(DOM_IDS.CD_MINUTES) as HTMLInputElement | null;
  const secsEl = document.getElementById(DOM_IDS.CD_SECONDS) as HTMLInputElement | null;
  const endEl = document.getElementById(DOM_IDS.SCHEDULED_END) as HTMLInputElement | null;

  let countdownDurationMs: number | null = null;
  if (selectedMode === 'countdown') {
    const h = parseInt(hoursEl?.value || '0', 10) || 0;
    const m = parseInt(minsEl?.value || '0', 10) || 0;
    const s = parseInt(secsEl?.value || '0', 10) || 0;
    countdownDurationMs = ((h * 3600) + (m * 60) + s) * 1000;
    if (countdownDurationMs <= 0) countdownDurationMs = 5 * 60 * 1000;
  }

  let scheduledEndAt: number | null = null;
  if (endEl?.value) {
    const [hours, minutes] = endEl.value.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    if (date.getTime() <= Date.now()) {
      date.setDate(date.getDate() + 1);
    }
    scheduledEndAt = date.getTime();
  }

  try {
    const newTask = createTask({ name: nameInput }, appState.tasks);
    const taskWithOptions: Task = {
      ...newTask,
      timerMode: selectedMode,
      countdownDurationMs,
      scheduledStartAt: null,
      scheduledEndAt,
    };

    dispatch({
      currentState: appState.currentState === 'idle_running' || appState.currentState === 'idle_paused'
        ? appState.currentState : 'idle',
      tasks: [taskWithOptions, ...appState.tasks.filter(t => t.id !== newTask.id)],
      error: null,
    });

    const inputEl = document.getElementById(DOM_IDS.TASK_NAME_INPUT);
    if (inputEl && inputEl instanceof HTMLInputElement) inputEl.value = '';
    if (endEl) endEl.value = '';
  } catch (err) {
    const error = reportStorageWriteFailure({ name: nameInput }, err);
    dispatch({
      currentState: 'error_storage_write',
      error,
    });
  }
}

export function handleStartTimer(taskId: string): void {
  const now = Date.now();

  if (
    appState.currentState === 'idle_running' &&
    taskId === appState.runningTaskId
  ) {
    ignoreAlreadyRunning({ taskId, now }, appState.tasks);
    dispatch({}); // Re-render anyway to ensure sync
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

    dispatch({
      currentState: 'idle_running',
      tasks: appState.tasks.map((t) => (t.id === taskId ? updatedTask : t)),
      runningTaskId: taskId,
      error: null,
    });

    startTickInterval();
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'kind' in err &&
      err.kind === 'TaskNotFound'
    ) {
      const error = reportTaskNotFound({ taskId, now });
      dispatch({
        currentState: 'error_task_not_found',
        error,
      });
    } else {
      const error = retryOrRevertStart(
        { taskId, now },
        appState.tasks,
        err,
      );
      dispatch({
        currentState: 'error_storage_write',
        error,
      });
    }
  }
}

export function handlePauseTimer(taskId: string): void {
  const now = Date.now();
  try {
    const updatedTask = pauseSessionOnTask({ taskId, now }, appState.tasks);
    dispatch({
      currentState: 'idle_paused',
      tasks: appState.tasks.map(t => t.id === taskId ? updatedTask : t),
      error: null,
    });
  } catch (err) {
    const error = retryOrKeepOpen({ taskId, now }, appState.tasks, err);
    dispatch({ currentState: 'error_storage_write', error });
  }
}

export function handleResumeTimer(taskId: string): void {
  const now = Date.now();
  try {
    const updatedTask = resumeSessionOnTask({ taskId, now }, appState.tasks);
    dispatch({
      currentState: 'idle_running',
      tasks: appState.tasks.map(t => t.id === taskId ? updatedTask : t),
      error: null,
    });
    startTickInterval();
  } catch (err) {
    const error = retryOrKeepOpen({ taskId, now }, appState.tasks, err);
    dispatch({ currentState: 'error_storage_write', error });
  }
}

export function handleStopTimer(taskId: string): void {
  const now = Date.now();

  const task = appState.tasks.find((t) => t.id === taskId);
  const openSession = task ? getOpenSession(task) : undefined;

  if (!openSession) {
    const error = reconcileNoOpenSession({ taskId, now }, appState.tasks);
    dispatch({
      currentState: 'idle_running',
      error,
    });
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

    dispatch({
      currentState: 'idle',
      tasks: updatedTasks,
      runningTaskId: null,
      error: null,
    });

    clearTickInterval();
  } catch (err) {
    const error = retryOrKeepOpen(
      { taskId, now },
      appState.tasks,
      err,
    );
    dispatch({
      currentState: 'error_storage_write',
      error,
    });
  }
}

export function handleDeleteTask(taskId: string): void {
  const confirmed = window.confirm('Delete this task?');

  if (!confirmed) {
    abortDeleteSilently({ taskId, confirmed: false });
    dispatch({});
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

    dispatch({
      currentState: wasRunning ? 'idle' : appState.currentState,
      tasks: updatedTasks,
      runningTaskId: wasRunning ? null : appState.runningTaskId,
      error: null,
    });

    if (wasRunning) {
      clearTickInterval();
    }
  } catch (err) {
    const error = retryOrRestoreDelete(
      { taskId, confirmed: true },
      appState.tasks,
      err,
    );
    dispatch({
      currentState: 'error_storage_write',
      error,
    });
  }
}

function checkScheduledTasks(now: number): void {
  for (const task of appState.tasks) {
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
  const form = document.getElementById(DOM_IDS.CREATE_TASK_FORM);
  if (form && form instanceof HTMLFormElement) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const inputEl = document.getElementById(DOM_IDS.TASK_NAME_INPUT);
      if (inputEl && inputEl instanceof HTMLInputElement) {
        handleCreateTask(inputEl.value);
      }
    });
  }

  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach(btn => {
    const mode = (btn as HTMLElement).dataset.mode as TimerMode;
    if (mode === selectedMode) {
      btn.classList.add('active');
      const cdSettings = document.getElementById(DOM_IDS.COUNTDOWN_SETTINGS);
      if (cdSettings) cdSettings.hidden = mode !== 'countdown';
    } else {
      btn.classList.remove('active');
    }

    btn.addEventListener('click', () => {
      selectedMode = mode;
      localStorage.setItem(STORAGE_KEYS.SELECTED_MODE, mode);
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cdSettings = document.getElementById(DOM_IDS.COUNTDOWN_SETTINGS);
      if (cdSettings) cdSettings.hidden = mode !== 'countdown';
    });
  });

  const dismissBtn = document.getElementById(DOM_IDS.DISMISS_ERROR_BTN);
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      dispatch({
        currentState: 'idle',
        error: null,
      });
    });
  }

  const resetBtn = document.getElementById(DOM_IDS.RESET_STORAGE_BTN);
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      dispatch({
        currentState: 'idle',
        tasks: [],
        runningTaskId: null,
        error: null,
      });
    });
  }

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === 'n') {
      e.preventDefault();
      const input = document.getElementById(DOM_IDS.TASK_NAME_INPUT);
      input?.focus();
    }

    if (e.key === ' ') {
      e.preventDefault();
      if (appState.runningTaskId) {
        if (appState.currentState === 'idle_running') {
          handlePauseTimer(appState.runningTaskId);
        } else if (appState.currentState === 'idle_paused') {
          handleResumeTimer(appState.runningTaskId);
        }
      } else if (appState.tasks.length > 0) {
        handleStartTimer(appState.tasks[0].id);
      }
    }

    if (e.key === 'f') {
      e.preventDefault();
      if (appState.fullscreenTaskId) {
        handleToggleFullscreen(null);
      } else if (appState.runningTaskId) {
        handleToggleFullscreen(appState.runningTaskId);
      } else if (appState.tasks.length > 0) {
        handleToggleFullscreen(appState.tasks[0].id);
      }
    }

    if (e.key === 'Escape') {
      if (appState.fullscreenTaskId) {
        handleToggleFullscreen(null);
      }
    }
  });
}


export function renderFullscreen(container: HTMLElement, view: TaskView): void {
  if (container.dataset.renderedTaskId !== view.id) {
    container.innerHTML = '';
    container.dataset.renderedTaskId = view.id;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => handleToggleFullscreen(null));
    container.appendChild(closeBtn);

    const name = document.createElement('div');
    name.className = 'task-name';
    name.textContent = view.name;
    container.appendChild(name);

    const timer = document.createElement('div');
    timer.className = 'task-timer';
    container.appendChild(timer);

    const actions = document.createElement('div');
    actions.className = 'task-actions';
    container.appendChild(actions);
  }

  const timer = container.querySelector('.task-timer');
  if (timer) timer.textContent = view.formattedTotal;

  const actionsEl = container.querySelector('.task-actions');
  if (actionsEl instanceof HTMLElement) {
    const stateKey = `${view.isRunning}-${view.isPaused}`;
    if (actionsEl.dataset.stateKey !== stateKey) {
      actionsEl.innerHTML = '';
      actionsEl.dataset.stateKey = stateKey;

      if (view.isPaused) {
        const resumeBtn = document.createElement('button');
        resumeBtn.className = 'action-btn resume';
        resumeBtn.textContent = 'Resume';
        resumeBtn.addEventListener('click', () => handleResumeTimer(view.id));
        actionsEl.appendChild(resumeBtn);
      } else if (view.isRunning) {
        const pauseBtn = document.createElement('button');
        pauseBtn.className = 'action-btn pause';
        pauseBtn.textContent = 'Pause';
        pauseBtn.addEventListener('click', () => handlePauseTimer(view.id));
        actionsEl.appendChild(pauseBtn);
      } else {
        const startBtn = document.createElement('button');
        startBtn.className = 'action-btn start';
        startBtn.textContent = 'Start';
        startBtn.addEventListener('click', () => handleStartTimer(view.id));
        actionsEl.appendChild(startBtn);
      }
      
      const stopBtn = document.createElement('button');
      stopBtn.className = 'action-btn stop';
      stopBtn.textContent = 'Stop';
      stopBtn.addEventListener('click', () => handleStopTimer(view.id));
      actionsEl.appendChild(stopBtn);
    }
  }
}

export function handleToggleFullscreen(taskId: string | null): void {
  dispatch({ fullscreenTaskId: taskId });
}
