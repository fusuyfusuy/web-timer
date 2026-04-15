import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recomputeTotals, recomputeTotalsWithOpen } from '../../src/services/tickService';
import type { Task } from '../../src/types/task';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

const tasks: Task[] = [
  { id: 'a', name: 'A', createdAt: 1, sessions: [{ startedAt: 1000, endedAt: 2000 }] },
  { id: 'b', name: 'B', createdAt: 2, sessions: [{ startedAt: 3000, endedAt: null }] },
];

describe('recomputeTotals — TICK (idle → idle)', () => {
  it('happy path: produces TaskView[] with isRunning=false', () => {
    const closedOnly: Task[] = [
      { id: 'a', name: 'A', createdAt: 1, sessions: [{ startedAt: 0, endedAt: 1000 }] },
    ];
    const r = recomputeTotals({ now: 5000 }, closedOnly);
    expect(r.runningTaskId).toBeNull();
    expect(r.views[0].isRunning).toBe(false);
    expect(r.views[0].totalMs).toBe(1000);
    expect(r.views[0].formattedTotal).toBe('00:00:01');
  });

  it('error path: empty task list returns empty views', () => {
    const r = recomputeTotals({ now: 5000 }, []);
    expect(r.views).toEqual([]);
  });
});

describe('recomputeTotalsWithOpen — TICK (idle_running → idle_running)', () => {
  it('happy path: marks runningTaskId view as running, includes live delta', () => {
    const r = recomputeTotalsWithOpen({ now: 4000 }, tasks, 'b');
    expect(r.runningTaskId).toBe('b');
    const running = r.views.find((v) => v.id === 'b');
    expect(running?.isRunning).toBe(true);
    expect(running?.totalMs).toBe(1000);
  });

  it('error path: sorted newest-first by createdAt', () => {
    const r = recomputeTotalsWithOpen({ now: 4000 }, tasks, 'b');
    expect(r.views.map((v) => v.id)).toEqual(['b', 'a']);
  });
});
