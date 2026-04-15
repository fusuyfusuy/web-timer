import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateId } from '../../src/lib/id';

describe('generateId', () => {
  afterEach(() => vi.restoreAllMocks());

  it('happy path: returns a non-empty string (delegates to crypto.randomUUID)', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000000',
    );
    const id = generateId();
    expect(id).toBe('00000000-0000-4000-8000-000000000000');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('error path: propagates if crypto.randomUUID throws', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('no crypto');
    });
    expect(() => generateId()).toThrow('no crypto');
  });
});
