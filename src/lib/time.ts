import type { Task } from '../types/task';
import type { PauseInterval, Session } from '../types/session';

export function computePausedDurationMs(pauses: PauseInterval[], referenceTime: number): number {
  let total = 0;
  for (const p of pauses) {
    const end = p.resumedAt ?? referenceTime;
    total += end - p.pausedAt;
  }
  return total;
}

export function computeSessionActiveMs(session: Session, now: number): number {
  const end = session.endedAt ?? now;
  const elapsed = end - session.startedAt;
  const paused = computePausedDurationMs(session.pauses ?? [], end);
  return Math.max(0, elapsed - paused);
}

export function computeTaskTotalMs(task: Task, now: number): number {
  let total = 0;
  for (const session of task.sessions) {
    total += computeSessionActiveMs(session, now);
  }
  return total;
}

export function computeCountdownRemainingMs(task: Task, now: number): number {
  const elapsed = computeTaskTotalMs(task, now);
  return Math.max(0, (task.countdownDurationMs ?? 0) - elapsed);
}

export function isPaused(task: Task): boolean {
  const open = task.sessions.find(s => s.endedAt === null);
  if (!open) return false;
  const pauses = open.pauses ?? [];
  return pauses.length > 0 && pauses[pauses.length - 1].resumedAt === null;
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
