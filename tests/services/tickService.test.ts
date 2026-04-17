import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recomputeViews } from '../../src/services/tickService';
import type { Task } from '../../src/types/task';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

const tasks: Task[] = [
  { id: 'a', name: 'A', createdAt: 1, sessions: [{ startedAt: 1000, endedAt: 2000, pauses: [] }], timerMode: 'countup', countdownDurationMs: null, scheduledStartAt: null, scheduledEndAt: null },
  { id: 'b', name: 'B', createdAt: 2, sessions: [{ startedAt: 3000, endedAt: null, pauses: [] }], timerMode: 'countup', countdownDurationMs: null, scheduledStartAt: null, scheduledEndAt: null },
];

describe('recomputeViews — TICK', () => {
  it('happy path: marks tasks with open sessions as running', () => {
    const r = recomputeViews({ now: 4000 }, tasks);
    expect(r.hasActive).toBe(true);
    const viewA = r.views.find(v => v.id === 'a')!;
    const viewB = r.views.find(v => v.id === 'b')!;
    expect(viewA.isRunning).toBe(false);
    expect(viewB.isRunning).toBe(true);
    expect(viewB.totalMs).toBe(1000);
  });

  it('happy path: detects multiple active timers', () => {
    const bothActive: Task[] = [
      { id: '1', name: '1', createdAt: 1, sessions: [{ startedAt: 0, endedAt: null, pauses: [] }], timerMode: 'countup', countdownDurationMs: null, scheduledStartAt: null, scheduledEndAt: null },
      { id: '2', name: '2', createdAt: 2, sessions: [{ startedAt: 0, endedAt: null, pauses: [] }], timerMode: 'countup', countdownDurationMs: null, scheduledStartAt: null, scheduledEndAt: null },
    ];
    const r = recomputeViews({ now: 1000 }, bothActive);
    expect(r.hasActive).toBe(true);
    expect(r.views[0].isRunning).toBe(true);
    expect(r.views[1].isRunning).toBe(true);
  });

  it('happy path: sorted newest-first by createdAt', () => {
    const r = recomputeViews({ now: 4000 }, tasks);
    expect(r.views.map((v) => v.id)).toEqual(['b', 'a']);
  });
});
