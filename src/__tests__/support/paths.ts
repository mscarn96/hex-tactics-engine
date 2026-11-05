import path from 'node:path';

/**
 * Repo paths for the suites that read source files off disk.
 *
 * Anchored to *this* file, which does not move, rather than counted as `..`
 * from a suite, which does — grouping the suites into domain directories added
 * one level and silently pointed both source-scanning tests at `src/__tests__`.
 * A scan that finds no files passes.
 */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const SRC_DIR = path.join(REPO_ROOT, 'src');
