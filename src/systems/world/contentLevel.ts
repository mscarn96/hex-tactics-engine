import { BALANCE } from '@/data/balanceConstants';
import { effectiveLevelCap, roadState, worldBandFor, type RoadState } from '@/data/levelCap';
import { worldDef, type WorldId } from '@/data/worlds';
import { LAIR_SPECS } from '@/locations/lairs';
import { shrineBand, shrineOfEncounter } from '@/systems/world/shrines';
import { summitTierFromId } from '@/systems/world/summit';
import { siegeWeekFromId } from '@/systems/world/tribute';
import { bandFloor, bandTop } from '@/systems/world/worldBands';

/**
 * What level a fight or a reward source is at, in a world beyond the Empire
 * (the private project notes, *Story and repeatable content*).
 *
 * **Story content** (quests, story fights, wandering ground, shrines, lairs and an orb
 * boss's first fight) stands at its band's floor plus an authored offset of 0–4, with its
 * loot under the band's top. **Repeatable content** (Kairen's Storm Seal tiers now, raids and
 * weekly content later) stands at the current cap, with its loot under the cap.
 *
 * The party's level is deliberately not an input. An old world stays where it was left, and a
 * party that is off pace meets it harder or easier rather than meeting it moved.
 *
 * The Empire answers `null` and keeps its own rules: it scales with the party and the cap.
 *
 * The offsets live with the data they describe: `WorldDef.levelOffsets` per threat band,
 * `LairSpec.levelOffset`, a shrine keeper's shrine band, and `BALANCE.KAIREN.STORY_LEVEL_OFFSET`.
 */
export type ContentKind = 'story' | 'repeatable';

export interface ContentLevel {
  /** The level band of the world this content is in. */
  band: number;
  kind: ContentKind;
  /** The fixed level its enemies fight at and its loot starts from. */
  level: number;
  /** The highest item level it can pay, and the level its legendaries mint at. */
  ceiling: number;
  /** Where its loot ramps with depth: the next area's level, or `level` itself for a site. */
  rampTo: number;
}

/** One fight or reward source: an encounter, or a location's own chest. */
export interface ContentSource {
  world: WorldId;
  encounterId?: string | null;
  /** The chests of a location, which name no encounter. */
  locationId?: string;
  /** The ground underfoot, for content with no site of its own. */
  threatBand?: number;
}

/** Summit tiers 2–5 are repeatable and tier 1 is the story; everything else is story until raids exist. */
export function contentKind(encounterId: string | null | undefined): ContentKind {
  const tier = summitTierFromId(encounterId);
  return tier !== null && tier >= 2 ? 'repeatable' : 'story';
}

/** A threat band's level offset in a world; 0 in a world with none. */
export function areaOffset(world: WorldId, threatBand: number): number {
  const offsets = worldDef(world).levelOffsets ?? [];
  const index = Math.min(offsets.length - 1, Math.max(0, Math.round(threatBand)));
  return offsets[index] ?? 0;
}

const lairOf = (id: string | null | undefined) => (id ? LAIR_SPECS.find((spec) => id.startsWith(spec.id)) : undefined);

/** A source's site, if it stands somewhere with a level of its own rather than on the ground. */
function siteOffset(source: ContentSource): number | null {
  const lair = lairOf(source.encounterId ?? source.locationId);
  if (lair) return lair.levelOffset ?? areaOffset(source.world, lair.band);
  const shrine = shrineOfEncounter(source.encounterId);
  if (shrine !== null) return areaOffset(source.world, shrineBand(shrine));
  if (summitTierFromId(source.encounterId) !== null) return BALANCE.KAIREN.STORY_LEVEL_OFFSET;
  return null;
}

/** A story source's offset over the band floor. Sites override the area they stand in. */
export function contentOffset(source: ContentSource): number {
  return siteOffset(source) ?? areaOffset(source.world, source.threatBand ?? 0);
}

/** An area's fixed level in a state of the campaign; `null` in the Empire. */
export function areaLevel(world: WorldId, threatBand: number, road: Pick<RoadState, 'banded'> = roadState()): number | null {
  const band = worldBandFor(world, road);
  return band === null ? null : bandFloor(band) + areaOffset(world, threatBand);
}

/**
 * The four answers for a source, or `null` where the content has no band: anywhere in the
 * Empire, and a siege, which is fought in the Empire's streets whoever is away from them.
 */
export function contentLevel(source: ContentSource, road: RoadState = roadState()): ContentLevel | null {
  const band = worldBandFor(source.world, road);
  if (band === null || siegeWeekFromId(source.encounterId ?? '') !== null) return null;
  const kind = contentKind(source.encounterId);
  if (kind === 'repeatable') {
    // The cap always covers the newest band; an entitlement that cannot be read must not drop a band's own Seals below it
    const cap = Math.max(effectiveLevelCap(road), bandTop(band));
    return { band, kind, level: cap, ceiling: cap, rampTo: cap };
  }
  const level = bandFloor(band) + contentOffset(source);
  const ceiling = bandTop(band);
  const onGround = siteOffset(source) === null;
  const next = onGround ? bandFloor(band) + areaOffset(source.world, (source.threatBand ?? 0) + 1) : level;
  return { band, kind, level, ceiling, rampTo: Math.min(ceiling, Math.max(level, next)) };
}
