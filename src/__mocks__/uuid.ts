/**
 * `src/platform/uuid.ts` under Jest, wired in by `moduleNameMapper`.
 *
 * Ids are unique, which is what the real `randomUUID` promises: "two things are the same object"
 * is not a property a test should be able to acquire by accident.
 */
let n = 0;

export const randomUUID = (): string => `test-uuid-${++n}`;

/** Test-only: makes ids stable across suites that care about the sequence. */
export const __resetUuids = (): void => {
  n = 0;
};
