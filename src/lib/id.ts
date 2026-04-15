// UUID generation utilities.
// Wraps crypto.randomUUID for consistent mocking and testability.

/**
 * generateId
 *
 * Generates a RFC-4122 v4 UUID using crypto.randomUUID().
 */
export function generateId(): string {
  return crypto.randomUUID();
}
