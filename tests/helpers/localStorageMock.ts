// Shared localStorage mock helper used by oracle tests.
// Replaces window.localStorage with an in-memory map; supports forced throws.

export interface MockStorage extends Storage {
  __store: Map<string, string>;
  __readThrows: boolean;
  __writeThrows: boolean | 'quota';
  __removeThrows: boolean;
}

export function installMockLocalStorage(): MockStorage {
  const store = new Map<string, string>();
  const mock: MockStorage = {
    __store: store,
    __readThrows: false,
    __writeThrows: false,
    __removeThrows: false,
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      if (mock.__readThrows) throw new Error('read unavailable');
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null;
    },
    removeItem(key: string) {
      if (mock.__removeThrows) throw new Error('remove unavailable');
      store.delete(key);
    },
    setItem(key: string, value: string) {
      if (mock.__writeThrows === 'quota') {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      if (mock.__writeThrows) throw new Error('write unavailable');
      store.set(key, value);
    },
  };
  // @ts-expect-error assign to global
  globalThis.localStorage = mock;
  // @ts-expect-error assign to window shim
  globalThis.window = { ...(globalThis.window ?? {}), localStorage: mock };
  return mock;
}

export function resetMockLocalStorage(mock: MockStorage) {
  mock.__store.clear();
  mock.__readThrows = false;
  mock.__writeThrows = false;
  mock.__removeThrows = false;
}
