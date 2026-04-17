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
  stashCorruptAndPrompt,
  startMemoryOnly,
  promptMigrationReset,
} from '../services/bootService';
import {
  createTask,
  rejectInvalidName,
  reportStorageWriteFailure,
  retryOrRestoreDelete,
  discardOpenAndDelete,
} from '../services/taskService';
import {
  startSessionOnTask,
  stopSessionOnTask,
  clampNegativeAndClose,
  reportTaskNotFound,
  retryOrRevertStart,
  retryOrKeepOpen,
  reconcileNoOpenSession,
  pauseSessionOnTask,
  resumeSessionOnTask,
} from '../services/timerService';
import { recomputeViews } from '../services/tickService';
import { getOpenSession } from '../lib/time';

import { DOM_IDS, STORAGE_KEYS } from './constants';

export interface AppState {
  currentState: StateName;
  tasks: Task[];
  fullscreenTaskId: string | null;
  deletingTaskId: string | null;
  error: AppError | null;
}

let appState: AppState = {
  currentState: 'booting',
  tasks: [],
  fullscreenTaskId: null,
  deletingTaskId: null,
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
        error: {
          kind: 'CorruptStorageData',
          message: corruptResult.promptMessage,
        },
      });
    }
    bindEventListeners();
    return;
  }

  const hydrateResult = hydrateTasks({ now: Date.now(), rawStorage });
  dispatch({
    currentState: 'idle',
    tasks: hydrateResult.tasks,
    error: null,
  });

  if (hydrateResult.hasActive) {
    startTickInterval();
  }

  bindEventListeners();
}

export function renderApp(state: AppState): void {
  const now = Date.now();
  const tickResult = recomputeViews({ now }, state.tasks);
  const views = tickResult.views;

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
  const validationError = document.getElementById(DOM_IDS.VALIDATION_ERROR);
  const taskInput = document.getElementById(DOM_IDS.TASK_NAME_INPUT);

  const isValidationError = state.currentState === 'error_validation';

  if (state.error !== null && !isValidationError) {
    if (errorBanner) errorBanner.hidden = false;
    if (errorMessage) errorMessage.textContent = state.error.message;
  } else {
    if (errorBanner) errorBanner.hidden = true;
  }

  if (validationError && taskInput) {
    if (isValidationError && state.error) {
      validationError.textContent = state.error.message;
      validationError.hidden = false;
      taskInput.classList.add('error');
    } else {
      validationError.hidden = true;
      validationError.textContent = '';
      taskInput.classList.remove('error');
    }
  }

  const addTaskSubmit = document.getElementById(DOM_IDS.ADD_TASK_BTN);
  if (addTaskSubmit && addTaskSubmit instanceof HTMLButtonElement) {
    addTaskSubmit.disabled =
      state.currentState === 'error_validation' ||
      state.currentState === 'error_storage_write';
  }

  checkScheduledTasks(now);

  if (tickResult.hasActive) {
    startTickInterval();
  } else if (!state.tasks.some(t => t.sessions.some(s => s.endedAt === null))) {
    // Only clear if absolutely NO open sessions
    // Actually hasActive from recomputeViews is authoritative for "isRunning"
    clearTickInterval();
  }
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

  // Update actions
  const actionsEl = row.querySelector('.task-actions');
  if (actionsEl) {
    const hasResume = actionsEl.querySelector('.resume') !== null;
    const hasPause = actionsEl.querySelector('.pause') !== null;
    const hasStart = actionsEl.querySelector('.start') !== null;
    const hasExpand = actionsEl.querySelector('.expand') !== null;
    const isConfirmingElement = actionsEl.querySelector('.delete.confirming') !== null;
    const shouldBeConfirming = appState.deletingTaskId === view.id;

    let needsRebuild = false;
    if (view.isPaused && !hasResume) needsRebuild = true;
    if (view.isRunning && !view.isPaused && !hasPause) needsRebuild = true;
    if (!view.isRunning && !hasStart) needsRebuild = true;
    if (!hasExpand) needsRebuild = true;
    if (isConfirmingElement !== shouldBeConfirming) needsRebuild = true;

    if (needsRebuild) {
      actionsEl.innerHTML = '';
      if (view.isPaused) {
        const resumeBtn = document.createElement('button');
        resumeBtn.className = 'action-btn resume';
        resumeBtn.textContent = 'Resume';
        resumeBtn.title = 'Shortcut: Space';
        resumeBtn.type = 'button';
        resumeBtn.addEventListener('click', () => handleResumeTimer(view.id));
        actionsEl.appendChild(resumeBtn);

        const stopBtn = document.createElement('button');
        stopBtn.className = 'action-btn stop';
        stopBtn.textContent = 'Stop';
        stopBtn.type = 'button';
        stopBtn.addEventListener('click', () => handleStopTimer(view.id));
        actionsEl.appendChild(stopBtn);
      } else if (view.isRunning) {
        const pauseBtn = document.createElement('button');
        pauseBtn.className = 'action-btn pause';
        pauseBtn.textContent = 'Pause';
        pauseBtn.title = 'Shortcut: Space';
        pauseBtn.type = 'button';
        pauseBtn.addEventListener('click', () => handlePauseTimer(view.id));
        actionsEl.appendChild(pauseBtn);

        const stopBtn = document.createElement('button');
        stopBtn.className = 'action-btn stop';
        stopBtn.textContent = 'Stop';
        stopBtn.type = 'button';
        stopBtn.addEventListener('click', () => handleStopTimer(view.id));
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
      const isConfirming = appState.deletingTaskId === view.id;
      deleteBtn.className = `action-btn delete${isConfirming ? ' confirming' : ''}`;
      deleteBtn.textContent = isConfirming ? 'Confirm?' : '\u00d7';
      deleteBtn.type = 'button';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeleteTask(view.id);
      });
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
  let scheduledEndAt: number | null = null;

  if (selectedMode === 'countdown') {
    if (endEl?.value) {
      const [hours, minutes] = endEl.value.split(':').map(Number);
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      if (date.getTime() <= Date.now()) {
        date.setDate(date.getDate() + 1);
      }
      scheduledEndAt = date.getTime();
      countdownDurationMs = scheduledEndAt - Date.now();
    } else {
      const h = parseInt(hoursEl?.value || '0', 10) || 0;
      const m = parseInt(minsEl?.value || '0', 10) || 0;
      const s = parseInt(secsEl?.value || '0', 10) || 0;
      countdownDurationMs = (h * 3600 + m * 60 + s) * 1000;
      if (countdownDurationMs <= 0) countdownDurationMs = 5 * 60 * 1000;
    }
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
  try {
    const updatedTasks = startSessionOnTask({ taskId, now }, appState.tasks);
    dispatch({
      tasks: updatedTasks,
      error: null,
    });
    startTickInterval();
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'kind' in err && err.kind === 'TaskNotFound') {
      const error = reportTaskNotFound({ taskId, now });
      dispatch({ currentState: 'error_task_not_found', error });
    } else {
      const error = retryOrRevertStart({ taskId, now }, appState.tasks, err);
      dispatch({ currentState: 'error_storage_write', error });
    }
  }
}

export function handlePauseTimer(taskId: string): void {
  const now = Date.now();
  try {
    const updatedTasks = pauseSessionOnTask({ taskId, now }, appState.tasks);
    dispatch({
      tasks: updatedTasks,
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
    const updatedTasks = resumeSessionOnTask({ taskId, now }, appState.tasks);
    dispatch({
      tasks: updatedTasks,
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
    dispatch({ error });
    return;
  }

  try {
    let updatedTasks: Task[];
    if (now < openSession.startedAt) {
      updatedTasks = clampNegativeAndClose({ taskId, now }, appState.tasks);
    } else {
      updatedTasks = stopSessionOnTask({ taskId, now }, appState.tasks);
    }

    dispatch({
      tasks: updatedTasks,
      error: null,
    });
  } catch (err) {
    const error = retryOrKeepOpen({ taskId, now }, appState.tasks, err);
    dispatch({ currentState: 'error_storage_write', error });
  }
}

export function handleDeleteTask(taskId: string): void {
  const isConfirming = appState.deletingTaskId === taskId;

  if (!isConfirming) {
    dispatch({ deletingTaskId: taskId });
    setTimeout(() => {
      if (appState.deletingTaskId === taskId) {
        dispatch({ deletingTaskId: null });
      }
    }, 3000);
    return;
  }

  try {
    discardOpenAndDelete({ taskId, confirmed: true }, appState.tasks);
    const updatedTasks = appState.tasks.filter((t) => t.id !== taskId);
    dispatch({
      tasks: updatedTasks,
      deletingTaskId: null,
      error: null,
    });
  } catch (err) {
    const error = retryOrRestoreDelete({ taskId, confirmed: true }, appState.tasks, err);
    dispatch({ currentState: 'error_storage_write', error, deletingTaskId: null });
  }
}

function checkScheduledTasks(now: number): void {
  for (const task of appState.tasks) {
    if (task.scheduledEndAt && task.scheduledEndAt <= now) {
      const open = getOpenSession(task);
      if (open) {
        task.scheduledEndAt = null;
        handleStopTimer(task.id);
        return;
      }
    }
  }
}

function startTickInterval(): void {
  if (tickIntervalId === null) {
    tickIntervalId = window.setInterval(() => {
      renderApp(appState);
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
    const inputEl = document.getElementById(DOM_IDS.TASK_NAME_INPUT);
    if (inputEl && inputEl instanceof HTMLInputElement) {
      inputEl.addEventListener('input', () => {
        if (appState.currentState === 'error_validation') {
          dispatch({ currentState: 'idle', error: null });
        }
      });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
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

    if (e.key === 'f') {
      e.preventDefault();
      if (appState.fullscreenTaskId) {
        handleToggleFullscreen(null);
      } else if (appState.tasks.length > 0) {
        // Toggle fullscreen for the first task if nothing is running, or first running task
        const running = appState.tasks.find(t => t.sessions.some(s => s.endedAt === null));
        handleToggleFullscreen(running ? running.id : appState.tasks[0].id);
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
