import type { Task, TaskView } from '../types/task';
import type { TickInput, TickResult } from '../types/inputs';
import { computeTaskTotalMs, computeCountdownRemainingMs, formatHHMMSS, isPaused } from '../lib/time';

function buildView(task: Task, now: number, runningTaskId: string | null): TaskView {
  const totalMs = computeTaskTotalMs(task, now);
  const isCountdown = task.timerMode === 'countdown';
  const remainingMs = isCountdown ? computeCountdownRemainingMs(task, now) : null;
  const isRunning = task.id === runningTaskId;

  return {
    id: task.id,
    name: task.name,
    createdAt: task.createdAt,
    isRunning,
    isPaused: isRunning && isPaused(task),
    isCountdown,
    isExpired: isCountdown && remainingMs === 0 && totalMs > 0,
    totalMs,
    remainingMs,
    formattedTotal: isCountdown ? formatHHMMSS(remainingMs!) : formatHHMMSS(totalMs),
  };
}

export function recomputeTotals(input: TickInput, tasks: Task[]): TickResult {
  const views = tasks.map(t => buildView(t, input.now, null));
  views.sort((a, b) => b.createdAt - a.createdAt);
  return { views, runningTaskId: null };
}

export function recomputeTotalsWithOpen(
  input: TickInput,
  tasks: Task[],
  runningTaskId: string,
): TickResult {
  const views = tasks.map(t => buildView(t, input.now, runningTaskId));
  views.sort((a, b) => b.createdAt - a.createdAt);
  return { views, runningTaskId };
}
