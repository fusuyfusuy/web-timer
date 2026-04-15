// tickService — recompute per-task view totals on each 1Hz tick.
// Covers statechart actions: recomputeTotals, recomputeTotalsWithOpen.
import type { Task, TaskView } from '../types/task';
import type { TickInput, TickResult } from '../types/inputs';
import { computeTaskTotalMs, formatHHMMSS } from '../lib/time';

export function recomputeTotals(input: TickInput, tasks: Task[]): TickResult {
  const views: TaskView[] = tasks.map(task => {
    const totalMs = computeTaskTotalMs(task, input.now);
    const formattedTotal = formatHHMMSS(totalMs);
    return {
      id: task.id,
      name: task.name,
      createdAt: task.createdAt,
      isRunning: false,
      totalMs,
      formattedTotal,
    };
  });

  views.sort((a, b) => b.createdAt - a.createdAt);

  return { views, runningTaskId: null };
}

export function recomputeTotalsWithOpen(
  input: TickInput,
  tasks: Task[],
  runningTaskId: string,
): TickResult {
  const views: TaskView[] = tasks.map(task => {
    const totalMs = computeTaskTotalMs(task, input.now);
    const formattedTotal = formatHHMMSS(totalMs);
    return {
      id: task.id,
      name: task.name,
      createdAt: task.createdAt,
      isRunning: task.id === runningTaskId,
      totalMs,
      formattedTotal,
    };
  });

  views.sort((a, b) => b.createdAt - a.createdAt);

  return { views, runningTaskId };
}
