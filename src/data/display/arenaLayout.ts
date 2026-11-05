import { TileType } from '@/models/enums';
import type { LocationId } from '@/locations/types';
import type { ArenaSite } from '@/models/encounter';
import type { IsleGround, JadeGround } from '@/models/world';
import type { MapTile } from '@/models/world';
import type {
  AuthoredLight, BoundaryArc, Colonnade, DressingSpec, FocalAnchor, FocalGroup, GroupPiece,
  CaveSpec, EdgeFill, HazeSpec, TerraceSpec, HillBack, HillRise, HillSpec, PropSource,
  QuietSector,
  SceneryKit, SceneryTier, ScenicPlacement, ShelfCrest, ShelfEdge, ShelfSpec, WallRing, WaterRegion,
} from './sceneryKits';
import { PROP_SOURCES, TIER_ORDER } from './sceneryKits';
import type { AxisBand, GroundComposition, GroundPatch } from './groundPatches';

/**
 * What an arena is, as a file rather than as TypeScript.
 *
 * **The boundary the editor, the runtime and the suites all speak across.** An
 * arena is authored today as an object literal in `sceneryKits.ts` beside a
 * second one in `groundPatches.ts`, and both are reached through a spread, a
 * shared `const` and — for the pass's landing — a *function* that returns
 * eighteen pieces. That is fine for code and impossible for a designer: a tool
 * cannot read a composition it has to run to see, and it cannot write one back
 * without emitting TypeScript, which is a change nothing checked.
 *
 * So this is the same composition as pure JSON. Every value is a string, a
 * number, a boolean, `null`, or an array or object of those — no functions, no
 * spreads, no imports — which is what lets a layout be loaded off disk, drawn,
 * dragged, saved and diffed.
 *
 * **Three rules hold the format still.**
 *
 * - **It restates nothing the kit already says purely.** `BoundaryArc`,
 *   `ShelfEdge`, `FocalGroup`, `GroundPatch` and the rest are already
 *   JSON-safe data, so the layout *is* those types rather than a second copy of
 *   them — the fault the private project notes names wherever a rule is written twice. What
 *   this adds is the envelope the kit has no room for: which fight the
 *   composition dresses, what it inherits, what a designer placed by hand, and
 *   what the editor wants to remember about the file.
 * - **Playable ground is not in it.** `inArena`, the hex lattice, movement,
 *   targeting and every other combat rule stay where they are. A layout can
 *   only ever say what the arena *looks* like, which is the same construction
 *   `arenaScenery` and `arenaShelf` already rest on — and it is why the format
 *   may be edited by a tool with no idea what a turn is.
 * - **A version is a promise.** `version` is read before anything else and a
 *   number this build does not know is refused by name rather than
 *   half-parsed, so a layout written by a later editor cannot be silently
 *   rendered wrong. See {@link validateArenaLayout}.
 */

/** The version this build writes. */
export const ARENA_LAYOUT_VERSION = 1;

/** One version's shape, turned into the next one's. */
export type LayoutMigration = (value: Record<string, unknown>) => Record<string, unknown>;

/**
 * How an older file becomes a current one, keyed by the version it is *leaving*.
 *
 * **Empty, and that is the seam rather than the absence of one.** There has only
 * ever been one version, so there is nothing to migrate and inventing an entry
 * to prove the mechanism works would be a migration nothing has ever run. What
 * the table buys is that adding version 2 is one entry here — `1` mapping the
 * old shape onto the new one — and every other answer follows from it: which
 * versions this build reads, what an unreadable one is told, and where
 * {@link parseArenaLayout} upgrades. A build that instead widened a written list
 * of supported versions would accept the file and then validate its old fields
 * against the new spec, which reads as a page of complaints about a file that is
 * perfectly correct for its own version.
 *
 * A migration is handed the raw parsed object and returns the next version's,
 * `version` included. It may assume the file was well-formed *for its own
 * version*: validation runs once, at the end, against the shape this build knows.
 */
export const LAYOUT_MIGRATIONS: Readonly<Partial<Record<number, LayoutMigration>>> = {};

/**
 * Every version this build can read, oldest first — **derived from the table.**
 *
 * A version is readable when an unbroken chain of migrations joins it to the
 * current one. Walking down from the current version rather than listing the
 * table's keys is what makes a *gap* unreadable: migrations for 1 and 3 with
 * nothing for 2 means a version-1 file cannot reach version 4, and a list of
 * keys would claim it could.
 *
 * **A function rather than the constant it replaced**, and that is the same
 * argument one step smaller: a constant filled at load time is a snapshot of a
 * derivation, and a snapshot is a second answer that can disagree with the
 * thing it was taken from. In a real build the table is fixed before anything
 * imports it and the two are identical — which is exactly the condition under
 * which nothing would ever notice them coming apart, so there is one answer and
 * the gate asks it. It is also what lets the suite install a pretend older
 * version and run the seam, which a table that has never migrated anything
 * otherwise cannot do: a rule nothing can perform reads as settled while being
 * untested, the failure the arena gate's own document is named after.
 */
export function readableLayoutVersions(): number[] {
  const out = [ARENA_LAYOUT_VERSION];
  for (let v = ARENA_LAYOUT_VERSION - 1; LAYOUT_MIGRATIONS[v]; v -= 1) out.unshift(v);
  return out;
}

/**
 * An older file at the current version's shape, or the file itself.
 *
 * **Returns the identical object when there is nothing to do**, which is what
 * keeps `parseArenaLayout` handing back what it was given — the identity
 * `compileArenaLayout`'s memo is keyed on.
 */
export function migrateArenaLayout(value: Record<string, unknown>): Record<string, unknown> {
  let at = value;
  for (let v = at.version as number; v < ARENA_LAYOUT_VERSION; v += 1) {
    const step = LAYOUT_MIGRATIONS[v];
    if (!step) break;
    at = step(at);
  }
  return at;
}

// --- The composition, borrowed rather than restated -------------------------

export type {
  AxisBand, BoundaryArc, Colonnade, FocalAnchor, FocalGroup, GroundPatch,
  GroupPiece, QuietSector, SceneryTier, ScenicPlacement, ShelfEdge, WallRing, WaterRegion,
};

/**
 * The rolled half of a composition: the three tiers, the ground cover, the
 * horizon band and how solid the structural canopy is.
 *
 * **Derived from `SceneryKit` by subtraction, not written out.** Everything a
 * kit places rather than rolls — its groups, anchors, colonnade, wall, quiet
 * sectors, water and shelf — is hoisted to the layout's own top level, where a
 * tool can address one landmark without walking a scatter list. What is left is
 * exactly the texture, and taking it by `Omit` means a field added to
 * `SceneryKit` lands here on its own and fails `npm run typecheck` in
 * {@link validateArenaLayout} until the format says what to do with it.
 */
export type LayoutScatter = Omit<
  SceneryKit,
  'framingDepth' | 'water' | 'focal' | 'groups' | 'colonnade' | 'wall' | 'quiet' | 'shelf'
  | 'hills' | 'placements' | 'haze' | 'lights'
>;

/**
 * The land the board stands on.
 *
 * **An alias rather than a subtraction, and that is the migration landing.** It
 * was `Omit<ShelfSpec, 'haze'>` because the runtime kept haze inside the drop
 * while the format had already hoisted it; the runtime carries `SceneryKit.haze`
 * now, so there is nothing left to take away and the format's own shape is the
 * runtime's. Kept as a name because the layout's sections are named types and a
 * reader looking for what a layout's `shelf` is should find it here.
 */
export type LayoutShelf = ShelfSpec;

/**
 * Distance haze, as a property of the scene.
 *
 * `ShelfSpec` owned this once, because a drop was the first thing that needed
 * one — and the format hoisted it out on the argument that a room, a cavern and
 * a meadow can all want air in front of the horizon without any of them having
 * a cliff. The runtime agrees now: `SceneryKit.haze` is where it lives, so the
 * compiler carries this straight across instead of folding it back down.
 */
export type LayoutHaze = HazeSpec;

/** The board's own albedo and the patches riding over it. */
export type LayoutGround = GroundComposition;

// --- The envelope -----------------------------------------------------------

/**
 * Which fight a layout dresses.
 *
 * The two shapes are the two `EncounterContext` has, and they resolve to the
 * one key `sceneryFor` already looks a kit up under — see {@link layoutKey}.
 * Stated as terrain-and-blight rather than as the joined string because the two
 * facts are edited separately: a designer picks a biome and then decides
 * whether this is the haunted one, and `"danger_mountain"` is a spelling that
 * can be got wrong in a text field.
 */
export type LayoutContext =
  | { kind: 'surface'; terrain: TileType; danger: boolean }
  | { kind: 'location'; location: LocationId }
  // A world hex with an arena of its own (Jadeveil: Kairen's summit), `EncounterContext.site`
  // A shrine's courtyard is dressed per band (`shrine_1` … `shrine_4`); `band` says which, the
  // fourth when absent, as `siteContext('shrine')` is
  | { kind: 'site'; site: ArenaSite; band?: number }
  // One of Jadeveil's grounds, plain or haunted, `EncounterContext.jade` (the shrine's paving is a site)
  | { kind: 'jade'; ground: ArenaJadeGround; danger: boolean }
  // A held village, where its garrison is fought, `EncounterContext.village` (`village_<theme>`)
  | { kind: 'village'; village: ArenaVillage }
  // One of the archipelago's grounds, `EncounterContext.isle` (`isle_beach`, `isle_jungle`, `isle_rock`)
  | { kind: 'isle'; ground: IsleGround };

/** The Jadeveil grounds with an arena of their own; shrine paving is fought at the `shrine` site. */
export type ArenaJadeGround = Exclude<JadeGround, 'shrine'>;

/**
 * One piece a designer put somewhere, plus the handle the editor needs on it.
 *
 * **Borrowed rather than restated**, the rule the whole file is built on:
 * {@link ScenicPlacement} is the runtime's own type, so the composer and the
 * format cannot come to disagree about what a dropped object is. What the layout
 * adds is the one field the runtime has no use for.
 *
 * The geometry, and why it is in world units rather than hexes, is documented
 * where the type is — `sceneryKits.ts`.
 */
export interface LayoutPlacement extends ScenicPlacement {
  /**
   * The editor's own handle on this piece, stable across saves.
   *
   * Not an identity the runtime has any use for — two placements of one crag
   * are the same crag to everything downstream, and `compileArenaLayout` drops
   * it on the way through. It exists so an undo stack, a selection and a
   * hierarchy pane survive a round trip through the file, which is the one thing
   * a positional index cannot do once anything is inserted.
   */
  id?: string;
  /**
   * The composition this piece belongs to, by name.
   *
   * **A membership rather than a table**, which is the format's own
   * "derived, never listed" habit: the set of groups a layout holds is exactly
   * the set of names its placements carry, so a group cannot exist with no
   * members and cannot silently lose them to an edit somewhere else. A gate, a
   * camp or a ruin is then moved as one composition by selecting the name —
   * while every member keeps its own `x`, `z`, `turn`, `scale` and `lift` and
   * is serialised by them.
   *
   * **The offsets stay absolute on purpose.** A group with a transform of its
   * own would write its members in group-local coordinates, so a reviewer
   * reading the file could no longer tell where anything stands without
   * composing the arrangement in their head — and every member would move the
   * day somebody nudged the parent. What the editor needs from a group is that
   * the pieces are *selected* together; the arithmetic that keeps them rigid
   * already exists, in the multi-piece grip.
   *
   * Dropped by `compileArenaLayout` beside `id`: the runtime has no use for it,
   * because `placementProps` composes each piece on its own either way.
   */
  group?: string;
  /**
   * Which of the kit's own rules first produced this piece, when one did.
   *
   * **Absent means a person put it there**, and that is the whole of the field:
   * a layout starts empty, everything a designer drops carries no `origin`, and
   * the only thing that ever writes one is a bake — the import that evaluates a
   * code-authored kit at a seed and hands back its output as pieces that can be
   * moved. Without it the two are the same thing the moment the bake finishes,
   * because every baked piece is a placement and every placement is
   * `PropSource` `'placement'`: a designer would be looking at eight hundred
   * identical rows with no way to ask which of them they had fixed by hand.
   *
   * A default spelled by its absence, the rule `quantise` already keeps for
   * `turn`, `scale` and `lift`: writing `origin` on a hand-placed piece would be
   * a diff on a file that is character for character equivalent.
   *
   * **Descriptive, never load-bearing.** Nothing about how a piece composes,
   * fits, draws or is selected reads it — `compileArenaLayout` drops it beside
   * `id` and `group`, so the runtime cannot see one at all. It is a note about
   * where the piece came from, kept so that provenance survives the file rather
   * than living in a variable that dies at the first save.
   */
  origin?: PropSource;
}

/** What the editor wants to remember, and the runtime never reads. */
export interface LayoutMeta {
  /** Why the composition is the way it is, in the author's own words. */
  notes?: string;
  /** ISO timestamp of the last save. */
  updatedAt?: string;
  author?: string;
  /** Which build of the editor wrote it, for reading a bug report. */
  editor?: string;
}

/**
 * One authored arena.
 *
 * Optional everywhere the kit is optional, and for the kit's reason: a surface
 * with no shelf, no water and no wall is not an unfinished arena, it is a
 * meadow. `version`, `id`, `title`, `context` and `scatter` are the five a
 * layout cannot be without — the last because the three tiers are what the
 * composer falls back through, and a kit with an empty canopy is a decision
 * (`CASTLE_HALL` makes it) while a kit with no canopy *field* is a hole.
 */
export interface ArenaLayoutV1 {
  version: typeof ARENA_LAYOUT_VERSION;
  /** Stable identity, and the file's own name. Matched by `extends`. */
  id: string;
  /** What to call it in the editor's own lists. */
  title: string;
  context: LayoutContext;
  /**
   * The id of a layout this one is a variant of.
   *
   * **The blighted half of the roster is the argument.** Eight of the eighteen
   * kits are one surface at dusk — the same ground, the same landforms, dead
   * vegetation and a colder light — and today each is a complete second literal
   * carrying its own copy of everything that did not change. A variant that
   * says what it *differs* by is a variant a reviewer can read.
   *
   * The merge is shallow over the top-level sections and an array replaces
   * rather than appends: a blighted kit swapping its canopy list means exactly
   * that list, and a rule that concatenated would make removing a live tree
   * impossible. Resolving it is the normalisation step's job — this field is
   * the declaration, and {@link validateArenaLayout} refuses a name that
   * resolves to nothing when it is given the set of layouts that exist.
   */
  extends?: string;
  /** Extra depth for the initial camera fit, for tall authored landmarks. */
  framingDepth?: number;
  scatter: LayoutScatter;
  /** Pieces placed by hand, in world units about the board's centre. */
  placements?: LayoutPlacement[];
  /** Guaranteed single pieces, spread by bearing. */
  focal?: FocalAnchor[];
  /** Compositions: several pieces at fixed offsets about one bearing. */
  groups?: FocalGroup[];
  /** A rhythm of pillars one course inside the wall. */
  colonnade?: Colonnade;
  /** A continuous enclosure, or separated masses. */
  wall?: WallRing;
  /** Directions the rolled tiers and the ground cover stand back from. */
  quiet?: QuietSector[];
  /** Where the land ends and how far it falls. */
  shelf?: LayoutShelf;
  /** The ground past the board rising into hills. See `HillSpec`. */
  hills?: HillSpec;
  /** A bounded area of water, claimed before the tiers. */
  water?: WaterRegion;
  /** The board's own albedo and the patches over it. */
  ground?: LayoutGround;
  /** Air in front of the horizon. */
  haze?: LayoutHaze;
  /**
   * Point lights stated outright, over and above what the fixtures carry.
   *
   * At the top level beside `placements` because both are the same kind of
   * thing — *this*, *there* — and because a light is emphatically not texture:
   * `LayoutScatter` is what a rate rolls, and nothing about a light is rolled.
   * Bounded by {@link AuthoredLight}; they share the fixtures' budget.
   */
  lights?: AuthoredLight[];
  meta?: LayoutMeta;
}

/**
 * The key a layout's composition is looked up under.
 *
 * The same string `sceneryFor` derives, and `arenaLayout.test.ts` pins the two
 * against each other over every terrain, both blights and every location —
 * because a second answer to "which kit is this" is how the castle ends up
 * inside a lair, which is the fault `encounterContext` was written to end.
 */
export function layoutKey(context: LayoutContext): string {
  if (context.kind === 'location') return context.location;
  if (context.kind === 'site') {
    return context.site === 'shrine' ? `shrine_${Math.min(4, Math.max(1, Math.round(context.band ?? 4)))}` : context.site;
  }
  if (context.kind === 'jade') return `${context.danger ? 'danger_' : ''}jade_${context.ground}`;
  if (context.kind === 'village') return `village_${context.village}`;
  if (context.kind === 'isle') return `isle_${context.ground}`;
  return context.danger ? `danger_${context.terrain}` : context.terrain;
}

// --- Validation -------------------------------------------------------------

/**
 * One thing wrong with a file, and where.
 *
 * A path rather than a sentence naming the field, because the same word appears
 * at six depths — `keys` is on a wall, on an arc, on a shelf's `below` and on a
 * colonnade — and "keys must be an array of strings" is not an error anybody
 * can act on. `shelf.edges[1].radius` is.
 */
export interface LayoutIssue {
  path: string;
  message: string;
}

/** Thrown by {@link parseArenaLayout}; carries every issue, not just the first. */
export class ArenaLayoutError extends Error {
  readonly issues: readonly LayoutIssue[];

  constructor(issues: readonly LayoutIssue[]) {
    super(
      issues.length === 1
        ? `Invalid arena layout: ${where(issues[0])} ${issues[0].message}` // i18n-exempt: arena layout validation message for authors
        : `Invalid arena layout (${issues.length} problems):\n` // i18n-exempt: arena layout validation message for authors
          + issues.map((issue) => `  ${where(issue)} ${issue.message}`).join('\n'),
    );
    this.name = 'ArenaLayoutError';
    this.issues = issues;
    // A downlevelled `Error` subclass loses its prototype, and an error whose
    // `instanceof` is false is an error nobody can catch by type.
    Object.setPrototypeOf(this, ArenaLayoutError.prototype);
  }
}

/** `shelf.edges[0].radius must be…`, and just `must be…` at the root. */
const where = (issue: LayoutIssue): string => (issue.path ? `${issue.path}` : 'the layout'); // i18n-exempt: arena layout validation message for authors

/**
 * One node's validator, and — for a node with structure — a description of that
 * structure the rest of the file can walk.
 *
 * **The metadata is what keeps the serializer and the asset walk from being
 * second copies of the format.** Deterministic output needs a key order per
 * node and "which keys name art" needs a list of fields; both are already
 * written down here, in the specs, and both were about to be written down a
 * second time as a table of paths. A function object carrying its own shape is
 * the cheapest way to say them once: a field added to a spec is ordered and
 * walked the moment the validator learns about it, rather than the moment
 * somebody remembers two other lists exist.
 */
interface Check {
  (value: unknown, path: string, issues: LayoutIssue[]): void;
  /** How this node is built, for {@link normalizeArenaLayout} and the asset walk. */
  shape?: Shape;
  /** True where the string being checked is the key of a piece of art. */
  asset?: true;
}

type Shape =
  | { of: 'object'; fields: Record<string, Field<boolean>> }
  | { of: 'list'; item: Check }
  /** A node whose fields depend on its own contents — `context`, and only it. */
  | { of: 'either'; pick: (value: Record<string, unknown>) => Check };

const shaped = (check: Check, shape: Shape): Check => Object.assign(check, { shape });

/**
 * One field of one node, and **whether it is optional is read off the type
 * rather than written down.**
 *
 * That is the whole reason the spec is shaped this way. A hand-written
 * `required: true` beside an interface that says `radius?: number` is a copy
 * with nothing comparing it, and it fails in the quiet direction — the
 * validator demands a field the format allows to be absent, so a legal layout
 * is refused and the refusal reads as a fault in the file. `undefined extends
 * T[K]` asks the interface instead, so the two cannot disagree.
 */
type Field<Optional extends boolean> = { optional: Optional; check: Check };

/**
 * Every field of `T`, and nothing else.
 *
 * A mapped type over `keyof Required<T>`, so a field added to any borrowed
 * interface — `SceneryKit`, `ShelfSpec`, `WaterRegion`, `GroundPatch` — is a
 * `npm run typecheck` failure here until the format decides what it means. That
 * is the guard that lets this file borrow those types instead of restating
 * them: the borrowing is checked rather than trusted.
 */
type FieldSpec<T> = {
  [K in keyof Required<T>]: undefined extends T[K] ? Field<true> : Field<false>;
};

const req = (check: Check): Field<false> => ({ optional: false, check });
const opt = (check: Check): Field<true> => ({ optional: true, check });

const fail = (issues: LayoutIssue[], path: string, message: string) => {
  issues.push({ path, message });
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array'; // i18n-exempt: arena layout validation message for authors
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object') return 'an object'; // i18n-exempt: arena layout validation message for authors
  return String(value);
}

const str: Check = (value, path, issues) => {
  if (typeof value !== 'string') fail(issues, path, `must be a string, got ${describe(value)}`); // i18n-exempt: arena layout validation message for authors
  else if (value.trim() === '') fail(issues, path, 'must not be empty'); // i18n-exempt: arena layout validation message for authors
};

const num: Check = (value, path, issues) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(issues, path, `must be a finite number, got ${describe(value)}`); // i18n-exempt: arena layout validation message for authors
  }
};

const int: Check = (value, path, issues) => {
  if (!Number.isSafeInteger(value)) {
    fail(issues, path, `must be a whole number, got ${describe(value)}`); // i18n-exempt: arena layout validation message for authors
  }
};

const bool: Check = (value, path, issues) => {
  if (typeof value !== 'boolean') fail(issues, path, `must be true or false, got ${describe(value)}`); // i18n-exempt: arena layout validation message for authors
};

/** A hex colour, because every colour in the display layer is one. */
const colour: Check = (value, path, issues) => {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    fail(issues, path, `must be a #rrggbb colour, got ${describe(value)}`); // i18n-exempt: arena layout validation message for authors
  }
};

const between = (min: number, max: number): Check => (value, path, issues) => {
  const before = issues.length;
  num(value, path, issues);
  if (issues.length !== before) return;
  const held = value as number;
  if (held < min || held > max) fail(issues, path, `must be between ${min} and ${max}, got ${held}`); // i18n-exempt: arena layout validation message for authors
};

const atLeast = (min: number): Check => (value, path, issues) => {
  const before = issues.length;
  num(value, path, issues);
  if (issues.length === before && (value as number) < min) {
    fail(issues, path, `must be at least ${min}, got ${value as number}`); // i18n-exempt: arena layout validation message for authors
  }
};

const oneOf = (allowed: readonly string[]): Check => (value, path, issues) => {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(issues, path, `must be one of ${allowed.join(', ')}; got ${describe(value)}`); // i18n-exempt: arena layout validation message for authors
  }
};

const list = (item: Check, { min = 0 } = {}): Check => shaped((value, path, issues) => {
  if (!Array.isArray(value)) {
    fail(issues, path, `must be an array, got ${describe(value)}`); // i18n-exempt: arena layout validation message for authors
    return;
  }
  if (value.length < min) {
    fail(issues, path, `must hold at least ${min} entr${min === 1 ? 'y' : 'ies'}`); // i18n-exempt: arena layout validation message for authors
  }
  value.forEach((entry, i) => item(entry, `${path}[${i}]`, issues));
}, { of: 'list', item });

// The null carries no structure of its own, so the inner shape passes straight
// through: `horizon` is a list of keys whether or not this particular kit
// declared that nothing stands out there.
const orNull = (check: Check): Check => {
  const wrapped: Check = (value, path, issues) => {
    if (value !== null) check(value, path, issues);
  };
  return check.shape ? shaped(wrapped, check.shape) : wrapped;
};

/** A world position: three finite numbers, in the board's own units. */
const triple: Check = (value, path, issues) => {
  if (!Array.isArray(value) || value.length !== 3) {
    fail(issues, path, `must be three world coordinates, got ${describe(value)}`); // i18n-exempt: arena layout validation message for authors
    return;
  }
  value.forEach((axis, i) => num(axis, `${path}[${i}]`, issues));
};

/** A per-channel multiplier: three numbers, none of them brightening. */
const tint: Check = (value, path, issues) => {
  if (!Array.isArray(value) || value.length !== 3) {
    fail(issues, path, `must be three channel multipliers, got ${describe(value)}`); // i18n-exempt: arena layout validation message for authors
    return;
  }
  value.forEach((channel, i) => between(0, 1)(channel, `${path}[${i}]`, issues));
};

/**
 * An object against its spec, refusing keys the spec does not name.
 *
 * **An unknown key is reported rather than dropped**, which is the opposite of
 * what a permissive reader would do and is the right way round for a file a
 * person edits. A mistyped `bearings` silently ignored is a landmark that does
 * not appear and no reason given; named, it is a typo anybody can fix.
 */
const obj = <T>(spec: FieldSpec<T>): Check => shaped((value, path, issues) => {
  if (!isPlainObject(value)) {
    fail(issues, path, `must be an object, got ${describe(value)}`); // i18n-exempt: arena layout validation message for authors
    return;
  }
  const fields = spec as Record<string, Field<boolean>>;
  for (const [name, field] of Object.entries(fields)) {
    const at = path ? `${path}.${name}` : name;
    const held = value[name];
    if (held === undefined) {
      if (!field.optional) fail(issues, at, 'is required'); // i18n-exempt: arena layout validation message for authors
      continue;
    }
    field.check(held, at, issues);
  }
  for (const name of Object.keys(value)) {
    if (!(name in fields)) {
      fail(issues, path ? `${path}.${name}` : name, 'is not part of an arena layout'); // i18n-exempt: arena layout validation message for authors
    }
  }
}, { of: 'object', fields: spec as Record<string, Field<boolean>> });

const TIER: Check = oneOf(TIER_ORDER);

/**
 * A string that names a piece of art, as opposed to one that names anything
 * else.
 *
 * Identical to {@link str} as a validator — whether the key resolves to
 * something drawable is a question about the roster and this module may not
 * reach it. What the mark buys is {@link layoutAssetKeys}: the nine fields that
 * name art are declared here, once, beside the fields themselves, instead of as
 * a list of paths kept in step by hand somewhere that would go quiet the day a
 * tenth arrived.
 */
const assetKey: Check = Object.assign(
  (value: unknown, path: string, issues: LayoutIssue[]) => str(value, path, issues),
  { asset: true as const },
);

const KEYS: Check = list(assetKey, { min: 1 });

const bandSpec: FieldSpec<AxisBand> = {
  bearing: req(num),
  halfWidth: req(atLeast(0)),
};

const patchSpec: FieldSpec<GroundPatch> = {
  tint: req(tint),
  threshold: req(between(0, 1)),
  ramp: req(atLeast(0)),
  scale: req(atLeast(0)),
  salt: req(num),
  band: opt(obj(bandSpec)),
};

const floorSpec: FieldSpec<NonNullable<GroundComposition['floor']>> = {
  tile: req(colour),
  ground: req(colour),
};

const groundSpec: FieldSpec<LayoutGround> = {
  floor: opt(obj(floorSpec)),
  patches: req(list(obj(patchSpec))),
};

const anchorSpec: FieldSpec<FocalAnchor> = {
  key: req(assetKey),
  tier: req(TIER),
  count: req(atLeast(1)),
  depth: req(int),
  bearing: opt(num),
};

const pieceSpec: FieldSpec<GroupPiece> = {
  key: req(assetKey),
  tier: req(TIER),
  across: req(num),
  along: req(num),
  scale: opt(atLeast(0)),
  turn: opt(num),
  lift: opt(num),
};

const groupSpec: FieldSpec<FocalGroup> = {
  bearing: req(num),
  depth: req(int),
  pieces: req(list(obj(pieceSpec), { min: 1 })),
  afloat: opt(bool),
};

const colonnadeSpec: FieldSpec<Colonnade> = {
  keys: req(KEYS),
  depth: req(int),
  beat: req(atLeast(1)),
};

const arcSpec: FieldSpec<BoundaryArc> = {
  bearing: req(num),
  sweep: req(atLeast(0)),
  keys: opt(KEYS),
  depth: opt(int),
  scale: opt(atLeast(0)),
};

const wallSpec: FieldSpec<WallRing> = {
  keys: req(KEYS),
  depth: req(int),
  arcs: opt(list(obj(arcSpec))),
};

const quietSpec: FieldSpec<QuietSector> = {
  bearing: req(num),
  sweep: req(atLeast(0)),
  density: opt(between(0, 1)),
};

const edgeSpec: FieldSpec<ShelfEdge> = {
  bearing: req(num),
  sweep: req(atLeast(0)),
  radius: req(atLeast(0)),
};

const crestSpec: FieldSpec<ShelfCrest> = {
  bearing: req(num),
  sweep: req(atLeast(0)),
  distance: req(atLeast(0)),
  count: req(atLeast(1)),
};

const belowSpec: FieldSpec<NonNullable<ShelfSpec['below']>> = {
  keys: req(KEYS),
  count: req(atLeast(1)),
  crest: opt(obj(crestSpec)),
};

const hazeSpec: FieldSpec<LayoutHaze> = {
  color: req(colour),
  near: req(atLeast(0)),
  far: req(atLeast(0)),
};

/**
 * Three numbers and a colour, and the two that are bounded are bounded *here*
 * rather than in the editor.
 *
 * The ceilings belong to `LIGHT_BUDGET`, which is a system — this module may
 * not reach one — so what the format states is the shape and the sign, and the
 * numbers it cannot see are checked by `arenaCatalogue.layoutLightIssues`, the
 * same split `layoutAssetKeys` already makes for a key that names art. A
 * validator that guessed a ceiling would be a second answer to how bright a
 * light may be, drifting from the composer's the day either moved.
 */
const lightSpec: FieldSpec<AuthoredLight> = {
  at: req(triple),
  color: req(colour),
  intensity: req(atLeast(0)),
  distance: req(atLeast(0)),
};

const shelfSpec: FieldSpec<LayoutShelf> = {
  edges: req(list(obj(edgeSpec), { min: 1 })),
  drop: req(atLeast(0)),
  steps: req(atLeast(1)),
  tread: req(atLeast(0)),
  face: req(colour),
  lower: req(colour),
  sea: opt(bool),
  below: opt(obj(belowSpec)),
};

const riseSpec: FieldSpec<HillRise> = {
  bearing: req(num),
  sweep: req(atLeast(0)),
  height: req(atLeast(0)),
  from: opt(atLeast(0)),
  run: opt(atLeast(0)),
};

const backSpec: FieldSpec<HillBack> = {
  key: req(assetKey),
  height: req(atLeast(0)),
  reach: req(atLeast(0)),
  width: req(atLeast(0)),
};

const snowSpec: FieldSpec<NonNullable<HillSpec['snow']>> = {
  above: req(atLeast(0)),
  color: req(colour),
};

const veinSpec: FieldSpec<NonNullable<CaveSpec['veins']>> = {
  colors: req(list(colour, { min: 1 })),
  share: req(between(0, 1)),
};

const caveSpec: FieldSpec<CaveSpec> = {
  wall: req(atLeast(0)),
  ceiling: req(atLeast(0)),
  stone: req(list(colour, { min: 1 })),
  veins: opt(obj(veinSpec)),
};

const rowsSpec: FieldSpec<NonNullable<TerraceSpec['rows']>> = {
  keys: req(KEYS),
  every: req(atLeast(0)),
  share: req(between(0, 1)),
  reach: req(atLeast(0)),
};

const terraceSpec: FieldSpec<TerraceSpec> = {
  step: req(atLeast(0)),
  stone: req(list(colour, { min: 1 })),
  joint: req(colour),
  paddy: opt(colour),
  rows: opt(obj(rowsSpec)),
};

const hillsSpec: FieldSpec<HillSpec> = {
  rises: req(list(obj(riseSpec), { min: 1 })),
  from: req(atLeast(0)),
  run: req(atLeast(0)),
  relief: req(between(0, 1)),
  backs: opt(list(obj(backSpec))),
  level: opt(list(assetKey)),
  turf: req(list(colour, { min: 1 })),
  earth: req(colour),
  rock: req(colour),
  snow: opt(obj(snowSpec)),
  cave: opt(obj(caveSpec)),
  terrace: opt(obj(terraceSpec)),
};

const waterSpec: FieldSpec<WaterRegion> = {
  shape: req(oneOf(['pools', 'course'])),
  color: req(colour),
  bank: opt(KEYS),
  near: req(int),
  far: req(int),
  treed: opt(bool),
  coverage: opt(between(0, 1)),
  bearing: opt(num),
  sweep: opt(atLeast(0)),
  // The focal a watercourse flows out of, matched against a placed prop's own
  // key — so it names art exactly as the lists above do.
  source: opt(assetKey),
};

const coverSpec: FieldSpec<NonNullable<LayoutScatter['cover']>> = {
  threshold: opt(between(0, 1)),
  near: opt(atLeast(0)),
};

const rateSpec: FieldSpec<NonNullable<DressingSpec['rate']>> = {
  canopy: opt(between(0, 1)),
  thicket: opt(between(0, 1)),
  ground: opt(between(0, 1)),
};

const sizeSpec: FieldSpec<NonNullable<DressingSpec['scale']>> = {
  min: req(atLeast(0)),
  max: req(atLeast(0)),
};

/**
 * A pull above 1 is legal and is how a kit turns the rule off: the feature
 * field never reaches it, so nothing is ever turned to face anything. Refusing
 * it would take away the only spelling of "these are round, leave them alone".
 */
const turnSpec: FieldSpec<NonNullable<DressingSpec['turn']>> = {
  pull: opt(atLeast(0)),
  jitter: opt(atLeast(0)),
};

const dressingSpec: FieldSpec<DressingSpec> = {
  rate: opt(obj(rateSpec)),
  scale: opt(obj(sizeSpec)),
  turn: opt(obj(turnSpec)),
};

/** The ground past the ring the camera reaches. See `EdgeFill`. */
const fillBelowSpec: FieldSpec<NonNullable<EdgeFill['below']>> = {
  under: req(list(assetKey)),
  low: req(list(assetKey)),
  share: opt(between(0, 1)),
};

/** What stands out in the fill's water. See `EdgeFill.afloat`. */
const fillAfloatSpec: FieldSpec<NonNullable<EdgeFill['afloat']>> = {
  keys: req(list(assetKey)),
  share: req(between(0, 1)),
};

const fillSpec: FieldSpec<NonNullable<LayoutScatter['fill']>> = {
  far: req(list(assetKey)),
  distant: opt(list(assetKey)),
  under: req(list(assetKey)),
  low: req(list(assetKey)),
  clump: opt(atLeast(1)),
  from: req(atLeast(0)),
  share: req(between(0, 1)),
  water: opt(between(0, 1)),
  afloat: opt(obj(fillAfloatSpec)),
  deeper: opt(atLeast(0)),
  wider: opt(atLeast(0)),
  below: opt(obj(fillBelowSpec)),
};

/** Ground left open on purpose, and its dunes. See `OpenGround`. */
const openGroundSpec: FieldSpec<NonNullable<LayoutScatter['openGround']>> = {
  threshold: req(between(0, 1)),
  scale: req(atLeast(0)),
  clearing: opt(atLeast(0)),
  front: opt(bool),
  dunes: req(list(assetKey)),
  dune: req(between(0, 1)),
  wind: req(num),
};

const scatterSpec: FieldSpec<LayoutScatter> = {
  canopy: req(list(assetKey)),
  thicket: req(list(assetKey)),
  ground: req(list(assetKey)),
  groundCover: opt(list(assetKey)),
  cover: opt(obj(coverSpec)),
  horizon: opt(orNull(list(assetKey))),
  enclosure: opt(between(0, 1)),
  // A statement about what this kit's canopy *is*, and therefore texture
  // rather than a placement: a kit whose enclosure is a `wall` has a canopy
  // that is planting, and planting gathers. See `SceneryKit.canopyGathers`.
  canopyGathers: opt(bool),
  dressing: opt(obj(dressingSpec)),
  fill: opt(obj(fillSpec)),
  openGround: opt(obj(openGroundSpec)),
};

const placementSpec: FieldSpec<LayoutPlacement> = {
  key: req(assetKey),
  tier: req(TIER),
  x: req(num),
  z: req(num),
  lift: opt(num),
  scale: opt(atLeast(0)),
  turn: opt(num),
  id: opt(str),
  group: opt(str),
  origin: opt(oneOf(PROP_SOURCES)),
};

const metaSpec: FieldSpec<LayoutMeta> = {
  notes: opt(str),
  updatedAt: opt(str),
  author: opt(str),
  editor: opt(str),
};

const TERRAINS: readonly string[] = Object.values(TileType);

/**
 * Written out rather than derived, because `LocationId` is a union of string
 * literals and a union is erased — there is nothing at runtime to enumerate.
 * `arenaLayout.test.ts` pins this list against every id the location roster
 * actually builds, which is the check a derivation would have given for free.
 */
const LOCATIONS: readonly LocationId[] = [
  'city', 'lair_warren', 'lair_barrow', 'lair_wyrm', 'castle',
  // Jadeveil: Silent Hall / Fallen Order
  'lair_hall',
  // Jadeveil: Silk Hollow / Yokai
  'lair_silk',
];

/** Every world site with an arena of its own; `ArenaSite` written out, as `LOCATIONS` is. */
export const ARENA_SITES: readonly ArenaSite[] = [
  'summit', 'shrine',
  // The archipelago's places (the private project notes)
  'deck', 'deck_storm', 'port', 'battery', 'pirate_fort', 'lair_hull', 'lair_grotto',
];

/** Every archipelago ground with an arena of its own; `IsleGround` written out. */
export const ARENA_ISLE_GROUNDS: readonly IsleGround[] = ['beach', 'jungle', 'rock'];

const isleContextSpec: FieldSpec<Extract<LayoutContext, { kind: 'isle' }>> = {
  kind: req(oneOf(['isle'])),
  ground: req(oneOf(ARENA_ISLE_GROUNDS)),
};

/** A village with an arena of its own: every one (`MapTile.village`). */
export type ArenaVillage = NonNullable<MapTile['village']>;

/** Every village theme, written out as `LOCATIONS` is (`data/villages`' `VILLAGE_THEMES`). */
export const ARENA_VILLAGES: readonly ArenaVillage[] = ['lookout', 'trading_post', 'smithy', 'shrine'];

/** Every Jadeveil ground with an arena of its own; `ArenaJadeGround` written out. */
export const ARENA_JADE_GROUNDS: readonly ArenaJadeGround[] = ['moss', 'bamboo', 'terrace', 'ridge', 'crown'];

const jadeContextSpec: FieldSpec<Extract<LayoutContext, { kind: 'jade' }>> = {
  kind: req(oneOf(['jade'])),
  ground: req(oneOf(ARENA_JADE_GROUNDS)),
  danger: req(bool),
};

const villageContextSpec: FieldSpec<Extract<LayoutContext, { kind: 'village' }>> = {
  kind: req(oneOf(['village'])),
  village: req(oneOf(ARENA_VILLAGES)),
};

const siteContextSpec: FieldSpec<Extract<LayoutContext, { kind: 'site' }>> = {
  kind: req(oneOf(['site'])),
  site: req(oneOf(ARENA_SITES)),
  band: opt(between(1, 4)),
};

const surfaceContextSpec: FieldSpec<Extract<LayoutContext, { kind: 'surface' }>> = {
  kind: req(oneOf(['surface'])),
  terrain: req(oneOf(TERRAINS)),
  danger: req(bool),
};

const locationContextSpec: FieldSpec<Extract<LayoutContext, { kind: 'location' }>> = {
  kind: req(oneOf(['location'])),
  location: req(oneOf(LOCATIONS)),
};

/**
 * Which of the two shapes a context is, decided by `kind` before anything else.
 *
 * Checking both and keeping the shorter complaint is the tempting spelling and
 * it is useless: a mistyped terrain would come back as "kind must be location",
 * which points at the one field that was right.
 */
const surfaceContext = obj(surfaceContextSpec);
const locationContext = obj(locationContextSpec);
const siteContext = obj(siteContextSpec);
const jadeContext = obj(jadeContextSpec);
const villageContext = obj(villageContextSpec);
const isleContext = obj(isleContextSpec);

const contextSpec: Check = shaped((value, path, issues) => {
  if (!isPlainObject(value)) {
    fail(issues, path, `must be an object, got ${describe(value)}`); // i18n-exempt: arena layout validation message for authors
    return;
  }
  if (value.kind === 'location') locationContext(value, path, issues);
  else if (value.kind === 'surface') surfaceContext(value, path, issues);
  else if (value.kind === 'site') siteContext(value, path, issues);
  else if (value.kind === 'jade') jadeContext(value, path, issues);
  else if (value.kind === 'village') villageContext(value, path, issues);
  else if (value.kind === 'isle') isleContext(value, path, issues);
  else fail(issues, `${path}.kind`, `must be one of surface, location, site, jade, village, isle; got ${describe(value.kind)}`); // i18n-exempt: arena layout validation message for authors
}, {
  of: 'either',
  pick: (value) => (value.kind === 'location' ? locationContext : value.kind === 'site' ? siteContext
    : value.kind === 'jade' ? jadeContext : value.kind === 'village' ? villageContext
    : value.kind === 'isle' ? isleContext : surfaceContext),
});

const layoutSpec: FieldSpec<Omit<ArenaLayoutV1, 'version'>> = {
  id: req(str),
  title: req(str),
  context: req(contextSpec),
  extends: opt(str),
  framingDepth: opt(atLeast(0)),
  scatter: req(obj(scatterSpec)),
  placements: opt(list(obj(placementSpec))),
  focal: opt(list(obj(anchorSpec))),
  groups: opt(list(obj(groupSpec))),
  colonnade: opt(obj(colonnadeSpec)),
  wall: opt(obj(wallSpec)),
  quiet: opt(list(obj(quietSpec))),
  shelf: opt(obj(shelfSpec)),
  hills: opt(obj(hillsSpec)),
  water: opt(obj(waterSpec)),
  ground: opt(obj(groundSpec)),
  haze: opt(obj(hazeSpec)),
  lights: opt(list(obj(lightSpec))),
  meta: opt(obj(metaSpec)),
};

const layoutCheck = obj(layoutSpec);

/** What {@link validateArenaLayout} may additionally be told about the world. */
export interface LayoutValidationOptions {
  /**
   * Every layout id that exists, so `extends` can be resolved.
   *
   * Omitted, an `extends` is checked for shape and taken on trust — a single
   * file read on its own genuinely does not know what else is on disk. Given, a
   * name that resolves to nothing is an issue rather than a silent inheritance
   * of nothing: the rule `dependsOn` follows on the project board, and for its
   * reason. The parent was probably renamed, and assuming it away ships a
   * layout missing everything it did not restate.
   */
  known?: Iterable<string>;
}

/**
 * Everything wrong with a candidate layout, or an empty array.
 *
 * **The version is read first and alone.** A file from a later editor is not a
 * malformed file — it is a file this build has no business interpreting — so it
 * is refused by number and nothing else is reported, or the reader would be
 * handed a page of complaints about fields whose meaning it does not know.
 */
export function validateArenaLayout(
  value: unknown,
  options: LayoutValidationOptions = {},
): LayoutIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: '', message: `must be a JSON object, got ${describe(value)}` }]; // i18n-exempt: arena layout validation message for authors
  }
  if (value.version === undefined) {
    return [{
      path: 'version',
      message: `is required; this build reads version ${ARENA_LAYOUT_VERSION}`, // i18n-exempt: arena layout validation message for authors
    }];
  }
  const readable = readableLayoutVersions();
  if (!readable.includes(value.version as number)) {
    return [{
      path: 'version',
      message: `is an unsupported arena layout version ${describe(value.version)}; ` // i18n-exempt: arena layout validation message for authors
        + `this build reads ${readable.join(', ')}`, // i18n-exempt: arena layout validation message for authors
    }];
  }

  // Upgraded first, then measured. An older file is not a malformed one, and
  // reporting its own version's fields against this version's spec would bury
  // the reader in complaints about a file that is correct for what it says it is.
  const current = migrateArenaLayout(value);
  const issues: LayoutIssue[] = [];
  const { version: _version, ...rest } = current;
  layoutCheck(rest, '', issues);

  if (options.known && typeof current.extends === 'string') {
    if (current.extends === current.id) {
      fail(issues, 'extends', 'must name a different layout; a layout cannot inherit from itself'); // i18n-exempt: arena layout validation message for authors
    } else if (!new Set(options.known).has(current.extends)) {
      fail(issues, 'extends', `names no layout that exists: ${describe(current.extends)}`); // i18n-exempt: arena layout validation message for authors
    }
  }
  return issues;
}

/** True when `value` is a layout this build can read. */
export function isArenaLayout(value: unknown): value is ArenaLayoutV1 {
  return validateArenaLayout(value).length === 0;
}

/**
 * The layout, or an {@link ArenaLayoutError} naming everything wrong with it.
 *
 * Every issue rather than the first: a file is fixed in an editor, and one
 * complaint per save is a conversation instead of a correction.
 */
export function parseArenaLayout(
  value: unknown,
  options: LayoutValidationOptions = {},
): ArenaLayoutV1 {
  const issues = validateArenaLayout(value, options);
  if (issues.length > 0) throw new ArenaLayoutError(issues);
  // The *upgraded* layout, which for a current file is the identical object it
  // was handed -- the identity `compileArenaLayout`'s memo is keyed on.
  return migrateArenaLayout(value as Record<string, unknown>) as unknown as ArenaLayoutV1;
}

// --- Normalisation and serialisation ----------------------------------------

/**
 * The fields of a node, when the spec knows any.
 *
 * `undefined` for a leaf and for anything the spec does not describe -- which
 * both {@link normalizeArenaLayout} and {@link layoutAssetKeys} read as "keep
 * what is here and go no deeper".
 */
function fieldsOf(
  check: Check | undefined, value: Record<string, unknown>,
): Record<string, Field<boolean>> | undefined {
  const shape = check?.shape;
  if (shape?.of === 'object') return shape.fields;
  if (shape?.of === 'either') {
    const picked = shape.pick(value).shape;
    return picked?.of === 'object' ? picked.fields : undefined;
  }
  return undefined;
}

const itemOf = (check: Check | undefined): Check | undefined =>
  (check?.shape?.of === 'list' ? check.shape.item : undefined);

function orderNode(value: unknown, check: Check | undefined): unknown {
  if (Array.isArray(value)) {
    const item = itemOf(check);
    return value.map((entry) => orderNode(entry, item));
  }
  if (!isPlainObject(value)) return value;
  const fields = fieldsOf(check, value);
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields ?? {})) {
    if (value[name] === undefined) continue;
    out[name] = orderNode(value[name], field.check);
  }
  // **Anything the spec does not name is kept, at the end.** The validator
  // refuses an unknown key, so a layout that has been parsed has none -- and a
  // normaliser that silently dropped one would be the single thing this whole
  // pass must not do, which is change what a file says on the way through.
  for (const name of Object.keys(value)) {
    if (!(name in out) && value[name] !== undefined) out[name] = value[name];
  }
  return out;
}

/**
 * One layout in canonical form: the same layout, with its keys in one order.
 *
 * **Normalisation may not change what a layout means, and that is the whole
 * specification.** So it does exactly two things -- it puts every object's keys
 * in the order the format declares them, and it drops keys whose value is
 * `undefined`, which `JSON.stringify` drops anyway. It notably does *not*
 * reorder arrays: the composer places a kit's groups, anchors and placements in
 * array order and each claims hexes the next one then sees, so a sort would be
 * a composition change wearing the word "canonical". Nor does it drop an empty
 * array -- `horizon: null` and an absent `horizon` already mean two different
 * things, and a rule that tidied one emptiness would come for the other.
 *
 * The order is the one the specs are written in, read straight off them, so a
 * field added to the format lands in the right place in the file the moment the
 * validator knows about it.
 */
export function normalizeArenaLayout(layout: ArenaLayoutV1): ArenaLayoutV1 {
  const { version, ...rest } = layout as unknown as Record<string, unknown>;
  return { version, ...(orderNode(rest, layoutCheck) as object) } as unknown as ArenaLayoutV1;
}

/** Two-space JSON with a trailing newline -- what the shipped layouts are. */
export const LAYOUT_INDENT = 2;

/**
 * A layout as the text of a file, deterministically.
 *
 * The same layout always produces the same bytes, so a diff between two saves
 * is the edit and nothing else -- which is the whole reason the editor writes
 * through here rather than calling `JSON.stringify` at the save site. Keys come
 * out in the format's own declared order rather than sorted, because a reviewer
 * reading top-down wants `version`, `id`, `title`, `context` first; alphabetical
 * would open every arena on `canopy` and bury its name in the middle.
 */
export function serializeArenaLayout(layout: ArenaLayoutV1): string {
  return JSON.stringify(normalizeArenaLayout(layout), null, LAYOUT_INDENT) + '\n';
}

/** One key a layout names, and where it names it. */
export interface LayoutAssetRef {
  path: string;
  key: string;
}

/**
 * Every piece of art a layout names, with the path that named it.
 *
 * **Derived from the specs, not from a list of paths.** Nine fields across six
 * nodes name a prop key, and a hand-written walk of them is a list that goes
 * quiet rather than red the day a tenth arrives -- the failure mode this file
 * already refuses everywhere else. `assetKey` marks them where they are
 * declared; this collects whatever carries the mark.
 *
 * It resolves nothing: whether a key names something drawable is a question
 * about the model roster, and this module may not reach it. `arenaCatalogue.ts`
 * owns that answer and takes this as its input.
 */
export function layoutAssetKeys(layout: ArenaLayoutV1): LayoutAssetRef[] {
  const found: LayoutAssetRef[] = [];
  const walk = (value: unknown, check: Check | undefined, path: string) => {
    if (check?.asset && typeof value === 'string') {
      found.push({ path, key: value });
      return;
    }
    if (Array.isArray(value)) {
      const item = itemOf(check);
      value.forEach((entry, i) => walk(entry, item, `${path}[${i}]`));
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [name, field] of Object.entries(fieldsOf(check, value) ?? {})) {
      if (value[name] === undefined) continue;
      walk(value[name], field.check, path ? `${path}.${name}` : name);
    }
  };
  const { version: _version, ...rest } = layout as unknown as Record<string, unknown>;
  walk(rest, layoutCheck, '');
  return found;
}
