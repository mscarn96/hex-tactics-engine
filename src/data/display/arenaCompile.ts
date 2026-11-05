import { GROUND_COMPOSITION, GroundComposition } from './groundPatches';
import { SCENERY_KITS, SceneryKit, ScenicPlacement } from './sceneryKits';
import {
  ArenaLayoutError, ArenaLayoutV1, LayoutHaze, LayoutPlacement, layoutKey,
} from './arenaLayout';

/**
 * A layout, compiled into the things the composer already takes.
 *
 * **The second half of the boundary.** `arenaLayout.ts` says what an arena is as
 * a file; this says what that file *is* to the runtime, and the answer is
 * deliberately nothing new: a `SceneryKit`, a `GroundComposition` and the key
 * the two are looked up under. The seeded composer, the shelf, the water field
 * and the ground patches are untouched — a compiled layout goes down exactly the
 * paths `SCENERY_KITS` already goes down, which is what makes "the editor shows
 * you the game" a structural fact rather than a promise about two renderers
 * being kept in step.
 *
 * Three things it does, and they are the three the format declares and leaves
 * unresolved:
 *
 * - **Hoisted sections go back where the kit keeps them.** The format lifts
 *   every landmark to the top level so a tool can address one without walking a
 *   scatter list; the kit wants them inside it. `haze` used to be folded back
 *   onto the shelf it was lifted off and is not any more — the kit carries one
 *   of its own now, which is what the format had been saying all along.
 * - **`extends` is resolved.** The format declares inheritance and states that
 *   the merge is shallow over the top-level sections with arrays replacing
 *   rather than appending. This is that sentence as code.
 * - **The result is a singleton.** Not a nicety: `arenaScenery`'s composition
 *   memo is keyed on the kit's own object identity (`lastKit === kit`), so a
 *   compiler returning a fresh object per call would silently re-derive the
 *   enclosure, the water field and the feature sites on every frame of every
 *   fight. The memo is a `WeakMap` on the layout, so a layout the editor has
 *   thrown away takes its compiled kit with it.
 *
 * **Editor-safe**, the rule `arenaLayout.ts` and `arenaCatalogue.ts` already
 * follow: display data and nothing else. No `three`, no React, no React Native,
 * no store, no scene — so the compiler a tool runs is the compiler the game
 * runs, rather than a second one written to be importable.
 *
 * **What it deliberately does not do is judge the content.** Whether a key names
 * a prop that exists, whether a landmark stands where the fight is, whether the
 * scene fits its triangle budget — three separate questions with three tasks of
 * their own, and a compiler refusing a layout on any of them is an editor that
 * cannot show you what you have just done wrong.
 */
export interface CompiledArena {
  /** The key `sceneryFor` looks a composition up under — `mountain`, `castle`. */
  key: string;
  /** The composition, in the shape `ArenaScenery.kit` is already in. */
  kit: SceneryKit;
  /** The board's own albedo and the patches over it; `null` when unauthored. */
  composition: GroundComposition | null;
  /**
   * Air in front of the horizon, whether or not there is a drop under it.
   *
   * Carried here *as well as* folded onto `kit.shelf`, because the two answers
   * have two lifetimes. Folding it back is what keeps `arenaShelfProfile` — the
   * one thing reading haze today — working unchanged; carrying it is what lets a
   * room, a cavern or a meadow declare air without first inventing a cliff to
   * hang it on, which is the reason the format hoisted it in the first place.
   */
  haze: LayoutHaze | null;
}

const inheritanceError = (chain: readonly string[], message: string) =>
  new ArenaLayoutError([{ path: 'extends', message: `${message} (${chain.join(' -> ')})` }]);

/**
 * The sections a child may take from its parent.
 *
 * **`version`, `id`, `title` and `context` are never inherited**, and that is
 * the format speaking rather than a choice made here: all four are required of
 * every layout, so a child always carries its own. `scatter` is required too, so
 * it can only ever be the child's — it is listed anyway, because the day the
 * format makes it optional this line is already right.
 *
 * `meta` is not inherited either. It is the editor's note about *this file*, and
 * a variant silently claiming its parent's author and timestamp is a lie in the
 * one field somebody reads to work out who to ask.
 */
const INHERITED = [
  'framingDepth', 'scatter', 'placements', 'focal', 'groups', 'colonnade',
  'wall', 'quiet', 'shelf', 'hills', 'water', 'ground', 'haze',
] as const;

/**
 * One layout with its ancestry folded in.
 *
 * **Shallow over the top-level sections, and an array replaces rather than
 * appends.** The format states both and states why: a blighted variant swapping
 * its canopy list means exactly that list, and a rule that concatenated would
 * make *removing* a live tree impossible — the one edit the format could then
 * not express. Shallow for the matching reason: a child's `shelf` is a shelf,
 * not a patch over its parent's, and half-overriding a landform is a shape
 * nobody can picture from reading the file.
 *
 * Chains resolve, and a cycle is refused by name. `validateArenaLayout` already
 * refuses a layout inheriting from itself; A -> B -> A is the same fault with a
 * hop in it, and the only thing a resolver can do with one is recurse forever.
 */
export function resolveLayoutInheritance(
  layout: ArenaLayoutV1,
  known: ReadonlyMap<string, ArenaLayoutV1>,
): ArenaLayoutV1 {
  const chain: string[] = [layout.id];
  const ancestry: ArenaLayoutV1[] = [layout];
  let at = layout;
  while (at.extends !== undefined) {
    const parent = known.get(at.extends);
    if (!parent) {
      throw inheritanceError(
        [...chain, at.extends], `names no layout that exists: ${JSON.stringify(at.extends)}`, // i18n-exempt: arena layout validation message for authors
      );
    }
    if (chain.includes(parent.id)) throw inheritanceError([...chain, parent.id], 'is a cycle');
    chain.push(parent.id);
    ancestry.push(parent);
    at = parent;
  }
  if (ancestry.length === 1) return layout;

  // Oldest first, so a nearer ancestor overwrites a further one and the child
  // overwrites both. `extends` itself is dropped: the result *is* the
  // resolution, and a resolved layout still naming a parent would be resolved
  // twice the next time anything touched it.
  const merged: Record<string, unknown> = {
    version: layout.version,
    id: layout.id,
    title: layout.title,
    context: layout.context,
  };
  for (const source of [...ancestry].reverse()) {
    const held = source as unknown as Record<string, unknown>;
    for (const section of INHERITED) {
      if (held[section] !== undefined) merged[section] = held[section];
    }
  }
  if (layout.meta !== undefined) merged.meta = layout.meta;
  return merged as unknown as ArenaLayoutV1;
}

/**
 * A placement as the runtime wants it: the piece, without the editor's handles.
 *
 * Dropped rather than carried, and it costs a copy to do it. `ScenicPlacement`
 * is what the composer reads and none of `id`, `group` or `origin` is in it, so
 * leaving one on hands the runtime a field only the editor may write — which is
 * how a harmless extra becomes something two systems have an opinion about.
 * `group` in particular has no runtime meaning at all: `placementProps`
 * composes each piece on its own whether or not somebody has named it part of a
 * camp, and `origin` is a note about where the piece came from that the
 * composer would only be able to contradict — it tags every prop it emits
 * `'placement'`, which is the truth about a placed piece however it was
 * authored.
 */
const withoutEditorFields = (placement: LayoutPlacement): ScenicPlacement => {
  const { id: _id, group: _group, origin: _origin, ...piece } = placement;
  return piece;
};

/** One compiled arena per layout object, for the identity memo downstream. */
const compiled = new WeakMap<ArenaLayoutV1, CompiledArena>();

/** What {@link compileArenaLayout} may be told about the world around a layout. */
export interface CompileOptions {
  /**
   * Every layout that exists, so `extends` can be resolved.
   *
   * Omitted, a layout carrying an `extends` is one this call cannot compile, and
   * it says so rather than compiling the child alone: a variant silently missing
   * everything it did not restate renders perfectly and is wrong in a way
   * nothing can see. The argument `dependsOn` makes on the project board, and
   * the one `validateArenaLayout` already makes about a parent that resolves to
   * nothing.
   */
  known?: Iterable<ArenaLayoutV1>;
}

const index = (layouts: Iterable<ArenaLayoutV1>): ReadonlyMap<string, ArenaLayoutV1> => {
  const map = new Map<string, ArenaLayoutV1>();
  for (const layout of layouts) map.set(layout.id, layout);
  return map;
};

/**
 * A layout, as the composer's inputs.
 *
 * Pure, and memoised on the layout it was handed: calling it twice with the same
 * object returns the identical `CompiledArena`, which is the question
 * `arenaScenery`'s `lastKit === kit` check is asking. A layout that inherits is
 * memoised on the *child*, so a parent that moves means recompiling from the
 * registry rather than reaching in here — the right way round, because a
 * registry is the only thing that knows a parent moved at all.
 */
export function compileArenaLayout(
  layout: ArenaLayoutV1,
  options: CompileOptions = {},
): CompiledArena {
  const held = compiled.get(layout);
  if (held) return held;

  const full = layout.extends === undefined
    ? layout
    : resolveLayoutInheritance(layout, index(options.known ?? []));

  const kit: SceneryKit = { ...full.scatter };
  if (full.framingDepth !== undefined) kit.framingDepth = full.framingDepth;
  if (full.placements) kit.placements = full.placements.map(withoutEditorFields);
  if (full.focal) kit.focal = full.focal;
  if (full.groups) kit.groups = full.groups;
  if (full.colonnade) kit.colonnade = full.colonnade;
  if (full.wall) kit.wall = full.wall;
  if (full.quiet) kit.quiet = full.quiet;
  if (full.water) kit.water = full.water;
  if (full.shelf) kit.shelf = full.shelf;
  if (full.hills) kit.hills = full.hills;
  // **Straight across rather than folded onto the shelf.** The format hoisted
  // haze to the top level from the day it existed, and the runtime has caught
  // up: a room, a cavern and a meadow can all want air in front of the horizon
  // without any of them having a cliff, and folding it back was the one line
  // that made a haze without a drop unexpressible.
  if (full.haze) kit.haze = full.haze;
  if (full.lights) kit.lights = full.lights;

  const out: CompiledArena = {
    key: layoutKey(full.context),
    kit,
    composition: full.ground ?? null,
    haze: full.haze ?? null,
  };
  compiled.set(layout, out);
  return out;
}

/**
 * The composition for a fight's ground, layouts first and the shipped kits
 * behind them.
 *
 * **The migration seam, and it only points one way.** Eighteen compositions are
 * object literals in `sceneryKits.ts` today and two of them additionally exist
 * as JSON; they move over one at a time, exactly the way the kits themselves
 * arrived one surface at a time behind `ArenaScenery.kit`. A key with a layout
 * is answered by the layout, a key without one is answered by the table, and a
 * key with neither is answered by `null` — which is the "dress me from
 * `propKeys`" every arena had before any of this existed.
 *
 * **`sceneryFor` is the one caller**, and it asks with the layouts
 * `arenaLayouts.ts` compiled into the build — so this is on the critical path
 * of every fight, which is why that module drops a layout it cannot read rather
 * than throwing: the failure mode of a bad file is the previous picture, never
 * no picture. The editor asks the same question of the file it has open, which
 * is what keeps "the editor shows you the game" true of a saved layout as well
 * as of a shipped kit.
 */
export function arenaCompositionFor(
  key: string,
  layouts: Iterable<ArenaLayoutV1> = [],
): CompiledArena | null {
  const all = [...layouts];
  const authored = all.find((layout) => layoutKey(layout.context) === key);
  if (authored) return compileArenaLayout(authored, { known: all });

  const kit = SCENERY_KITS[key];
  if (!kit) return null;
  return {
    key,
    kit,
    composition: GROUND_COMPOSITION[key] ?? null,
    haze: kit.haze ?? null,
  };
}
