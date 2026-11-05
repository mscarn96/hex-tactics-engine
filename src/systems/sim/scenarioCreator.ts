import { NO_HEART_LADDER } from '@/systems/world/heartRefight';
import { bagFrom } from '@/data/items/bag';
import { BALANCE } from '@/data/balanceConstants';
import { highestLevelCap } from '@/data/levelCap';
import { emptyGemStock, GemStock } from '@/data/items/gems';
import { itemAtLevel, itemFromTemplateId } from '@/systems/economy/itemFactory';
import { BuildingType, GamePhase, Item, MapTile, POIType, ResourceType, TileType } from '@/models/types';
import { isWorldId, worldDef, worldSeed, type WorldId } from '@/data/worlds';
import { equipRefusalText, equippedItemsFor, illegalSlots } from '@/systems/progression/equipRules';
import { heroMaxHp, heroMaxMana } from '@/systems/progression/statCalc';
import { LAIR_SPECS, getLocation, LocationId, placeName } from '@/locations';
import { EMPIRE_LAIRS } from '@/locations/lairs';
import { isOneShot, triggerKey } from '@/locations/types';
import { rollDailyEncounters, tileMutations } from '@/systems/world/worldState';
import { NO_WRATH } from '@/systems/world/wrath';
import { NO_VOWS } from '@/systems/world/monastery';
import { NO_SUMMIT } from '@/systems/world/summit';
import { SHRINE_COUNT } from '@/systems/world/shrines';
import { bandOf, crossInto, isWorldBands, NO_WORLD_BANDS, type WorldBands } from '@/systems/world/worldBands';
import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { QuestId, QuestPredicate } from '@/quests/types';
import { questTitle } from '@/quests/questText';
import { QuestRecord } from '@/systems/quests/quests';
import { canUnlockNode, availableMasteries } from '@/systems/progression/mastery';
import { generateMap, movementCost } from '@/systems/world/mapGenerator';
import { SaveData, SAVE_VERSION, isLoadable } from '@/systems/save/saveFormat';
import { buildSimHero, defaultHeroConfig, SimHeroConfig, simMasteryHero, simPointBudget, simPointsSpent } from './simHarness';
import { createRNG } from '@/utils/rng';
import { QUEST_SITES } from '@/quests/sites';
import { getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';

export interface ScenarioRecipe {
  version: 1;
  name: string;
  seed: number;
  party: SimHeroConfig[];
  quests: Partial<Record<QuestId, 'completed' | QuestRecord>>;
  resources: Partial<Record<ResourceType, number>>;
  rations: number;
  hours: number;
  /**
   * Where the party stands, on `world`'s map: `city`, a generated tile key, or beside a door —
   * `gate` (the world gate, or Jadeveil's camp), `castle`, or a lair's id.
   */
  start: string;
  /** The world the party is in; absent is the Empire. Any other needs the Emperor fallen (a seal). */
  world?: WorldId;
  /** The world band ledger. Absent: a party beyond the Empire stands in the first world it entered, band 1. */
  worldBands?: WorldBands;
  /** One-shot location triggers already spent (`triggerKey`): a lair's guards and chests, say. */
  spentTriggers?: string[];
  buildings: Partial<Record<BuildingType, number>>;
  bag: ScenarioItem[];
  stash: ScenarioItem[];
  /** Keys are "partyIndex.slot", e.g. "0.mainHand". */
  equipmentSettings?: Record<string, Omit<ScenarioItem, 'templateId'>>;
  gems?: Partial<GemStock>;
  gemStash?: Partial<GemStock>;
  clearedLairs?: LocationId[];
  clearedSites: string[];
  seals: number[];
  heroState?: Record<number, { hp?: number; mana?: number }>;
  /** Explicit wandering encounters for route reproductions; omit for seeded day-one rolls. */
  encounterTiles?: string[];
}
export interface ScenarioItem {
  templateId: string;
  level: number;
  variant?: Item['variant'];
  sockets?: Item['sockets'];
}
export function defaultScenario(name = 'Early campaign'): ScenarioRecipe {
  return { version: 1, name, seed: 20261005, party: [defaultHeroConfig('warrior', 5)],
    quests: {}, resources: { [ResourceType.Gold]: 500 }, rations: 20, hours: 0, start: 'city',
    buildings: {}, bag: [], stash: [], clearedSites: [], seals: [] };
}
function natural(n: unknown, max = Number.MAX_SAFE_INTEGER): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max;
}
/**
 * The last seed's map. Generation is nine tenths of a build and Save Creator
 * rebuilds on every edit to keep its verdict live, almost always on one seed.
 * Read-only: the builder copies every tile it changes.
 */
const lastMaps = new Map<WorldId, { seed: number; tiles: MapTile[] }>();
function mapFor(seed: number, world: WorldId = 'empire') {
  let last = lastMaps.get(world);
  if (last?.seed !== seed) lastMaps.set(world, last = { seed, tiles: generateMap(seed, worldDef(world)) });
  return last.tiles;
}

/**
 * Where `start` puts the party: the city, a tile key, or the free hex beside a door (the gentlest
 * band, road first, as a party arriving through a gate is set down). Null when nothing matches.
 */
function startTile(tiles: MapTile[], start: string, world: WorldId): MapTile | null {
  if (start === 'city') return tiles.find(t => t.poi === POIType.City) ?? null;
  const byKey = tiles.find(t => hexKey(t.coord) === start);
  if (byKey) return byKey;
  const home = hexKey(worldDef(world).home);
  const door = tiles.find(t => start === 'gate' ? t.poi === POIType.WorldGate || hexKey(t.coord) === home
    : start === 'castle' ? t.poi === POIType.EmpireCastle
      : t.poi === POIType.BossTile && t.encounterId === start);
  if (!door) return null;
  const byCoord = new Map(tiles.map(t => [hexKey(t.coord), t]));
  const steps = getNeighbors(door.coord).map(c => byCoord.get(hexKey(c)))
    .filter((t): t is MapTile => !!t && !t.poi && movementCost(t, door) !== null && movementCost(door, t) !== null);
  steps.sort((a, b) => (a.threat ?? 0) - (b.threat ?? 0) || Number(b.zone === 'road') - Number(a.zone === 'road'));
  return steps[0] ?? null;
}

/** Whether `key` names a one-shot trigger of a real place (`triggerKey`). */
function isSpendableTrigger(key: string): boolean {
  const split = key.indexOf(':');
  const id = key.slice(0, split) as LocationId;
  if (split < 0 || !LAIR_SPECS.some(s => s.id === id)) return false;
  return getLocation(id).tiles.some(t => t.trigger && isOneShot(t.trigger) && triggerKey(id, t.coord) === key);
}
/** Builds entirely off-store. Invalid recipes cannot partially replace a running campaign. */
export function buildScenario(recipe: ScenarioRecipe): { save: SaveData; implied: string[] } {
  if (recipe.version !== 1 || !recipe.name?.trim() || !Number.isSafeInteger(recipe.seed)
    || !natural(recipe.hours) || !natural(recipe.rations) || !Array.isArray(recipe.party)
    || recipe.party.length < 1 || recipe.party.length > BALANCE.MAX_PARTY_SIZE) throw new Error('Invalid scenario header or party size.');
  const items: Item[] = [];
  const mint = (item: Item) => { const id = `scenario_item_${items.length}`; items.push({ ...item, id }); return id; };
  const heroes = recipe.party.map((cfg, i) => {
    if (!natural(cfg.level, highestLevelCap()) || cfg.level < 1) throw new Error('Invalid hero level.');
    if (cfg.masteryPath && cfg.level < BALANCE.MASTERY_UNLOCK_LEVEL) throw new Error('Mastery requires level 5.');
    const empty = simMasteryHero({ ...cfg, masteryNodes: [] });
    if (!empty || (cfg.masteryPath && !availableMasteries(empty).includes(cfg.masteryPath))) throw new Error('Invalid hero or mastery path.');
    const bought: string[] = [];
    for (const node of cfg.masteryNodes) {
      const probe = simMasteryHero({ ...cfg, masteryNodes: bought })!;
      if (!canUnlockNode(probe, node).ok) throw new Error(`Illegal mastery choice: ${node}`);
      bought.push(node);
    }
    for (const id of Object.values(cfg.equipment)) if (id && !itemFromTemplateId(id)) throw new Error(`Unknown item: ${id}`);
    const hero = buildSimHero(cfg, mint, `scenario_hero_${i}`)!;
    hero.masteryPoints = simPointBudget(cfg) - simPointsSpent(cfg);
    for (const [slot, id] of Object.entries(hero.equipment)) {
      const item = items.find(x => x.id === id)!;
      const options = recipe.equipmentSettings?.[`${i}.${slot}`];
      if (options) {
        if (!natural(options.level, BALANCE.MAX_LEVEL + BALANCE.MAX_UPGRADE_LEVEL) || options.level < 1) throw new Error('Invalid equipment level.');
        const levelled = itemAtLevel(item, options.level);
        if (levelled.itemLevel !== options.level) throw new Error('Item level exceeds its rarity cap.');
        Object.assign(item, levelled,
          options.variant !== undefined ? { variant: options.variant } : {},
          options.sockets !== undefined ? { sockets: options.sockets } : {});
      }
    }
    const illegal = illegalSlots(hero, equippedItemsFor(hero, items));
    if (illegal.length) throw new Error(`${hero.name}: ${equipRefusalText(illegal[0].reason)}`);
    hero.currentHp = heroMaxHp(hero, items);
    hero.currentMana = heroMaxMana(hero, items);
    const initial = recipe.heroState?.[i];
    if (initial?.hp !== undefined) {
      if (!natural(initial.hp, hero.currentHp)) throw new Error('Invalid starting HP.');
      hero.currentHp = initial.hp;
    }
    if (initial?.mana !== undefined) {
      if (!natural(initial.mana, hero.currentMana)) throw new Error('Invalid starting mana.');
      hero.currentMana = initial.mana;
    }
    return hero;
  });
  const extraItems = (entries: ScenarioRecipe['bag'], prefix: string): Item[] => entries.map((entry, i) => {
    const base = itemFromTemplateId(entry.templateId);
    if (!base || !natural(entry.level, BALANCE.MAX_LEVEL + BALANCE.MAX_UPGRADE_LEVEL) || entry.level < 1) throw new Error(`Invalid item: ${entry.templateId}`);
    const levelled = itemAtLevel(base, entry.level);
    if (levelled.itemLevel !== entry.level) throw new Error('Item level exceeds its rarity cap.');
    return { ...levelled, id: `${prefix}_${i}`,
      ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
      ...(entry.sockets !== undefined ? { sockets: entry.sockets } : {}) };
  });
  items.push(...extraItems(recipe.bag, 'scenario_bag'));
  const stash = extraItems(recipe.stash, 'scenario_stash');
  const completed = new Set<QuestId>();
  const active: Partial<Record<QuestId, QuestRecord>> = {};
  const implied: string[] = [];
  const lairs = new Set(recipe.clearedLairs ?? []);
  for (const id of lairs) if (!LAIR_SPECS.some(s => s.id === id)) throw new Error(`Invalid lair: ${id}`);
  const dependencies = (p: QuestPredicate | undefined): void => {
    if (!p) return;
    if (p.kind === 'partyLevel' && heroes.reduce((sum, h) => sum + h.level, 0) < p.total) throw new Error(`Quest requires party level ${p.total}.`);
    if (p.kind === 'questDone') complete(p.quest);
    if (p.kind === 'all') p.of.forEach(dependencies);
    if (p.kind === 'lairsCleared') for (const spec of EMPIRE_LAIRS.slice(0, p.count)) {
      if (!lairs.has(spec.id)) { lairs.add(spec.id); implied.push(`Cleared prerequisite lair: ${placeName(spec.id)}`); }
    }
  };
  const visiting = new Set<QuestId>();
  const complete = (id: QuestId): void => {
    if (completed.has(id)) return;
    if (!QUESTS[id] || visiting.has(id)) throw new Error(`Invalid quest dependency: ${id}`);
    visiting.add(id); dependencies(QUESTS[id].unlockedBy); visiting.delete(id);
    completed.add(id);
    if (recipe.quests[id] !== 'completed') implied.push(`Completed prerequisite: ${questTitle(id)}`);
  };
  for (const [key, choice] of Object.entries(recipe.quests)) {
    const id = key as QuestId;
    if (!QUEST_IDS.includes(id)) throw new Error(`Unknown quest: ${key}`);
    if (choice === 'completed') complete(id);
    else {
      dependencies(QUESTS[id].unlockedBy);
      if (!choice || !natural(choice.stage, QUESTS[id].stages.length)) throw new Error(`Invalid stage: ${key}`);
      const objectives = QUESTS[id].stages[choice.stage]?.objectives ?? [];
      if (!Array.isArray(choice.progress) || choice.progress.length !== objectives.length || !choice.progress.every((n, i) => natural(n, 'count' in objectives[i] ? objectives[i].count : 1))) throw new Error(`Invalid progress: ${key}`);
      active[id] = { stage: choice.stage, progress: [...choice.progress] };
    }
  }
  for (const id of completed) delete active[id];
  const cleared = new Set(recipe.clearedSites);
  for (const id of completed) for (const stage of QUESTS[id].stages) for (const objective of stage.objectives) {
    if (objective.kind === 'investigate' || (objective.kind === 'clearPoi' && objective.site)) cleared.add(objective.site!);
    if (objective.kind === 'kill') for (const spec of LAIR_SPECS) if (objective.templates.includes(spec.boss)) lairs.add(spec.id);
  }
  // Party capacity is earned by lairs; an arbitrary wide party needs matching proof.
  for (const spec of EMPIRE_LAIRS) {
    if (recipe.party.length <= BALANCE.PARTY_SLOTS_BASE + EMPIRE_LAIRS.filter(s => lairs.has(s.id)).length) break;
    if (!lairs.has(spec.id)) { lairs.add(spec.id); implied.push(`Cleared for party capacity: ${placeName(spec.id)}`); }
  }
  const extraSpent = recipe.spentTriggers ?? [];
  if (!Array.isArray(extraSpent) || !extraSpent.every(isSpendableTrigger)) throw new Error('Unknown spent trigger.');
  const spentTriggers = [...new Set([...lairs.values()].flatMap(id => {
    const location = getLocation(id);
    return location.lair ? [triggerKey(id, location.lair.bossAt)] : [];
  }).concat(extraSpent))];
  const world = recipe.world ?? 'empire';
  if (!isWorldId(world)) throw new Error('Unknown world.');
  if (world !== 'empire' && recipe.seals.length === 0) throw new Error('A world beyond the Empire opens once the Emperor has fallen (castle seals).');
  const worldBands = recipe.worldBands ?? (world === 'empire' ? NO_WORLD_BANDS : crossInto(NO_WORLD_BANDS, world));
  if (!isWorldBands(worldBands) || (world !== 'empire' && bandOf(worldBands, world) === null)) throw new Error('Invalid world order.');
  // Jadeveil finished before this world: its shrines are claimed and Kairen is dead
  const jadeveilDone = worldBands.finished.includes('jadeveil');
  const tiles = mapFor(recipe.seed).map(t => ({ ...t, explored: true,
    ...(t.questId && cleared.has(t.questId) ? { defeated: true } : {}) }));
  const knownSites = new Set([...Object.keys(QUEST_SITES), ...tiles.flatMap(t => t.questId ? [t.questId] : [])]);
  if (!recipe.clearedSites.every(id => knownSites.has(id))) throw new Error('Unknown cleared site.');
  // In Jadeveil the Empire waits by its gate, where a party that crossed left it
  const away = world === 'empire' ? null : mapFor(worldSeed(recipe.seed, world), world);
  const start = startTile(away ?? tiles, recipe.start, world);
  if (!start || start.type === TileType.Water) throw new Error('Start tile does not exist or cannot be walked on.');
  const empireAt = away ? startTile(tiles, 'gate', 'empire') : start;
  if (!empireAt) throw new Error('The Empire has no world gate on this seed.');
  const resources = Object.fromEntries(Object.values(ResourceType).map(type => {
    const n = recipe.resources[type] ?? 0; if (!natural(n)) throw new Error(`Invalid resource: ${type}`); return [type, n];
  }));
  const buildings = Object.values(BuildingType).map(type => {
    const level = recipe.buildings[type] ?? 0; if (!natural(level, 3)) throw new Error('Invalid building level.'); return { type, level };
  });
  if (!Array.isArray(recipe.seals) || !recipe.seals.every(n => natural(n) && n > 0)) throw new Error('Invalid castle seals.');
  const rng = createRNG(recipe.seed ^ 0x510ca);
  const partyLevel = heroes.reduce((sum, h) => sum + h.level, 0);
  // The game's daily roll, seeded; a scenario stages no finds, and its water is no place to stand a warband
  const byKey = new Map(tiles.map(t => [hexKey(t.coord), t]));
  const encounters = recipe.encounterTiles ?? [...rollDailyEncounters(byKey, new Map(),
    { partySummedLevel: partyLevel, chanceMult: 1, rng: () => rng.next() })].filter(key => byKey.get(key)?.type !== TileType.Water);
  if (!Array.isArray(encounters) || encounters.some(key => {
    const tile = tiles.find(t => hexKey(t.coord) === key);
    return !tile || tile.poi || tile.type === TileType.Water;
  })) throw new Error('Invalid wandering encounter tile.');
  const day = Math.floor(recipe.hours / BALANCE.HOURS_PER_DAY) + 1;
  const week = Math.floor(recipe.hours / (BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK)) + 1;
  const worlds: SaveData['worldMap']['worlds'] = { empire: { seed: recipe.seed, ...tileMutations(tiles),
    partyPosition: { ...empireAt.coord }, activeEncounterTiles: away ? [] : encounters, usedMagicWells: [], finds: [], merchants: [], day, week } };
  if (away) {
    // Just arrived: the ground around the camp is seen, the rest of the range is not
    const seen = away.map(t => ({ ...t, explored: hexDistance(t.coord, start.coord) <= BALANCE.FOG_REVEAL_RADIUS }));
    worlds[world] = { seed: worldSeed(recipe.seed, world), ...tileMutations(seen), partyPosition: { ...start.coord },
      activeEncounterTiles: [], usedMagicWells: [], finds: [], merchants: [], day, week };
  }
  const save: SaveData = { version: SAVE_VERSION,
    game: { phase: GamePhase.WorldMap, mapSeed: recipe.seed, starterHeroId: heroes[0].templateId, difficulty: 'medium', hardcore: false, achievementVictories: [] },
    party: { heroes }, inventory: { bag: bagFrom({ gear: items, gems: recipe.gems, rations: recipe.rations }), resources },
    worldMap: { current: world, totalHours: recipe.hours, wardUntil: 0, villageBuff: null, worlds },
    worldBands: { bands: { ...worldBands.bands }, finished: [...worldBands.finished] },
    mythicKills: 0,
    ascent: { wrath: NO_WRATH, vows: NO_VOWS, shrines: jadeveilDone ? SHRINE_COUNT : 0,
      summit: jadeveilDone ? { ...NO_SUMMIT(), slain: true } : NO_SUMMIT(), forge: { ink: 0, patterns: [] } },
    city: { buildings, recruitsEarned: Math.max(0, heroes.length - 1), recruitNoticeShownFor: heroes.length, stash, gemStash: { ...emptyGemStock(), ...recipe.gemStash }, meal: null, sackedUntilDay: 0 },
    quests: { active, completed: [...completed], tracked: Object.keys(active)[0] ?? null, trackedVillage: null }, locations: { spentTriggers },
    empire: { lastSettledWeek: Math.floor(recipe.hours / 168), tributePaid: 0, goldPaid: 0, siegesFought: 0, emperorDefeated: recipe.seals.length > 0,
      seals: [...new Set(recipe.seals)], castleCleared: recipe.seals.length > 0, deepestTier: Math.max(0, ...recipe.seals), crystals: 0,
      winterSeals: NO_HEART_LADDER().seals, heartTier: 0 } };
  if (!isLoadable(save)) throw new Error('Scenario failed save-format validation.');
  return { save, implied };
}
