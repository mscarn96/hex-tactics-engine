import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARENA_LAYOUT_VERSION, ArenaLayoutError, ArenaLayoutV1, LayoutContext, LayoutIssue,
  isArenaLayout, layoutKey, parseArenaLayout, validateArenaLayout,
} from '@/data/display/arenaLayout';
import { arenaCompositionFor, compileArenaLayout } from '@/data/display/arenaCompile';
import { arenaLayoutKeys, arenaLayouts } from '@/data/display/arenaLayouts';
import { PROP_SOURCES, SCENERY_KITS, SceneryKit } from '@/data/display/sceneryKits';
import { GROUND_COMPOSITION } from '@/data/display/groundPatches';
import { sceneryFor } from '@/systems/combat/encounterContext';
import { arenaLocationIds } from '@/locations';
import { TileType } from '@/models/types';
import { SRC_DIR } from '../support/paths';

/**
 * The arena layout format.
 *
 * Two things are being pinned and only one of them is the validator. The other
 * is the acceptance criterion the task was written against — **the format can
 * hold the compositions the game ships** — and the only honest way to measure
 * that is to author one and compare it against the code it replaces, field for
 * field. A schema that merely *looks* capacious passes every test written about
 * itself.
 */

const layoutsDir = join(SRC_DIR, 'data', 'display', 'arenas');

/** Every place a fight is dressed as — the foothill camp holds none. */
const locationIds = arenaLocationIds;

const readLayout = (name: string): unknown =>
  JSON.parse(readFileSync(join(layoutsDir, `${name}.json`), 'utf8'));

/**
 * The composition half of a layout, in the shape the runtime already has.
 *
 * **The compiler, not a copy of it.** This was a local reassembly while the
 * resolver was a later task, and the moment one existed the local copy became
 * the fault this repository names everywhere: a rule stated twice drifts, and
 * the half that drifts silently is the one with a green test written about
 * itself. The criterion the file is here for — the format holds what the game
 * ships — is worth strictly more measured through the thing the game will
 * actually run.
 */
const asKit = (layout: ArenaLayoutV1): SceneryKit => compileArenaLayout(layout).kit;

/** The one place a layout id is turned back into what the runtime looks up. */
const shippedKit = (layout: ArenaLayoutV1) => SCENERY_KITS[layoutKey(layout.context)];

describe('the format holds the compositions the game ships', () => {
  /**
   * **Every layout this build ships parses**, which is the format's floor and
   * has nothing to do with what any of them says.
   */
  const shipped = ['mountain', 'desert'] as const;

  it.each(shipped)('%s parses as a layout this build reads', (name) => {
    expect(validateArenaLayout(readLayout(name))).toEqual([]);
  });

  /**
   * **Mountain alone, and the loss of the second one is the point.**
   *
   * The criterion this block was written for is that *the format can hold the
   * compositions the game ships*, and the only honest way to measure it is to
   * author one and compare it with the code it replaces, field for field. Both
   * proof environments were transcriptions when it was written; desert is now
   * authored in the editor and deliberately says something `CANYON` does not,
   * so comparing the two would fail on exactly the work being asked for.
   *
   * What replaces it is not weaker: `arenaParity.test.ts` composes mountain
   * through both halves and compares the *props*, and `arenaRuntime.test.ts`
   * pins which of the two a fight is handed. The transcription control survives
   * a divergence on the other arena because it was never the same measurement.
   */
  const transcribed = ['mountain'] as const;

  it.each(transcribed)('%s is byte-for-byte the shipped scenery kit', (name) => {
    const layout = parseArenaLayout(readLayout(name));
    expect(asKit(layout)).toEqual(shippedKit(layout));
  });

  it.each(transcribed)('%s is byte-for-byte the shipped ground composition', (name) => {
    const layout = parseArenaLayout(readLayout(name));
    expect(layout.ground).toEqual(GROUND_COMPOSITION[layoutKey(layout.context)]);
  });

  /**
   * And the arena that left says so, rather than the clause quietly shrinking.
   *
   * A list narrowed from two names to one reads identically whether the second
   * was re-authored on purpose or dropped because it had started failing — so
   * the divergence is asserted from the other side. The fallback is still the
   * composition it replaced, which is what makes `arenaLayouts.ts`'s
   * drop-and-report policy a degradation to the previous picture rather than to
   * nothing at all.
   */
  it('has desert authored past the kit it used to transcribe', () => {
    const layout = parseArenaLayout(readLayout('desert'));
    expect(asKit(layout)).not.toEqual(shippedKit(layout));
    expect(shippedKit(layout)).toBeDefined();
    expect(GROUND_COMPOSITION[layoutKey(layout.context)]).toBeDefined();
  });

  /**
   * The point of the whole exercise, stated directly.
   *
   * The pass's gate is assembled by `gateLanding()`, a function returning
   * eighteen near-identical blocks, and its shelf arrives through a spread of a
   * shared `const` with three fields overridden. Neither is readable by a tool
   * and neither can be written back by one. Twenty-five pieces standing in the
   * file is what "without executable TypeScript values" means.
   */
  it('spells out what the pass assembles in code', () => {
    const layout = parseArenaLayout(readLayout('mountain'));
    const landings = layout.groups
      ?.flatMap((group) => group.pieces)
      .filter((piece) => piece.key === 'arena_landing_0');
    expect(landings).toHaveLength(18);
  });

  /**
   * **Every field of every kit has somewhere to go.** `LayoutScatter` is
   * `SceneryKit` less the sections the format hoists, so this holds by
   * construction at the type level — and it is measured anyway over all
   * eighteen kits, because the construction is only as good as the hoist list
   * beside it and that list is written out by hand.
   */
  it('has a home for every field of every shipped kit', () => {
    const hoisted = ['framingDepth', 'focal', 'groups', 'colonnade', 'wall', 'quiet', 'water', 'hills',
      'shelf', 'haze', 'lights'];
    const scatter = ['canopy', 'thicket', 'ground', 'groundCover', 'cover', 'horizon',
      'enclosure', 'canopyGathers', 'dressing', 'fill', 'openGround'];
    const unplaceable = Object.entries(SCENERY_KITS).flatMap(([key, kit]) =>
      Object.keys(kit ?? {})
        .filter((field) => !hoisted.includes(field) && !scatter.includes(field))
        .map((field) => `${key}.${field}`));
    expect(unplaceable).toEqual([]);
  });
});

describe('a layout names the fight it dresses', () => {
  /**
   * **`layoutKey` may not become a second answer to "which kit is this".**
   * `sceneryFor` derives the same string from an `EncounterContext`, and the
   * castle-inside-a-lair bug `encounterContext` exists to end is exactly what a
   * divergence here would re-create — so the two are compared through the kit
   * they each resolve to, over every context the game can produce.
   */
  const worldContexts: LayoutContext[] = Object.values(TileType).flatMap((terrain) => [
    { kind: 'surface' as const, terrain, danger: false },
    { kind: 'surface' as const, terrain, danger: true },
  ]);

  /**
   * **Measured against the seam, by identity.** `sceneryFor` resolves through
   * `arenaCompositionFor`, so the kit a fight on mountain or desert is dressed
   * with is the *compiled layout* rather than the object literal in
   * `SCENERY_KITS` — and the kit it gets has to be the *same object* the seam
   * returns, because `arenaScenery`'s composition memo is keyed on it and a
   * fresh copy per call would re-derive the enclosure, the water field and
   * every feature site on every frame of every fight.
   *
   * This used to compare against `SCENERY_KITS[key]` by value as well, which
   * was true only while every layout transcribed the kit it replaced. Desert
   * is authored past its kit now, so that clause would fail on the work rather
   * than on a wrong key — and it was the weaker of the two anyway: identity
   * against the seam catches a misderived key exactly as well, since a wrong
   * key resolves to a different object.
   *
   * The table is still what answers for the **sixteen** surfaces no layout
   * dresses, and that is asserted where it is true.
   */
  it.each(worldContexts)('resolves $terrain danger=$danger the way sceneryFor does', (context) => {
    if (context.kind !== 'surface') throw new Error('unreachable');
    const key = layoutKey(context);
    const resolved = sceneryFor({
      kind: 'world', terrain: context.terrain, danger: context.danger, threat: 0,
    });
    expect(resolved.kit).toBe(arenaCompositionFor(key, arenaLayouts())?.kit ?? null);
    const authored = arenaLayoutKeys().includes(key);
    if (!authored) expect(resolved.kit).toBe(SCENERY_KITS[key] ?? null);
  });

  it('resolves a location to the kit keyed under that location', () => {
    for (const id of locationIds()) {
      expect(layoutKey({ kind: 'location', location: id })).toBe(id);
    }
  });

  /**
   * `LocationId` is a union of string literals, which is erased — so the
   * validator's allow-list is written out, and this is the derivation it could
   * not have. A place added to the roster and not to that list is a layout
   * nobody can author for it.
   */
  it('accepts every location the roster actually builds', () => {
    const refused = locationIds()
      .map((id) => ({ ...base(), context: { kind: 'location', location: id } }))
      .filter((layout) => !isArenaLayout(layout));
    expect(refused).toEqual([]);
  });
});

/** The smallest thing that is a layout, for the rules that are about one field. */
const base = (): Record<string, unknown> => ({
  version: ARENA_LAYOUT_VERSION,
  id: 'probe',
  title: 'Probe',
  context: { kind: 'surface', terrain: TileType.Plains, danger: false },
  scatter: { canopy: [], thicket: [], ground: [] },
});

const withField = (field: string, value: unknown) => ({ ...base(), [field]: value });
const paths = (issues: LayoutIssue[]) => issues.map((issue) => issue.path);

describe('a version this build does not read is refused by number', () => {
  /**
   * **The version is read first and alone.** A layout from a later editor is
   * not malformed — it is a file this build has no business interpreting — and
   * reporting its unknown fields as errors would invite somebody to "fix" them
   * into a shape that renders wrongly rather than not at all.
   */
  it.each([2, 0, -1, 99])('refuses version %s and says what it reads', (version) => {
    const issues = validateArenaLayout({ ...base(), version });
    expect(paths(issues)).toEqual(['version']);
    expect(issues[0].message).toContain(String(version));
    expect(issues[0].message).toContain(String(ARENA_LAYOUT_VERSION));
  });

  it('reports nothing but the version when the rest is broken too', () => {
    const issues = validateArenaLayout({ version: 2, scatter: 'nonsense', extra: 1 });
    expect(paths(issues)).toEqual(['version']);
  });

  it.each([['a string', '1'], ['null', null], ['absent', undefined]])(
    'refuses a version that is %s',
    (_label, version) => {
      const layout: Record<string, unknown> = base();
      if (version === undefined) delete layout.version;
      else layout.version = version;
      expect(paths(validateArenaLayout(layout))).toEqual(['version']);
    });
});

describe('a malformed layout says where it is wrong', () => {
  it('names a required field that is missing', () => {
    const layout: Record<string, unknown> = base();
    delete layout.context;
    expect(validateArenaLayout(layout)).toEqual([{ path: 'context', message: 'is required' }]);
  });

  /**
   * **Deep paths are the whole reason issues carry one.** `keys` is a field on
   * a wall, on each of its arcs, on a shelf's `below` and on a colonnade, so a
   * message naming only the field is a message nobody can act on.
   */
  it('names the exact arc a bad bearing sits in', () => {
    const layout = withField('wall', {
      keys: ['a'],
      depth: 4,
      arcs: [{ bearing: 0, sweep: 1 }, { bearing: 'north', sweep: 1 }],
    });
    expect(paths(validateArenaLayout(layout))).toEqual(['wall.arcs[1].bearing']);
  });

  it('names the exact terrace a bad radius sits on', () => {
    const layout = withField('shelf', {
      edges: [{ bearing: -0.5, sweep: 3, radius: 11.6 }, { bearing: 1.3, sweep: 2.4, radius: -4 }],
      drop: 7, steps: 4, tread: 1, face: '#464b54', lower: '#5e6673',
    });
    expect(paths(validateArenaLayout(layout))).toEqual(['shelf.edges[1].radius']);
  });

  /**
   * **An unknown key is named rather than dropped.** A permissive reader is
   * the wrong way round for a file a person edits: a mistyped `bearings`
   * silently ignored is a landmark that never appears with no reason given.
   */
  it('names a key that is not part of the format', () => {
    const issues = validateArenaLayout(withField('quiet', [{ bearing: 0, sweep: 1, densty: 0.2 }]));
    expect(paths(issues)).toEqual(['quiet[0].densty']);
    expect(issues[0].message).toContain('not part of an arena layout');
  });

  it.each([
    ['a colour that is not one', 'haze', { color: 'slate', near: 40, far: 90 }, 'haze.color'],
    ['a tier that is not one', 'focal',
      [{ key: 'k', tier: 'shrub', count: 1, depth: 2 }], 'focal[0].tier'],
    ['a water shape that is not one', 'water',
      { shape: 'lake', color: '#224466', near: 1, far: 4 }, 'water.shape'],
    ['a tint channel that would brighten', 'ground',
      { patches: [{ tint: [1.2, 1, 1], threshold: 0.5, ramp: 0.2, scale: 3, salt: 7 }] },
      'ground.patches[0].tint[0]'],
  ])('names %s', (_label, field, value, path) => {
    expect(paths(validateArenaLayout(withField(field, value)))).toEqual([path]);
  });

  /**
   * **The dressing is a nested object three deep, so its paths are the test.**
   * A rate is per tier, a size is a pair and a facing is a pair — three shapes
   * under one field, and an issue naming only `scatter.dressing` is one nobody
   * can act on. A rate is a share, so it is refused outside 0..1; a `pull`
   * deliberately is not, because above one is how a kit of round things turns
   * the facing rule off.
   */
  it('names the exact dressing field that is wrong', () => {
    const dressed = (dressing: unknown) => ({
      ...base(), scatter: { canopy: [], thicket: [], ground: [], dressing },
    });
    expect(paths(validateArenaLayout(dressed({ rate: { thicket: 1.4 } }))))
      .toEqual(['scatter.dressing.rate.thicket']);
    expect(paths(validateArenaLayout(dressed({ rate: { shrub: 0.4 } }))))
      .toEqual(['scatter.dressing.rate.shrub']);
    expect(paths(validateArenaLayout(dressed({ scale: { min: 0.9 } }))))
      .toEqual(['scatter.dressing.scale.max']);
    expect(paths(validateArenaLayout(dressed({ turn: { jitter: -1 } }))))
      .toEqual(['scatter.dressing.turn.jitter']);
    // Legal, and all three of them: a full spec, a partial rate, and a pull
    // past one, which is the spelling for "leave these facings to the hash".
    expect(validateArenaLayout(dressed({
      rate: { canopy: 0.5, thicket: 0.7, ground: 0.5 },
      scale: { min: 0.8, max: 1.1 },
      turn: { pull: 2, jitter: 0.4 },
    }))).toEqual([]);
    expect(validateArenaLayout(dressed({ rate: { ground: 0.2 } }))).toEqual([]);
  });

  it('names the kind when a context is neither shape', () => {
    expect(paths(validateArenaLayout(withField('context', { kind: 'biome', terrain: 'plains' }))))
      .toEqual(['context.kind']);
  });

  it.each([null, 42, 'a layout', [1, 2]])('refuses %p as a whole layout', (value) => {
    const issues = validateArenaLayout(value);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('');
  });

  /**
   * Every issue, not the first. A layout is fixed in an editor, and one
   * complaint per save is a conversation rather than a correction.
   */
  it('reports every problem at once, and throws them together', () => {
    const broken = { ...base(), id: '', title: 42, framingDepth: -1 };
    expect(paths(validateArenaLayout(broken)).sort()).toEqual(['framingDepth', 'id', 'title']);
    try {
      parseArenaLayout(broken);
      throw new Error('expected parseArenaLayout to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ArenaLayoutError);
      expect((error as ArenaLayoutError).issues).toHaveLength(3);
      expect((error as ArenaLayoutError).message).toContain('framingDepth');
    }
  });

  it('returns the layout itself when nothing is wrong', () => {
    const layout = base();
    expect(parseArenaLayout(layout)).toBe(layout);
  });
});

describe('inheritance is declared here and resolved later', () => {
  it('takes a parent on trust when it is not told what exists', () => {
    expect(validateArenaLayout(withField('extends', 'mountain'))).toEqual([]);
  });

  it('refuses a parent that resolves to nothing when it is', () => {
    const issues = validateArenaLayout(withField('extends', 'mountian'), { known: ['mountain'] });
    expect(paths(issues)).toEqual(['extends']);
    expect(issues[0].message).toContain('mountian');
  });

  it('refuses a layout that inherits from itself', () => {
    const layout = { ...base(), id: 'probe', extends: 'probe' };
    expect(paths(validateArenaLayout(layout, { known: ['probe'] }))).toEqual(['extends']);
  });

  it('accepts a parent that exists', () => {
    expect(validateArenaLayout(withField('extends', 'mountain'), { known: ['mountain', 'desert'] }))
      .toEqual([]);
  });
});

describe('what the shipped kits cannot exercise', () => {
  /**
   * The acceptance criterion names the **planned** desert as well as the
   * shipped one, and the planned work is authored formations, a composed camp
   * and a ruin — placements a designer drops rather than rates a composer
   * rolls. Nothing in `SCENERY_KITS` has ever had such a field, so the
   * transcriptions above cannot prove it parses. These do.
   */
  it('accepts pieces placed by hand, in world units about the board', () => {
    const layout = withField('placements', [
      { key: 'arena_desert_ruin_0', tier: 'canopy', x: -6.2, z: -4.1 },
      { key: 'arena_arch_1', tier: 'canopy', x: 3.4, z: -7.8, turn: 0.4, scale: 1.1, lift: 0.9, id: 'gate' },
    ]);
    expect(validateArenaLayout(layout)).toEqual([]);
  });

  /**
   * Haze is hoisted off the shelf it arrived on, so a kit with air in front of
   * its horizon and no cliff is expressible — which every shipped kit with
   * haze happens not to be.
   */
  it('accepts haze with no shelf under it', () => {
    expect(validateArenaLayout(withField('haze', { color: '#5c6672', near: 46, far: 150 })))
      .toEqual([]);
  });

  /**
   * **A baked layout says where each piece came from**, and the vocabulary is
   * the composer's own `PropSource` rather than free text: the format borrows
   * the list from `sceneryKits` and validates against it, so a mistyped origin
   * is refused where a `string` would have let a row into the hierarchy that
   * no rule can ever fill. Absent is the ordinary case — a piece a person
   * dropped has no origin at all, which is how the two are told apart at all
   * after everything in a scene has become a placement.
   */
  it('accepts a baked placement, and refuses a rule that does not exist', () => {
    const piece = (extra: Record<string, unknown>) => withField('placements', [
      { key: 'arena_pine_0', tier: 'canopy', x: -6.2, z: -4.1, ...extra },
    ]);
    expect(validateArenaLayout(piece({}))).toEqual([]);
    for (const origin of PROP_SOURCES) {
      expect(validateArenaLayout(piece({ origin }))).toEqual([]);
    }
    expect(validateArenaLayout(piece({ origin: 'rolled' }))).toEqual([{
      path: 'placements[0].origin',
      message: `must be one of ${PROP_SOURCES.join(', ')}; got "rolled"`,
    }]);
  });

  it('accepts editor metadata, and asks nothing of it', () => {
    expect(validateArenaLayout(withField('meta', {
      notes: 'the gate is on the left flank because the far end belongs to the drop',
      updatedAt: '2026-09-15T00:00:00.000Z',
      author: 'nobody',
      editor: 'a private tool',
    }))).toEqual([]);
  });
});

describe('the format is a data boundary', () => {
  const source = readFileSync(join(SRC_DIR, 'data', 'display', 'arenaLayout.ts'), 'utf8');

  /**
   * **Playable cells and combat rules stay outside the format**, and the
   * cheapest way to keep them out is that the module cannot reach them. It
   * imports display data and `models/` and nothing else — no store, no system,
   * no scene, no `three` — so a layout is readable by a tool with no idea what
   * a turn is, and by the node suites without a mock.
   */
  it('imports nothing it would have to run the game to read', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    const upward = imports.filter((name) =>
      name.startsWith('@/systems/') || name.startsWith('@/stores/')
      || name.startsWith('@/components/') || name === 'three' || name === 'react'
      || name.startsWith('react-native'));
    expect(upward).toEqual([]);
  });

  /**
   * The fixtures are JSON on disk, so this is true by construction — which is
   * exactly why it is worth asserting: the day one of them becomes a `.ts`
   * module exporting an object, everything else in this file still passes.
   */
  it.each(['mountain', 'desert'])('%s survives a round trip through JSON unchanged', (name) => {
    const layout = readLayout(name);
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
  });
});
