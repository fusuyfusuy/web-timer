import type { Task, TaskView } from '../types/task';
import type { TickInput, TickResult } from '../types/inputs';
import { computeTaskTotalMs, computeCountdownRemainingMs, formatHHMMSS, isPaused, hasOpenSession } from '../lib/time';

function buildView(task: Task, now: number): TaskView {
  const totalMs = computeTaskTotalMs(task, now);
  const isCountdown = task.timerMode === 'countdown';
  const remainingMs = isCountdown ? computeCountdownRemainingMs(task, now) : null;
  const isRunning = hasOpenSession(task);

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

export function recomputeViews(input: TickInput, tasks: Task[]): TickResult {
  const views = tasks.map(t => buildView(t, input.now));
  views.sort((a, b) => b.createdAt - a.createdAt);
  const hasActive = views.some(v => v.isRunning);
  return { views, hasActive };
}
