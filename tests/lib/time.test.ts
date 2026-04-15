import { describe, it, expect } from 'vitest';
import { computeTaskTotalMs, formatHHMMSS, hasOpenSession, getOpenSession } from '../../src/lib/time';
import type { Task } from '../../src/types/task';

const baseTask = (sessions: Task['sessions']): Task => ({
  id: 't1',
  name: 'Task 1',
  createdAt: 1_000_000,
  sessions,
});

describe('computeTaskTotalMs', () => {
  it('happy path: sums closed sessions', () => {
    const t = baseTask([
      { startedAt: 1000, endedAt: 3000 },
      { startedAt: 5000, endedAt: 6000 },
    ]);
    expect(computeTaskTotalMs(t, 10_000)).toBe(3000);
  });

  it('happy path: adds open session delta vs now', () => {
    const t = baseTask([
      { startedAt: 1000, endedAt: 2000 },
      { startedAt: 5000, endedAt: null },
    ]);
    expect(computeTaskTotalMs(t, 5500)).toBe(1000 + 500);
  });

  it('error path: clamps negative open-session delta to 0', () => {
    const t = baseTask([{ startedAt: 5000, endedAt: null }]);
    expect(computeTaskTotalMs(t, 2000)).toBe(0);
  });
});

describe('formatHHMMSS', () => {
  it('happy path: formats 3h 4m 9s', () => {
    const ms = (3 * 3600 + 4 * 60 + 9) * 1000;
    expect(formatHHMMSS(ms)).toBe('03:04:09');
  });

  it('happy path: zero duration', () => {
    expect(formatHHMMSS(0)).toBe('00:00:00');
  });

  it('error path: negative ms clamps to zero', () => {
    expect(formatHHMMSS(-1000)).toBe('00:00:00');
  });
});

describe('hasOpenSession / getOpenSession', () => {
  it('happy path: detects open session', () => {
    const t = baseTask([{ startedAt: 1, endedAt: null }]);
    expect(hasOpenSession(t)).toBe(true);
    expect(getOpenSession(t)?.startedAt).toBe(1);
  });

  it('error path: no open sessions', () => {
    const t = baseTask([{ startedAt: 1, endedAt: 2 }]);
    expect(hasOpenSession(t)).toBe(false);
    expect(getOpenSession(t)).toBeUndefined();
  });
});
