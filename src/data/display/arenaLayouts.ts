import {
  ArenaLayoutV1, LayoutIssue, layoutKey, migrateArenaLayout, validateArenaLayout,
} from './arenaLayout';

import city from './arenas/city.json';
import desert from './arenas/desert.json';
import mountain from './arenas/mountain.json';
import summit from './arenas/summit.json';

/**
 * The layouts this build ships, and what it refused.
 *
 * **The runtime half of the migration seam.** `arenaCompile.ts` says what a
 * layout *is* to the composer and `arenaCompositionFor` says which answer wins;
 * this is the list it is handed during a fight. Eighteen compositions are
 * object literals in `sceneryKits.ts` and they move over one file at a time —
 * a key with a layout is dressed by the layout, a key without one by the table,
 * and nothing else in the renderer learns that a file can exist.
 *
 * **The list is written out rather than discovered, and that is the bundler
 * rather than a preference.** Metro resolves `require` at build time, so there
 * is no reading of a directory on a phone; a layout saved by the editor is on
 * disk and is not in the game until a line is added here. That is a step
 * somebody takes on purpose — putting a file on the critical path of every
 * fight is a decision about failure modes — and `arenaRuntime.test.ts` fails on
 * a `.json` in the directory this file does not name, so the step cannot be
 * forgotten quietly.
 *
 * **A layout this build cannot read is dropped, never thrown.** A fight that
 * refuses to draw because a file is malformed is strictly worse than a fight
 * dressed by the kit the file was going to replace — the composition is a
 * picture, and the picture degrading to the previous picture is the whole
 * shape of the fallback this seam is built around. What must *not* happen is
 * that it degrades silently, so every refusal is kept and reported by
 * {@link arenaLayoutIssues}, and the suite fails on a non-empty list. Nothing
 * at runtime can observe a layout that quietly did not load: the arena renders
 * perfectly, dressed by the wrong composition.
 */

/** A shipped layout this build would not read, and why. */
export interface RejectedLayout {
  /** The file, as it is named in this module. */
  file: string;
  /** Everything wrong with it, in `validateArenaLayout`'s own shape. */
  issues: LayoutIssue[];
}

/**
 * Every layout file compiled into the app, paired with its name.
 *
 * The name is carried beside the value because a rejected layout has no `id`
 * to be reported under — an unreadable file is exactly the one whose fields
 * cannot be trusted — and "one of the arena layouts is malformed" is not a
 * report anybody can act on.
 */
const FILES: ReadonlyArray<readonly [string, unknown]> = [
  ['mountain.json', mountain],
  ['desert.json', desert],
  ['city.json', city],
  // Jadeveil: Kairen's summit, a world site's own arena
  ['summit.json', summit],
];

/** What {@link readArenaLayouts} makes of a set of files. */
export interface LayoutRegistry {
  /** The layouts this build reads, in file order. */
  layouts: ArenaLayoutV1[];
  /** The ones it refused, and why. */
  rejected: RejectedLayout[];
}

let registry: LayoutRegistry | null = null;

/**
 * Candidate ids, read off the raw files before any of them is validated.
 *
 * `extends` is checked against what exists, and what exists is not known until
 * every file has been read — so the ids are collected first, from whatever each
 * value claims. A file whose `id` is not a string contributes nothing and will
 * fail its own validation a moment later, which is the right order: a malformed
 * parent should be reported as malformed rather than as a name that resolves to
 * nothing.
 */
function claimedIds(files: ReadonlyArray<readonly [string, unknown]>): string[] {
  const ids: string[] = [];
  for (const [, value] of files) {
    const id = (value as { id?: unknown } | null)?.id;
    if (typeof id === 'string') ids.push(id);
  }
  return ids;
}

/**
 * A set of candidate files, sorted into what this build reads and what it
 * refused.
 *
 * **Exported so the drop-and-report policy can be measured on something
 * malformed**, which the shipped pair deliberately is not. One implementation
 * with two callers, rather than a suite restating what it believes the rule to
 * be: a fallback nothing exercises is a fallback nobody finds out is broken
 * until a real file breaks, which is the one moment it has to work.
 */
export function readArenaLayouts(
  files: ReadonlyArray<readonly [string, unknown]>,
): LayoutRegistry {
  const layouts: ArenaLayoutV1[] = [];
  const rejected: RejectedLayout[] = [];
  const known = claimedIds(files);
  const taken = new Set<string>();
  for (const [file, value] of files) {
    const issues = validateArenaLayout(value, { known });
    if (issues.length === 0) {
      // The *upgraded* value, which for a current file is the identical object
      // it was handed — the identity `compileArenaLayout` memoises its result
      // on, and therefore the identity `arenaScenery`'s `lastKit === kit` check
      // is asking about. A copy made per call would re-derive the enclosure,
      // the water field and every feature site on every frame of every fight.
      const layout = migrateArenaLayout(
        value as Record<string, unknown>,
      ) as unknown as ArenaLayoutV1;
      // Two files under one id is not a composition question: `extends` names
      // an id, so a duplicate makes inheritance ambiguous rather than merely
      // redundant. The first wins and the second is reported — a *context*
      // claimed twice is the ordinary thing to have while a study is worked up
      // and is deliberately not refused here, the way the editor reports it.
      if (taken.has(layout.id)) {
        rejected.push({
          file,
          issues: [{ path: 'id', message: `is already taken by another layout: "${layout.id}"` }], // i18n-exempt: arena layout validation message for authors
        });
        continue;
      }
      taken.add(layout.id);
      layouts.push(layout);
      continue;
    }
    rejected.push({ file, issues });
  }
  return { layouts, rejected };
}

const read = (): LayoutRegistry => (registry ??= readArenaLayouts(FILES));

/**
 * Every layout the game dresses an arena from.
 *
 * The identical array on every call, because the objects in it are what
 * `compileArenaLayout` keys its memo on and the array itself is walked once per
 * `sceneryFor`.
 */
export function arenaLayouts(): readonly ArenaLayoutV1[] {
  return read().layouts;
}

/** Every shipped layout this build refused, and why. Empty in a healthy build. */
export function arenaLayoutIssues(): readonly RejectedLayout[] {
  return read().rejected;
}

/** The key each accepted layout dresses — what `sceneryFor` looks a kit up under. */
export function arenaLayoutKeys(): string[] {
  return arenaLayouts().map((layout) => layoutKey(layout.context));
}

/** The file names this module compiles in, for the suite that reads the directory. */
export function arenaLayoutFiles(): string[] {
  return FILES.map(([file]) => file);
}
