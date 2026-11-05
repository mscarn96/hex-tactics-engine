/** A random id. Jest maps this module to `src/__mocks__/uuid.ts`, which keeps test ids stable. */
export const randomUUID = (): string => globalThis.crypto.randomUUID();
