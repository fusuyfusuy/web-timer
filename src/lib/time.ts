// Duration math and display formatting utilities.
import type { Task } from '../types/task';

export function computeTaskTotalMs(task: Task, now: number): number {
  let total = 0;
  for (const session of task.sessions) {
    if (session.endedAt !== null) {
      total += session.endedAt - session.startedAt;
    } else {
      const openDuration = now - session.startedAt;
      total += Math.max(0, openDuration);
    }
  }
  return total;
}

export function formatHHMMSS(ms: number): string {
  const clamped = Math.max(0, ms);
  const seconds = Math.floor(clamped / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function hasOpenSession(task: Task): boolean {
  return task.sessions.some(s => s.endedAt === null);
}

export function getOpenSession(task: Task): import('../types/session').Session | undefined {
  return task.sessions.find(s => s.endedAt === null);
}
