module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Pins the one dice roll that would otherwise make every suite that advances
  // turns nondeterministic: speed-granted bonus turns. See `turnTempo`.
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // `__tests__/support/` holds shared helpers, not suites. Jest's default
  // testMatch claims every `.ts` under `__tests__`, and a module with no `it()`
  // in it is a hard failure rather than a skip.
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/support/'],
  moduleNameMapper: {
    '^@/platform/uuid$': '<rootDir>/src/__mocks__/uuid.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  maxWorkers: '50%',
  transform: {
    // `isolatedModules` transpiles each file alone instead of type checking it
    // against everything it imports. `npm run typecheck` already checks the suites.
    // TS 6 then wants `rootDir` set and `node10` resolution acknowledged.
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        moduleResolution: 'node',
        module: 'commonjs',
        esModuleInterop: true,
        isolatedModules: true,
        rootDir: '.',
        ignoreDeprecations: '6.0',
      },
    }],
  },
};
