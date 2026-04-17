import { describe, it, expect, beforeEach } from 'vitest';
import { hydrateTasks, startMemoryOnly, promptMigrationReset, stashCorruptAndPrompt } from '../../src/services/bootService';
import { installMockLocalStorage, resetMockLocalStorage, type MockStorage } from '../helpers/localStorageMock';
import type { Task } from '../../src/types/task';

let mock: MockStorage;
beforeEach(() => {
  mock = installMockLocalStorage();
  resetMockLocalStorage(mock);
});

const validTask: Task = { id: 't1', name: 'T', createdAt: 1, sessions: [], timerMode: 'countup', countdownDurationMs: null, scheduledStartAt: null, scheduledEndAt: null };

describe('hydrateTasks — BOOT_OK (booting → idle)', () => {
  it('happy path: empty storage → empty list', () => {
    const result = hydrateTasks({ now: 1, rawStorage: null });
    expect(result.tasks).toEqual([]);
    expect(result.hasActive).toBe(false);
  });

  it('happy path: parses and returns all tasks', () => {
    const state = { schemaVersion: 2, tasks: [validTask] };
    const result = hydrateTasks({ now: 1, rawStorage: JSON.stringify(state) });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('t1');
  });
});

describe('stashCorruptAndPrompt — BOOT_CORRUPT', () => {
  it('happy path: stashes raw under backup key and returns prompt', () => {
    const res = stashCorruptAndPrompt({ now: 1, rawStorage: 'bad' });
    expect(mock.__store.get('webtimer:state:backup')).toBe('bad');
    expect(res.promptMessage).toContain('corrupt');
  });
});

describe('startMemoryOnly — BOOT_STORAGE_UNAVAILABLE', () => {
  it('happy path: returns warning', () => {
    const res = startMemoryOnly({ now: 1, rawStorage: null });
    expect(res.warning).toContain('unavailable');
  });
});

describe('promptMigrationReset — BOOT_SCHEMA_MISMATCH', () => {
  it('happy path: extracts stored version and returns prompt', () => {
    const state = { schemaVersion: 1, tasks: [] };
    const res = promptMigrationReset({ now: 1, rawStorage: JSON.stringify(state) });
    expect(res.storedVersion).toBe(1);
    expect(res.expectedVersion).toBe(2);
  });
});
