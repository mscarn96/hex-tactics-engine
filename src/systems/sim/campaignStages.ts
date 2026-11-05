import { BuildingType, HeroClass, ResourceType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { getLocation, LocationId } from '@/locations';
import { isOneShot, triggerKey } from '@/locations/types';
import { QUESTS } from '@/quests/questData';
import { QuestId } from '@/quests/types';
import { WorldId } from '@/data/worlds';
import { hexKey } from '@/utils/hexUtils';
import labDefaults from '@/data/balanceLabDefaults.json';
import { bandSpec, defaultSpec, EncounterId, EncounterSpec } from './balance/encounters';
import { atBandRoad } from './balance/bandRoad';
import { PartyPick, RolledParty, rollPickedParty } from './balance/partyRoll';
import { normalizeConfig, RawRunConfig } from './balance/runPlan';
import { partyRng } from './balance/rng';
import { buildScenario, ScenarioRecipe } from './scenarioCreator';
import { SaveData } from '@/systems/save/saveFormat';
import { bandFloor, bandOf, type WorldBands } from '@/systems/world/worldBands';
import { DEV_TOOLS } from '@/utils/devTools';

/**
 * Save Creator's campaign stages: a point in a real run, the party's budget there, and what the
 * player would hold. A stage is "before the boss": its lair's guards and chests are spent and only
 * the boss fight is left. Jadeveil is the morning after the castle, standing at the foothill camp;
 * the archipelago is the same morning at its island camp, a stage for walking its map, which has no
 * fights or quests of its own yet. A later world order stands in that world's band: the ledger, the
 * cap and the party budget all follow it.
 *
 * The party budget is the balance lab's (`data/balanceLabDefaults.json`, recorded from real runs), so
 * the lab and the creator always field the same party. A first world borrows the castle's, the party
 * that has just won it; a later world order reads that band's entry in the same file. The economy is a
 * draft, to judge in playtest.
 */

export type CampaignStageId = 'troll' | 'dragon' | 'heart' | 'castle' | 'jadeveil' | 'jadeveil_second' | 'archipelago' | 'archipelago_second';

export const CAMPAIGN_STAGE_IDS: readonly CampaignStageId[] = ['troll', 'dragon', 'heart', 'castle', 'jadeveil', 'jadeveil_second', 'archipelago', 'archipelago_second'];

/**
 * The stages this build offers. The archipelago's, and any world order but Jadeveil first, stand on
 * the development crossing, so a release, even one bundled with Save Creator, offers none of them.
 */
export function offeredCampaignStages(devTools: boolean = DEV_TOOLS): CampaignStageId[] {
  return CAMPAIGN_STAGE_IDS.filter((id) => devTools || !CAMPAIGN_STAGES[id].devOnly);
}

/** What the player holds on arriving at the stage. */
export interface StageEconomy {
  /** Campaign day, from 1; sets the week, and with it the tribute and siege due. */
  day: number;
  resources: Partial<Record<ResourceType, number>>;
  rations: number;
  buildings: Partial<Record<BuildingType, number>>;
}

export interface CampaignStage {
  id: CampaignStageId;
  /** The balance encounter whose budget the party is rolled in. */
  budget: EncounterId;
  /** Reported contracts, in the order a run reports them; prerequisites follow from them. */
  completed: QuestId[];
  /** The contract in hand, with its first objective done where that is walking to the door. */
  active?: { quest: QuestId; stage: number; progress: number[] };
  /** The lair standing open with only its boss left. */
  lair?: LocationId;
  start: string;
  world?: WorldId;
  /** The world order: the ledger the stage stands in, whose newest band sets the party's budget. Absent: `world` first. */
  worldBands?: WorldBands;
  /** Stands on the development crossing: absent from a release (`offeredCampaignStages`). */
  devOnly?: true;
  /** Castle seals already won; one means the Emperor has fallen. */
  seals: number[];
  economy: StageEconomy;
}

const TROLL_DONE: QuestId[] = ['wolves_at_the_gate', 'a_word_with_the_trapper', 'snares_and_stakes',
  'the_thing_in_the_thicket', 'the_goblin_tithe', 'the_ford_at_greywater'];
const DRAGON_DONE: QuestId[] = [...TROLL_DONE, 'the_warren_under_the_fields', 'the_roadwardens', 'hoofprints_in_the_mud',
  'word_from_the_high_workings', 'a_claim_worth_keeping', 'the_bell_below', 'the_overseers_cut', 'what_the_barrow_keeps',
  'northern_1_the_silent_trapline', 'northern_2_the_frozen_camp'];
const HEART_DONE: QuestId[] = [...DRAGON_DONE, 'what_sleeps_in_the_hollow', 'northern_3_the_supply_trail'];
const CASTLE_DONE: QuestId[] = [...HEART_DONE, 'the_door_in_the_barrow'];

const ALL_BUILDINGS = (level: number): Partial<Record<BuildingType, number>> =>
  Object.fromEntries(Object.values(BuildingType).map((b) => [b, level]));
/** Playtests never took a building to level 3, so the late game tops out at 2. */
const LATE_BUILDINGS = { ...ALL_BUILDINGS(1), [BuildingType.Tavern]: 2, [BuildingType.Forge]: 2, [BuildingType.Market]: 2 };

/** A first draft of each stage's economy, from quest payouts so far less building and upkeep spend. */
const AFTER_THE_CASTLE_ECONOMY: StageEconomy = {
  day: 48, rations: 10,
  resources: { [ResourceType.Gold]: 4400, [ResourceType.Wood]: 45, [ResourceType.Stone]: 40, [ResourceType.Iron]: 30, [ResourceType.Crystal]: 18 },
  buildings: LATE_BUILDINGS,
};

export const CAMPAIGN_STAGES: Record<CampaignStageId, CampaignStage> = {
  troll: {
    id: 'troll', budget: 'troll', completed: TROLL_DONE,
    active: { quest: 'the_warren_under_the_fields', stage: 0, progress: [1, 0] }, lair: 'lair_warren', start: 'lair_warren', seals: [],
    economy: {
      day: 10, rations: 6,
      resources: { [ResourceType.Gold]: 350, [ResourceType.Wood]: 18, [ResourceType.Stone]: 12, [ResourceType.Iron]: 6, [ResourceType.Crystal]: 2 },
      buildings: { [BuildingType.Market]: 1, [BuildingType.Tavern]: 1 },
    },
  },
  dragon: {
    id: 'dragon', budget: 'dragon', completed: DRAGON_DONE,
    active: { quest: 'what_sleeps_in_the_hollow', stage: 0, progress: [1, 0] }, lair: 'lair_wyrm', start: 'lair_wyrm', seals: [],
    economy: {
      day: 26, rations: 8,
      resources: { [ResourceType.Gold]: 1100, [ResourceType.Wood]: 30, [ResourceType.Stone]: 24, [ResourceType.Iron]: 16, [ResourceType.Crystal]: 6 },
      buildings: { [BuildingType.Market]: 1, [BuildingType.Tavern]: 1, [BuildingType.Shop]: 1, [BuildingType.Forge]: 1 },
    },
  },
  heart: {
    id: 'heart', budget: 'heart', completed: HEART_DONE,
    active: { quest: 'the_door_in_the_barrow', stage: 0, progress: [1, 0] }, lair: 'lair_barrow', start: 'lair_barrow', seals: [],
    economy: {
      day: 40, rations: 10,
      resources: { [ResourceType.Gold]: 1800, [ResourceType.Wood]: 40, [ResourceType.Stone]: 34, [ResourceType.Iron]: 26, [ResourceType.Crystal]: 10 },
      buildings: { ...ALL_BUILDINGS(1), [BuildingType.Tavern]: 2, [BuildingType.Forge]: 2 },
    },
  },
  castle: {
    id: 'castle', budget: 'castle', completed: CASTLE_DONE,
    active: { quest: 'the_obsidian_ledger', stage: 1, progress: [0] }, start: 'castle', seals: [],
    economy: {
      day: 47, rations: 10,
      resources: { [ResourceType.Gold]: 2600, [ResourceType.Wood]: 45, [ResourceType.Stone]: 40, [ResourceType.Iron]: 30, [ResourceType.Crystal]: 16 },
      buildings: LATE_BUILDINGS,
    },
  },
  jadeveil: {
    id: 'jadeveil', budget: 'castle', completed: [...CASTLE_DONE, 'the_obsidian_ledger', 'the_red_orb'],
    active: { quest: 'the_green_orb', stage: 0, progress: [0] }, start: 'gate', world: 'jadeveil', seals: [1],
    economy: AFTER_THE_CASTLE_ECONOMY,
  },
  // Second after the archipelago: band 2, cap 30, the party at the top of band 1
  jadeveil_second: {
    id: 'jadeveil_second', budget: 'castle', completed: [...CASTLE_DONE, 'the_obsidian_ledger', 'the_red_orb'],
    active: { quest: 'the_green_orb', stage: 0, progress: [0] }, start: 'gate', world: 'jadeveil', seals: [1], devOnly: true,
    worldBands: { bands: { archipelago: 1, jadeveil: 2 }, finished: ['archipelago'] },
    economy: AFTER_THE_CASTLE_ECONOMY,
  },
  archipelago: {
    id: 'archipelago', budget: 'castle', completed: [...CASTLE_DONE, 'the_obsidian_ledger', 'the_red_orb'],
    active: { quest: 'the_green_orb', stage: 0, progress: [0] }, start: 'gate', world: 'archipelago', seals: [1], devOnly: true,
    economy: AFTER_THE_CASTLE_ECONOMY,
  },
  // Second after Jadeveil: its whole road walked, the green orb with Ivane
  archipelago_second: {
    id: 'archipelago_second', budget: 'castle', completed: [...CASTLE_DONE, 'the_obsidian_ledger', 'the_red_orb', 'kairens_orb'],
    start: 'gate', world: 'archipelago', seals: [1], devOnly: true,
    worldBands: { bands: { jadeveil: 1, archipelago: 2 }, finished: ['jadeveil'] },
    economy: AFTER_THE_CASTLE_ECONOMY,
  },
};

/** The lab's saved budget for an encounter, or the built-in one when the lab file leaves it out. */
export function stageBudget(id: CampaignStageId): EncounterSpec {
  const stage = CAMPAIGN_STAGES[id];
  const encounter = stage.budget;
  const saved = normalizeConfig(labDefaults as RawRunConfig).encounters.find((e) => e.spec.id === encounter);
  const spec = saved?.spec ?? defaultSpec(encounter);
  const band = stageBand(stage);
  return band > 1 ? budgetAtBand(spec.id, band) : spec;
}

/** The band a stage's ledger gives its world; 1 for a stage with no later world order. */
const stageBand = (stage: CampaignStage): number => (stage.world && stage.worldBands ? bandOf(stage.worldBands, stage.world) ?? 1 : 1);

/**
 * The lab's saved budget for the start of a later band, its heroes stopping at the level the new band
 * starts from: a party that has just crossed is still at the previous cap.
 */
function budgetAtBand(id: EncounterId, band: number): EncounterSpec {
  const saved = (labDefaults as RawRunConfig).bands?.[String(band)];
  return { ...bandSpec(id, band, saved), levelCap: bandFloor(band) - 1 };
}

/** How many heroes the stage fields: the budget's hero count, within the party cap. */
export function stagePartySize(id: CampaignStageId): { min: number; max: number } {
  const { heroes } = stageBudget(id);
  return { min: Math.max(1, heroes.min), max: Math.min(BALANCE.MAX_PARTY_SIZE, heroes.max) };
}

/** Every one-shot trigger of a lair but its boss: the guards and chests a party clears first. */
export function lairTriggersBeforeBoss(id: LocationId): string[] {
  const location = getLocation(id);
  const boss = location.lair && hexKey(location.lair.bossAt);
  return location.tiles
    .filter((t) => t.trigger && isOneShot(t.trigger) && hexKey(t.coord) !== boss)
    .map((t) => triggerKey(id, t.coord));
}

export interface StageBuild {
  party: RolledParty;
  recipe: ScenarioRecipe;
  save: SaveData;
}

/**
 * Rolls the party for a stage from the picks and builds the save. Levels and gear come from the
 * stage's budget; every mastery point is left to spend. Throws on picks no save can hold.
 */
export function buildStageSave(id: CampaignStageId, picks: readonly PartyPick[], seed: number, devTools: boolean = DEV_TOOLS): StageBuild {
  const stage = CAMPAIGN_STAGES[id];
  const size = stagePartySize(id);
  if (picks.length < size.min || picks.length > size.max) throw new Error(`This stage fields ${size.min}–${size.max} heroes.`);
  if (new Set(picks.map((p) => p.heroClass)).size !== picks.length) throw new Error('Each class may join the party once.');
  if (!picks.every((p) => Object.values(HeroClass).includes(p.heroClass))) throw new Error('Unknown class.');

  if (stage.devOnly && !devTools) throw new Error('This stage needs the developer tools.');
  const band = stageBand(stage);
  const party = rollPickedParty(stageBudget(id), picks, partyRng(seed));
  if (stage.active && !QUESTS[stage.active.quest]) throw new Error(`Unknown quest ${stage.active.quest}.`);
  const recipe: ScenarioRecipe = {
    version: 1,
    name: `Stage · ${id}`,
    seed,
    party: party.heroes.map(({ heroClass: _class, capstone: _capstone, ...config }) => config),
    quests: {
      ...Object.fromEntries(stage.completed.map((q) => [q, 'completed' as const])),
      ...(stage.active && { [stage.active.quest]: { stage: stage.active.stage, progress: [...stage.active.progress] } }),
    },
    resources: { ...stage.economy.resources },
    rations: stage.economy.rations,
    hours: (stage.economy.day - 1) * BALANCE.HOURS_PER_DAY,
    start: stage.start,
    ...(stage.world && { world: stage.world }),
    ...(stage.worldBands && { worldBands: stage.worldBands }),
    buildings: { ...stage.economy.buildings },
    bag: [],
    stash: [],
    clearedSites: [],
    seals: [...stage.seals],
    ...(stage.lair && { spentTriggers: lairTriggersBeforeBoss(stage.lair) }),
  };
  // Minted under the cap the band's campaign has, so a later band's gear keeps the levels it was rolled at
  const save = band > 1 ? atBandRoad(band, band, () => buildScenario(recipe).save) : buildScenario(recipe).save;
  return { party, recipe, save };
}
