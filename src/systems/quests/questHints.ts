import { Objective } from '@/quests/types';
import { FACTIONS, Faction } from '@/data/templates/factions';
import { MapTile, TileType } from '@/models/types';
import { ThreatBand } from '@/systems/world/threat';
import { bandsFielding } from '@/systems/world/encounterShapes';
import { threatBandName } from '@/data/worlds';
import { t, type MessageKey } from '@/i18n';

/**
 * Where to go and look for what a quest is asking for.
 *
 * **Derived from the roster, never authored.** A hint written by hand beside a
 * quest is a second statement of where something lives, and the first one —
 * `Faction.threatRange`, `Faction.terrain` — is the one the encounter generator
 * actually obeys. Retuning a faction's band window would silently make every
 * authored hint about it wrong, and a wrong hint is worse than none: it sends
 * the player somewhere the thing provably is not.
 *
 * The failure this exists to fix is on record. A wolf quest cost a playtest four
 * in-game weeks, because "kill five wolves" says nothing about wolves living in
 * forests inside the first two bands, and the map is 4,900 tiles. `questHunt`
 * fixed the *supply* by weighting the roll; this fixes the *search*.
 *
 * Pure and free of React, the `terrainDisplay` rule, so the node suites can
 * measure it.
 */

/** Which factions field any of these templates, in roster order. */
export function factionsFielding(templates: readonly string[]): Faction[] {
  const wanted = new Set(templates);
  return FACTIONS.filter((faction) =>
    Object.values(faction.roles).some((ids) => ids.some((id) => wanted.has(id))),
  );
}

/** Each terrain as it reads after "Found in" — in Polish, with its own preposition. */
const TERRAIN_WORD: Record<TileType, MessageKey> = {
  [TileType.Plains]: 'campaign.terrain.plains',
  [TileType.Forest]: 'campaign.terrain.forest',
  [TileType.Desert]: 'campaign.terrain.desert',
  [TileType.Swamp]: 'campaign.terrain.swamp',
  [TileType.Highlands]: 'campaign.terrain.highlands',
  [TileType.Mountain]: 'campaign.terrain.mountain',
  [TileType.Water]: 'campaign.terrain.water',
  [TileType.Tundra]: 'campaign.terrain.tundra',
};

/** Joins a list the way a sentence does, not the way `Array.join` does. */
function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return t('campaign.list.and', { list: words.slice(0, -1).join(', '), last: words[words.length - 1] });
}

/**
 * Where the hunted actually live, as ground rather than as a sentence.
 *
 * The same two fields `huntHint` reads, handed over unphrased so the world map
 * can paint the country the words describe. That sharing is the point: a map
 * highlight derived independently would be a *third* statement of where an
 * enemy lives, free to disagree with the sentence printed beside it — and the
 * whole reason this module derives from the roster is that a second statement
 * drifts. Retune a faction's `terrain` and both the words and the paint move
 * together, or neither does.
 */
export interface HuntGround {
  /** Terrain the quarry is found on. **Empty means any ground**, not none. */
  terrain: TileType[];
  /** Every faction that delivers the quarry is bound to `terrain` (`Faction.homeLocked`): it is met nowhere else. */
  locked: boolean;
  /** The ground is the frozen tiles: tundra, and highlands only where the tile carries frost (`Faction.frostOnly`). */
  frostOnly: boolean;
  /**
   * Inclusive band window.
   *
   * Unioned across every faction that can actually *deliver* the quarry — see
   * `contributors`. It used to be the union of their `threatRange`s, which is a
   * different and larger thing, and the difference put the Goblin Tithe's orcs
   * in Home Reach.
   */
  bands: [ThreatBand, ThreatBand];
}

/**
 * Which factions can actually put one of these templates on the board, and at
 * which bands.
 *
 * **A faction fielding a template is not the same as a faction fielding it
 * everywhere it goes**, and reading `threatRange` as though it were is the bug
 * this function exists to end. The range says where the faction turns up; the
 * shape table decides which of its members turn up there. Greenskins run bands
 * 0–2, but band 0 offers one shape — two `chaff` — and Greenskin chaff is the
 * Goblin Whelp alone, so an Orc Grunt cannot appear in Home Reach at any price.
 *
 * The Goblin Tithe asks for two Orc Grunts. The log said Home Reach, the map
 * painted Home Reach, and a player hunted ground the quarry provably is not on
 * — which is *worse* than the four-week wolf search this module was written to
 * fix, because a wrong answer is followed with confidence.
 *
 * A faction contributing no reachable band is dropped **entirely**, terrain
 * included. Keeping its terrain would paint swamp for a quarry that only ever
 * turns up in forest, which is the same lie one field over.
 */
function contributors(
  templates: readonly string[],
): { faction: Faction; bands: ThreatBand[] }[] {
  const wanted = new Set(templates);
  return factionsFielding(templates)
    .map((faction) => ({ faction, bands: bandsFielding(faction, wanted) }))
    .filter((entry) => entry.bands.length > 0);
}

/**
 * The band window across every faction that can actually deliver the target.
 *
 * The union rather than one faction's, because a quest naming wolves is
 * satisfied by whoever fields wolves — and a range that excluded a faction the
 * player will legitimately meet them in would be the wrong-hint failure above,
 * one step subtler.
 *
 * Flattened to a window rather than kept as the list `bandsFielding` returns:
 * the sentence reads as a range and the paint is a membership test, and neither
 * has anywhere to put a hole. A hole would over-paint by one band in the middle,
 * which is a far smaller lie than over-painting the *entrance* to a faction's
 * whole range — and the entrance is where a player under-levelled for the quarry
 * actually goes looking.
 */
function bandWindow(bands: ThreatBand[]): [ThreatBand, ThreatBand] {
  return [
    Math.min(...bands) as ThreatBand,
    Math.max(...bands) as ThreatBand,
  ];
}

/**
 * Ground worth searching for a `kill` objective, or `null` when the objective is
 * not a hunt or nothing in the roster fields it — `huntHint`'s contract exactly,
 * and for its reasons.
 *
 * **One terrain list and one band window, unioned across contributors.** That is
 * only honest while every objective in the game is satisfied by a single
 * faction, because two factions on different ground and in different bands would
 * paint the cross-product — forest at band 4 for a quarry that lives in forest
 * at band 0 and in swamp at band 4. Every `kill` objective `QUESTS` authors today
 * names one faction's members, and `questHints.test.ts` pins that, so the day
 * somebody writes a two-faction hunt the suite fails and this grows a region per
 * faction. Building that now would be a shape nothing in the game produces.
 */
export function huntGround(objective: Objective): HuntGround | null {
  if (objective.kind !== 'kill') return null;

  const fielding = contributors(objective.templates);
  if (fielding.length === 0) return null;

  return {
    terrain: [...new Set(fielding.flatMap(({ faction }) => faction.terrain))],
    locked: fielding.every(({ faction }) => faction.homeLocked === true),
    frostOnly: fielding.every(({ faction }) => faction.frostOnly === true),
    bands: bandWindow(fielding.flatMap(({ bands }) => bands)),
  };
}

/**
 * Whether one faction can deliver every one of these templates on its own.
 *
 * Exported for the suite rather than for the game: it is the precondition the
 * single-window simplification above rests on, and a precondition nothing checks
 * is a precondition that stops being true.
 */
export function fieldedByOneFaction(objective: Objective): boolean {
  if (objective.kind !== 'kill') return true;
  return contributors(objective.templates).length <= 1;
}

/**
 * Whether a tile is somewhere the quarry can actually turn up.
 *
 * Here rather than in the component that paints it, the rule the private project notes states
 * about `victoryRewards`: this is a function of (tile, ground) and nothing else,
 * and a function of its arguments living inside a scene is untestable purely
 * because of where it sits.
 *
 * Three clauses, and each is the encounter generator's own:
 *  - **haunted ground**, because encounters happen nowhere else. The road never
 *    holds one and the corridor barely does — the rule a player who has stayed
 *    on the road will not have worked out, which is why `huntHint` says it in
 *    words too.
 *  - the terrain the fielding factions prefer, where **an empty list means any
 *    ground** rather than none.
 *  - the band window, read off the tile's own stored `threat` rather than
 *    recomputed, so the paint cannot disagree with the label the HUD shows.
 *
 * `explored` is deliberately *not* one of them. Whether to paint through fog is
 * a question about the map's own rules rather than about where enemies live, and
 * it belongs to the thing doing the drawing.
 */
export function isHuntGround(
  tile: Pick<MapTile, 'type' | 'zone' | 'threat' | 'frost'>,
  ground: HuntGround,
): boolean {
  if (tile.zone !== 'haunted') return false;
  if (ground.terrain.length > 0 && !ground.terrain.includes(tile.type)) return false;
  if (ground.frostOnly && tile.type !== TileType.Tundra && !tile.frost) return false;
  const band = tile.threat ?? 0;
  return band >= ground.bands[0] && band <= ground.bands[1];
}

/** The band window as a label range. */
function bandWords(bands: [ThreatBand, ThreatBand]): string {
  const [low, high] = bands;
  const from = threatBandName('empire', low);
  const to = threatBandName('empire', high);
  return low === high ? from : t('campaign.hunt.bandRange', { from, to });
}

/**
 * One sentence saying where to hunt, or `null` when the objective is not a hunt
 * or nothing in the roster fields it.
 *
 * `null` rather than a vague fallback: a quest naming a template the game no
 * longer fields is a broken counter, and `quests.test.ts` already fails on it.
 * Inventing "look anywhere" here would paper over exactly that.
 */
export function huntHint(objective: Objective): string | null {
  // Through `huntGround` rather than reading the roster again, so the sentence
  // and the country the map paints are one derivation with two renderings.
  const ground = huntGround(objective);
  if (!ground) return null;

  // Terrain first: it is the thing the player can see on the map without
  // walking anywhere, and an empty list genuinely means "anywhere". The
  // sentence ends on the ground rule the whole map is built on, and the one a
  // player who has stayed on the road will not have worked out: encounters
  // only happen off it.
  const bands = bandWords(ground.bands);
  if (ground.terrain.length === 0) return t('campaign.hunt.anyGround', { bands });
  const terrain = listWords(ground.terrain.map((type) =>
    ground.frostOnly && type === TileType.Highlands ? t('campaign.terrain.snowyHighlands') : t(TERRAIN_WORD[type])));
  return t(ground.locked ? 'campaign.hunt.lockedTerrain' : 'campaign.hunt.terrain', { terrain, bands });
}
