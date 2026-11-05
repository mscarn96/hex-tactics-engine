import { villageBuffUnit } from '@/systems/economy/villageBuffEffects';
import type { VillageBuffId } from '@/systems/economy/villageBuffs';
import { BALANCE } from '@/data/balanceConstants';
import type { FactionId } from '@/data/templates/factions';
import { CombatUnit, EncounterWave, Hero, HexCoord, POIType, TileType } from '@/models/types';
import type { EncounterEntry } from '@/models/encounterEntry';
import { createEnemyUnits, createPlayerUnits, createRivalUnits, enemyContentLevel, enemyPowerLevel, generateEnemyPositions, generatePlayerPositions, templateStrength } from '@/systems/combat/unitFactory';
import { enemyFormation } from '@/systems/combat/eliteKits';
import { battleIntroIdentity } from '@/systems/combat/battleIntro';
import { isQuestSiteId } from '@/quests/sites';
import { siteName } from '@/quests/questText';
import { CastleRun } from '@/systems/combat/combatRewards';
import { curatedBand, EncounterPlan, isWanderingFight, planForEncounter } from '@/systems/world/encounterGenerator';
import { CHEST_GUARD_POWER_MULT, chestGuardBand, isChestGuard } from '@/systems/world/finds';
import { castleEnemyHp, castleStagePower } from '@/systems/world/castle';
import { shapeName } from '@/systems/world/encounterShapes';
import { summitTierFromId, summitTierScale } from '@/systems/world/summit';
import { heartTierFromId, heartTierScale } from '@/systems/world/heartRefight';
import { shrineOfEncounter } from '@/systems/world/shrines';
import { siegePowerScale, siegeWeekFromId } from '@/systems/world/tribute';
import { sparesStrength } from '@/systems/combat/runDifficulty';
import { lateGroundPremium, neutralDepth, ThreatBand, threatDepth, threatEncounterSize, threatPowerScale } from '@/systems/world/threat';
import type { ThreatRadii, WorldId } from '@/data/worlds';
import { battleQuestTargets } from '@/systems/quests/questEvents';
import type { QuestTargetLine } from '@/systems/quests/battleQuests';
import { hexDistance } from '@/utils/hexUtils';
import { blessUnit, type Vows } from '@/systems/world/monastery';
import { contentLevel } from '@/systems/world/contentLevel';
import { bandGroundPower, bandPowerStep } from '@/systems/world/bandPower';
import { levelBand } from '@/systems/world/worldBands';

/**
 * Who stands where, and how hard they hit, when a fight opens.
 *
 * These rules were `useMemo`s and a `useEffect` in `CombatScene`: the band a
 * fight is fought at, whether it is on haunted ground, the one multiplier that
 * decides how strong its bodies are, and the roster built from them. Every one is
 * a function of the tile, the encounter and the party, so none needed a screen.
 * They are here so a harness can open the same fight the app does — the perf
 * launcher's test used to carry a copy of the init because the scene was the only
 * way in.
 */

// ─── Where the fight is ───────────────────────────────────────────────────────

/** What the scene reads off the world to ask what the ground is worth. */
export interface EncounterGround {
  /** The tile the party stands on, when the world has one. */
  tile?: { type: TileType; threat?: number; frost?: boolean };
  partyPosition: HexCoord;
  /** The home city, or `null` before one is founded. */
  cityCoord: HexCoord | null;
  /** The Obsidian castle, or `null` when the map has none. */
  castleCoord: HexCoord | null;
  /**
   * The current world's threat anchors and radii, which set the depth. Without
   * them the city, the castle and the Empire's radii do.
   */
  anchors?: { home: HexCoord; far: HexCoord; radii: ThreatRadii };
  /** The fight is on the overworld, on ground that is off the road (`EncounterContext.danger`). */
  onDangerGround: boolean;
  /** The world the party stands in, whose factions walk its open map. The Empire when absent. */
  world?: WorldId;
}

/** The castle's hex on a map, if it has one. */
export function castleCoordOf(tiles: Iterable<{ poi?: POIType; coord: HexCoord }>): HexCoord | null {
  for (const tile of tiles) if (tile.poi === POIType.EmpireCastle) return tile.coord;
  return null;
}

export interface EncounterTerms {
  /** The terrain the party stands on, which picks the background and part of the roster. */
  tileType: TileType;
  /** The tile is under frost (`MapTile.frost`), which makes snowy highlands winter ground. */
  frost: boolean;
  /** A curated fight's own band (a lair chamber, a quest site), or `null` for a wandering one. */
  curated: ThreatBand | null;
  /** The fight is the guard of a chest, built and paid one band above the ground it lies on. */
  guardsChest: boolean;
  /**
   * The band this fight is scaled and paid at.
   *
   * A curated fight states its own and only a wandering one reads the ground. That
   * split existed in `generateEncounterEnemies` from the start; the *bodies* were
   * curated while the multiplier they were built with came off the tile the party
   * was standing on, which for a lair is its door on the overworld.
   */
  threatBand: ThreatBand;
  /**
   * The ground's own band, which sets its level beyond the Empire: `threatBand`, but for a
   * chest's guards, who are built a band above the ground they stand on and fight at its level.
   */
  groundBand: ThreatBand;
  /**
   * Whether this fight is being fought on haunted ground: the second difficulty axis.
   * A curated fight is never on it — a lair chamber is indoors, and a quest site is
   * a POI that `mapGenerator` places in haunted ground on purpose.
   */
  haunted: boolean;
  /** How far the fight is from the Obsidian castle, which keeps the emperor's troops on their doorstep. */
  fromCastle: number;
  /**
   * How deep into its band the ground is. A curated fight has no ground, so it takes
   * the depth at which its band scales by exactly one (`neutralDepth`); so does a
   * chest's guard and a map with no city.
   */
  groundDepth: number;
  /** The world the fight is in: a wandering fight draws only that world's factions (`Faction.worlds`). */
  world: WorldId;
}

export function encounterTerms(encounterId: string | null | undefined, ground: EncounterGround): EncounterTerms {
  const curated = curatedBand(encounterId);
  const guardsChest = isChestGuard(encounterId);
  const tileThreat = ground.tile?.threat ?? 0;
  const threatBand: ThreatBand = curated
    ?? (guardsChest ? chestGuardBand(tileThreat) : (tileThreat as ThreatBand));
  const haunted = curated === null && ground.onDangerGround;
  const { partyPosition, cityCoord, castleCoord } = ground;
  const groundDepth = curated !== null
    ? neutralDepth(curated)
    : guardsChest
      ? neutralDepth(threatBand)
      : ground.anchors
        ? threatDepth(partyPosition, ground.anchors.home, ground.anchors.far, ground.anchors.radii).depth
        : cityCoord
        ? threatDepth(partyPosition, cityCoord, castleCoord).depth
        : neutralDepth(threatBand);
  return {
    tileType: ground.tile?.type ?? TileType.Plains,
    frost: ground.tile?.frost === true,
    curated,
    guardsChest,
    threatBand,
    groundBand: curated ?? (tileThreat as ThreatBand),
    haunted,
    fromCastle: castleCoord ? hexDistance(partyPosition, castleCoord) : Infinity,
    groundDepth,
    world: ground.world ?? 'empire',
  };
}

// ─── How strong they are ──────────────────────────────────────────────────────

export interface PowerScaleInput {
  encounterId: string | null | undefined;
  terms: Pick<EncounterTerms, 'threatBand' | 'groundDepth' | 'haunted' | 'guardsChest'>
    & Partial<Pick<EncounterTerms, 'world' | 'groundBand'>>;
  castleRun: CastleRun | null;
  /** The tuning harness states its own multiplier outright. */
  sim: { active: boolean; powerScale: number };
  /**
   * Jadeveil's wrath on this fight (`monastery.blessedWrathPower`), 1 or absent
   * anywhere else. Ground fights only: a castle stage, a siege and the harness
   * price themselves.
   */
  wrathPower?: number;
}

/**
 * The one multiplier layered on the level scaling of an enemy roster.
 *
 * Five sources, and they never overlap: the harness states its own so a fight can
 * be made harder without pretending to stand on a tile; a castle stage is priced
 * by its tier; a siege by its week; a chest's guards by the threat of the ground
 * and a premium on top; every other fight by the ground alone.
 *
 * Beyond the Empire every fight also takes its level band's power (`bandPower.ts`): the
 * whole table on ground fights, and only the step from band 1 on a lair boss and on Kairen,
 * whose own tuning stays on top. Repeatable content takes the step of the cap it stands at.
 */
export function encounterPowerScale({ encounterId, terms, castleRun, sim, wrathPower }: PowerScaleInput): number {
  // A castle stage first, even in the harness: its chain is the game's run, priced stage by stage
  // (`simCastle.ts`), and the harness's single multiplier would price all four alike
  if (castleRun !== null) return castleStagePower(castleRun.tier, castleRun.stage);
  if (sim.active) return sim.powerScale;
  // Jadeveil: Kairen is priced by his tier alone. He is only fought at a full bar of
  // wrath, so its multiplier would be a constant: his authored stats carry the fight,
  // and wrath's power is not laid on him (the vows on the party still are)
  const world = terms.world ?? 'empire';
  const content = contentLevel({ world, encounterId, threatBand: terms.groundBand ?? terms.threatBand });
  const contentBand = content ? levelBand(content.level) : null;
  const summitTier = summitTierFromId(encounterId);
  if (summitTier !== null) return summitTierScale(summitTier) * (contentBand !== null ? bandPowerStep(contentBand) : 1);
  const siegeWeek = siegeWeekFromId(encounterId ?? '');
  if (siegeWeek !== null) return siegePowerScale(siegeWeek);
  // The Heart's Seal refight is the lair's boss fight at its price, × its tier
  const heartTier = heartTierFromId(encounterId);
  const bossFight = (encounterId ?? '').endsWith('_boss') || heartTier !== null;
  return (heartTier !== null ? heartTierScale(heartTier) : 1)
    * threatPowerScale(terms.threatBand, terms.groundDepth, terms.haunted)
    * (terms.guardsChest ? CHEST_GUARD_POWER_MULT : 1)
    // The late campaign's premium, on everything but a lair boss's own fight
    * (bossFight ? 1 : lateGroundPremium(terms.threatBand))
    // A world's bands restart at its camp; its ground is priced above the Empire's
    * (contentBand === null ? 1 : bossFight ? bandPowerStep(contentBand) : bandGroundPower(contentBand))
    // A shrine's keepers stand above the ground they hold (`composeShrineKeepers`)
    * (shrineOfEncounter(encounterId) !== null ? BALANCE.SHRINE_KEEPER_POWER : 1)
    // Jadeveil's wandering fights are wider (`JADEVEIL_ENCOUNTER_SIZE`); each body gives back the
    // strength the extra ones add, so the fight's total is the Empire-sized one
    * (terms.world === 'jadeveil' && isWanderingFight(encounterId) && !terms.guardsChest
      ? threatEncounterSize(terms.threatBand) / BALANCE.JADEVEIL_ENCOUNTER_SIZE[terms.threatBand] : 1)
    * (wrathPower ?? 1);
}

// ─── Who turns up ─────────────────────────────────────────────────────────────

export interface BuildContext extends PowerScaleInput {
  heroes: Hero[];
  terms: EncounterTerms;
  /** The committed snapshot of this fight, when a saved game resumed mid-encounter. */
  entry: EncounterEntry | null;
  /** The monastery's vows, when the fight is in Jadeveil; they bless the party's units. */
  vows?: Vows;
  /** The village buff held, which the party's units start the fight under (`villageBuffUnit`). */
  villageBuff?: VillageBuffId | null;
  /**
   * PvP proof of concept: heroes fielded as the enemy side in place of the plan's monsters, built
   * exactly as the party's units are and handed to the enemy AI. Wear gear already in the inventory.
   */
  foes?: Hero[];
}

export interface BuiltEncounter {
  plan: EncounterPlan;
  players: CombatUnit[];
  enemies: CombatUnit[];
  enemyPositions: HexCoord[];
  /**
   * The level enemies scale to, since they wear no equipment: the average party level, or
   * beyond the Empire the content's fixed level (`contentLevel.ts`), whoever the party is.
   */
  partyLevel: number;
  powerScale: number;
  /** A home-ring fight: its bodies, waves and summons are spared `ENEMY_STRENGTH` (`sparesStrength`). */
  spared: boolean;
  /** The level enemies read as beyond the Empire, when the fight has a content level. */
  contentLevel?: number;
  /** Announced reinforcements, built later at this fight's own scaling. */
  waves: EncounterWave[];
  /** Resumed from a snapshot, rather than made now. */
  restored: boolean;
  /** What the opening banner says: who turned up, and what the party is hunting among them. */
  intro: {
    headline: string;
    tagline?: string;
    /**
     * The faction whose picture the card shows (`ENCOUNTER_ART`): set only for a
     * fight met wandering the open map and introduced by its faction's name.
     */
    artFaction?: FactionId;
    quests: QuestTargetLine[];
    waves: number;
  };
  /** The snapshot a saved game restarts this fight from, once this one is committed. */
  snapshot: EncounterEntry;
}

/**
 * The fight, made.
 *
 * Pure but for the dice a plan and a roster roll: nothing is read from, or written
 * to, a store. The scene writes the result into the combat store and the game
 * store; a harness does the same with its own party.
 */
export function buildEncounter(ctx: BuildContext): BuiltEncounter {
  const { heroes, terms, entry } = ctx;
  const encounterId = ctx.encounterId ?? null;
  // A snapshot of this very fight that has not been resolved yet is resumed whole
  const saved = entry && entry.id === encounterId && !entry.resolved
    ? JSON.parse(JSON.stringify(entry)) as EncounterEntry
    : null;

  const plan = saved?.plan ?? planForEncounter(encounterId, terms.threatBand, terms.tileType, terms.fromCastle, terms.world, terms.frost);
  // A warband with a Captain stands with him behind a screen; every other roster is laid
  // out in the two ranks it always was
  const foes = ctx.foes?.length ? ctx.foes : null;
  const enemyPositions = foes ? generateEnemyPositions(foes.length)
    : enemyFormation(plan.enemies) ?? generateEnemyPositions(plan.enemies.length);
  // Vows bless the units as they are made; a resumed fight's were blessed when it was
  const players = saved?.players
    ?? createPlayerUnits(heroes, generatePlayerPositions(heroes.length))
      .map((u) => (ctx.vows ? blessUnit(u, ctx.vows) : u))
      .map((u) => villageBuffUnit(u, ctx.villageBuff ?? null));
  // The harness, the castle and a PvP side price themselves; beyond the Empire everything else is
  // fixed by where it stands. The fight reads its level from here, its readout included
  const content = ctx.sim.active || ctx.castleRun !== null || foes
    ? null
    : contentLevel({ world: terms.world, encounterId, threatBand: terms.groundBand });
  // Enemies carry no equipment, so they scale off the party's level instead
  // A resumed fight keeps the numbers it was built with
  const partyLevel = saved?.partyLevel
    ?? content?.level
    ?? (heroes.length ? heroes.reduce((sum, h) => sum + h.level, 0) / heroes.length : 1);
  const powerScale = saved?.powerScale ?? encounterPowerScale(ctx);
  const summitTier = summitTierFromId(encounterId);
  const heartTier = heartTierFromId(encounterId);
  const spared = sparesStrength(terms.threatBand, ctx.castleRun !== null || siegeWeekFromId(encounterId ?? '') !== null);
  const enemies = saved?.enemies ?? (foes
    ? createRivalUnits(foes, enemyPositions)
    : createEnemyUnits(plan.enemies, enemyPositions, partyLevel, powerScale, spared, content ? partyLevel : undefined))
    // Jadeveil: Kairen carries the Storm Seal tier he is fought at, for its twist
    .map((u) => (summitTier !== null && u.templateId === 'kairen' ? { ...u, challengeTier: summitTier } : u))
    // The Heart its Winter Seal tier, which its twists read (`heartScript.heartTierOf`)
    .map((u) => (heartTier !== null && u.templateId === 'heart_of_winter' ? { ...u, challengeTier: heartTier } : u))
    // And Aethelred the Seal tier, which his standards' backlash falls with (`placementBacklash`)
    .map((u) => (ctx.castleRun !== null && u.templateId === 'aethelred' ? { ...u, challengeTier: ctx.castleRun.tier } : u))
    // A castle stage's bodies carry less health than its multiplier gives them; a resumed one already does
    .map((u) => {
      if (saved || ctx.castleRun === null) return u;
      const maxHp = castleEnemyHp(u.stats.maxHp);
      return { ...u, stats: { ...u.stats, maxHp }, currentHp: maxHp };
    });
  // The readout is derived from the fight's committed power, even when its
  // bodies are restored. Retuning labels must not reroll or rescale their stats.
  if (saved) {
    for (const enemy of enemies) {
      enemy.level = content
        ? enemyContentLevel(partyLevel, templateStrength(enemy.templateId))
        : enemyPowerLevel(partyLevel, powerScale, templateStrength(enemy.templateId));
    }
  }

  const waves = plan.waves ?? [];
  const site = encounterId ?? undefined;
  const { factionId: named, ...identity } = battleIntroIdentity(
    enemies, plan.factionId ?? undefined, plan.shape ? shapeName(plan.shape.id) : undefined,
    isQuestSiteId(site) ? siteName(site) : undefined,
  );
  return {
    plan,
    players,
    enemies,
    enemyPositions,
    partyLevel,
    powerScale,
    spared,
    ...(content ? { contentLevel: partyLevel } : {}),
    waves,
    restored: saved !== null,
    intro: {
      ...identity,
      ...(named && isWanderingFight(encounterId) && { artFaction: named }),
      // Quest targets among these bodies (reinforcements included, since they will all come)
      quests: battleQuestTargets([
        ...enemies.map((u) => u.templateId ?? ''),
        ...waves.flatMap((w) => w.templateIds),
      ]),
      waves: waves.length,
    },
    snapshot: saved ?? { id: encounterId ?? '', plan, players, enemies, partyLevel, powerScale, resolved: false },
  };
}
