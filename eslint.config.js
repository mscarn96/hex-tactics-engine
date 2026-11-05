// @ts-check
const tseslint = require('typescript-eslint');

/**
 * Deliberately small and not type-aware: `tsc` already covers what a
 * project-service pass would add, at a cost of minutes on this tree.
 */
module.exports = tseslint.config(
  { ignores: ['**/node_modules/**', '**/coverage/**'] },

  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,js}'],
    rules: {
      // Leading-underscore names are the escape hatch for a deliberately
      // ignored destructure or catch bind.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      // Non-null assertion is the house style for "the test already proved this
      // exists", used throughout the store lookups and the suites.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
