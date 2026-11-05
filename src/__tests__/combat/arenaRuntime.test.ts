import { readFileSync, readdirSync } from 'node:fs';
import { arenaKeyContext } from '../support/arenaKeyContext';
import { join } from 'node:path';
import {
  arenaLayoutFiles, arenaLayoutIssues, arenaLayoutKeys, arenaLayouts, readArenaLayouts,
} from '@/data/display/arenaLayouts';
import { arenaCompositionFor, compileArenaLayout } from '@/data/display/arenaCompile';
import { ARENA_LAYOUT_VERSION, layoutKey } from '@/data/display/arenaLayout';
import { GROUND_COMPOSITION } from '@/data/display/groundPatches';
import { SCENERY_KITS } from '@/data/display/sceneryKits';
import { sceneryFor } from '@/systems/combat/encounterContext';
import { REPO_ROOT, SRC_DIR } from '../support/paths';

/**
 * The layouts the *game* loads.
 *
 * `arenaLayout.test.ts` pins what a layout is as a file and `arenaCompile.test.ts`
 * pins what it compiles to; both of those are true of a file nobody reads. This
 * is the half that puts one on the critical path of a fight — so what it
 * measures is not the format but the two things adoption can break silently: a
 * composition that now comes from somewhere else, and a file that quietly did
 * not load.
 */

const layoutsDir = join(SRC_DIR, 'data', 'display', 'arenas');

/**
 * `sceneryFor` resolves three key spaces — a location id indoors, a
 * `danger_<terrain>` on blighted ground and a bare terrain elsewhere — so a key
 * is turned back into the context that produces it rather than guessed at.
 */
const sceneryForKey = (key: string) => sceneryFor(arenaKeyContext(key, { living: 0, haunted: 0 }));

describe('the shipped layouts load', () => {
  /**
   * **A refusal is reported, and this is what reads the report.** Dropping a
   * malformed layout is the right failure mode at runtime — the fight is
   * dressed by the kit the file was replacing rather than not drawn at all —
   * and it is also completely invisible from the screen, because a fallback
   * composition renders perfectly. The build is the place that gets to notice.
   */
  it('refuses none of them', () => {
    expect(arenaLayoutIssues().map((bad) => [bad.file, bad.issues[0]?.message])).toEqual([]);
  });

  it('reads every one of them', () => {
    expect(arenaLayouts().map((layout) => layout.id).sort()).toEqual(['city', 'desert', 'mountain', 'summit']);
  });

  /**
   * **A file in the directory this module does not name is a composition nobody
   * will ever see.** Metro resolves `require` at build time, so the list is
   * written out rather than discovered — which means adopting a layout is a line
   * somebody adds, and the only failure mode of forgetting is silence: the arena
   * keeps composing itself from the code-authored kit and the file sits there
   * looking adopted.
   */
  it('names every layout file on disk', () => {
    const onDisk = readdirSync(layoutsDir).filter((name) => name.endsWith('.json')).sort();
    expect(arenaLayoutFiles().sort()).toEqual(onDisk);
  });
});

describe('a fight on authored ground is dressed by the file', () => {
  /**
   * The acceptance criterion, stated where it can be checked: the composition a
   * fight is handed comes out of the compiled layout, not out of
   * `SCENERY_KITS`. Identity rather than equality, because the two are pinned
   * *equal* by `arenaLayout.test.ts` — so equality would pass whichever answered
   * and would say nothing at all about which one did.
   */
  it.each(arenaLayoutKeys())('dresses %s from its compiled layout', (key) => {
    const layout = arenaLayouts().find((held) => layoutKey(held.context) === key)!;
    const compiled = compileArenaLayout(layout);
    const scenery = sceneryForKey(key);
    expect(scenery.kit).toBe(compiled.kit);
    expect(scenery.composition).toBe(compiled.composition);
    expect(scenery.kit).not.toBe(SCENERY_KITS[key]);
  });

  /**
   * **The shelf, the water, the haze and the fixture lights ride on the kit**,
   * which is why adoption needed no new field on `ArenaScenery` — and it is also
   * why that has to be measured rather than assumed: a section the compiler
   * failed to carry across would leave the pass with no cliff and nothing would
   * say so.
   */
  it('carries the pass its landform, its air and its own furniture', () => {
    const shipped = SCENERY_KITS.mountain!;
    const kit = sceneryForKey('mountain').kit!;
    expect(kit.shelf).toEqual(shipped.shelf);
    expect(kit.haze).toEqual(shipped.haze);
    expect(kit.framingDepth).toBe(shipped.framingDepth);
    expect(kit.groups).toEqual(shipped.groups);
  });

  /**
   * `arenaScenery`'s composition memo is `lastKit === kit`, so a seam handing
   * back a fresh object per call would re-derive the enclosure, the water field
   * and every feature site twice a frame in the scene with the tightest budget
   * in the game — with nothing on screen to show for it.
   */
  it('hands back the same object every call', () => {
    for (const key of arenaLayoutKeys()) {
      expect(sceneryForKey(key).kit).toBe(sceneryForKey(key).kit);
    }
  });
});

describe('code-authored kits still answer for everything else', () => {
  const authored = new Set(arenaLayoutKeys());
  const unmigrated = Object.keys(SCENERY_KITS).filter((key) => !authored.has(key));

  it.each(unmigrated)('dresses %s from the shipped kit itself', (key) => {
    const scenery = sceneryForKey(key);
    expect(scenery.kit).toBe(SCENERY_KITS[key]);
    expect(scenery.composition).toBe(GROUND_COMPOSITION[key] ?? null);
  });

  /**
   * **The seam answers `null` for a key with no kit, floor and all**, so a
   * surface carrying a `GroundComposition` and no `SceneryKit` would lose its
   * board colour the day it was authored — the two tables are the same key set
   * today and nothing but this says they have to stay that way.
   */
  it('leaves no ground composition without a kit to be reached through', () => {
    const stranded = Object.keys(GROUND_COMPOSITION).filter((key) => !SCENERY_KITS[key]);
    expect(stranded).toEqual([]);
  });

  /**
   * The pre-kit behaviour, still reachable: a surface with neither is dressed
   * from `propKeys`, which is what every arena did before any of this existed.
   */
  it('still dresses a bare surface from nothing', () => {
    expect(arenaCompositionFor('stone', arenaLayouts())).toBeNull();
  });
});

describe('an unreadable layout degrades rather than breaking a fight', () => {
  const goodFile = 'mountain.json';
  const good = arenaLayouts()[0] as unknown;

  it('drops a malformed file and says which one', () => {
    const { layouts, rejected } = readArenaLayouts([
      ['broken.json', { version: ARENA_LAYOUT_VERSION, id: 'broken' }],
      [goodFile, good],
    ]);
    expect(layouts.map((layout) => layout.id)).toEqual(['mountain']);
    expect(rejected.map((bad) => bad.file)).toEqual(['broken.json']);
    expect(rejected[0].issues.length).toBeGreaterThan(0);
  });

  /**
   * A file from a later editor is not malformed — it is one this build has no
   * business interpreting — and `validateArenaLayout` refuses it by number and
   * reports nothing else. What matters here is that it is refused at all, rather
   * than compiled against a spec whose meaning it does not share.
   */
  it('drops a layout written by a later build', () => {
    const { layouts, rejected } = readArenaLayouts([
      ['future.json', { ...(good as object), version: ARENA_LAYOUT_VERSION + 1 }],
    ]);
    expect(layouts).toEqual([]);
    expect(rejected[0].issues[0].path).toBe('version');
  });

  /**
   * Two files under one id makes `extends` ambiguous, which is a different fault
   * from two files dressing one *context* — the editor reports the second of
   * those and refuses neither, because a study worked up beside a shipped arena
   * is an ordinary thing to have.
   */
  it('keeps the first of two layouts sharing an id and reports the second', () => {
    const { layouts, rejected } = readArenaLayouts([
      [goodFile, good],
      ['copy.json', good],
    ]);
    expect(layouts).toHaveLength(1);
    expect(rejected.map((bad) => bad.file)).toEqual(['copy.json']);
  });
});

describe('the editor is not in the game', () => {
  /**
   * **A source scan, for `lighting.test.ts`'s reason.** a private tool is a Vite
   * page with a dev server, a DOM and `node:fs` behind it; the one way any of
   * that reaches a Metro bundle is a module under `src/` naming it, and the
   * failure would be a bundler error on a phone rather than anything a test of
   * behaviour could observe. The forge imports the game's modules freely and
   * that is the whole arrangement — this is the direction that must stay shut.
   */
  const sources = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (at: string) => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const next = join(at, entry.name);
        if (entry.isDirectory()) walk(next);
        else if (/\.tsx?$/.test(next)) out.push(next);
      }
    };
    walk(dir);
    return out;
  };

  /**
   * The registry is the one module adoption added to the bundle, and it may
   * reach display data and JSON and nothing else — the rule `arenaLayout.ts` and
   * `arenaCompile.ts` already keep, restated where a new import would land.
   */
  it('loads its layouts without reaching a store, a scene or three', () => {
    const source = readFileSync(join(SRC_DIR, 'data', 'display', 'arenaLayouts.ts'), 'utf8');
    const specs = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(specs.filter((spec) => !/^\.\/(arenaLayout|arenas\/[a-z0-9_-]+\.json)$/.test(spec)))
      .toEqual([]);
  });
});
