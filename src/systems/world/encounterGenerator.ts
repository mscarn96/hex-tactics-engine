import { useQuestStore } from '@/stores/questStore';
import { questById, type QuestRecord } from '@/systems/quests/quests';
import type { QuestId } from '@/quests/types';
import { useHuntStore } from '@/stores/huntStore';
import { BALANCE } from '@/data/balanceConstants';
import { questSite, siteEnemies, siteFaction } from '@/quests/sites';
import { enemyTemplates } from "@/data/templates/enemyTemplates";
import { TileType } from "@/models/types";
import { siegeArmySize, siegeWeekFromId } from "@/systems/world/tribute";
import { castleRunFromId, castleStageEnemies } from "@/systems/world/castle";
import { ThreatBand } from "@/systems/world/threat";
import { SHRINE_KEEPERS, shrineBand, shrineOfEncounter } from "@/systems/world/shrines";
import { summitTierFromId } from "@/systems/world/summit";
import { HEART_LAIR_BOSS_ENCOUNTER, heartTierFromId } from "@/systems/world/heartRefight";
import { isChestGuard } from "@/systems/world/finds";
import { SIM_ENCOUNTER_ID, useSimStore } from "@/stores/simStore";
import { LAIR_SPECS } from "@/locations/lairs";
import {
  EnemyRole,
  Faction,
  FactionId,
  atHome,
  factionCandidates,
  factionMembers,
  findFaction,
  membersForRole,
} from "@/data/templates/factions";
import { EncounterShape, huntStandIns, shapesFor } from "@/systems/world/encounterShapes";
import { huntedTemplates } from "@/systems/quests/questEvents";
import { wavesForPlan } from "@/data/templates/encounterWaves";
import type { EncounterWave } from "@/models/types";
import type { WorldId } from "@/data/worlds";
import { villageSpec } from "@/data/villages";
import { garrisonExtraBodies, villageOfEncounter } from "@/systems/world/villageGarrison";

export type DifficultyTier = "easy" | "medium" | "hard" | "boss";

/**
 * The id every wandering warband the party walks into is fought under.
 *
 * One id for every interception, so its arena is arranged the same way on every
 * tile of a terrain: the scenery is seeded on the encounter id.
 */
export const WARBAND_ENCOUNTER_ID = 'random_danger';

/**
 * Whether a fight is opposition met wandering the open map — a warband walked
 * into, or a chest's guards — rather than a lair, a quest site, the castle or
 * the siege. Those are the fights whose opening card shows the faction's
 * picture (`ENCOUNTER_ART`): the pictures are of each faction out on its own
 * ground, which a lair chamber or the castle is not. A missing id is the
 * `easy` default `planForEncounter` gives it.
 */
export function isWanderingFight(encounterId: string | null | undefined): boolean {
  return encounterId == null || encounterId === WARBAND_ENCOUNTER_ID
    || ['easy', 'medium', 'hard'].includes(encounterId) || isChestGuard(encounterId);
}

/**
 * The band every quest site is fought at, wherever it sits on the map.
 *
 * Two is the first band that fields an elite (`threatEliteCount`), which is what
 * makes a quest fight read as a step up from the ground around it without
 * reading the ground at all.
 */
const QUEST_BAND: ThreatBand = 2;

/**
 * The band a **curated** fight composes at, or `null` for a wandering one.
 *
 * The other half of "a curated fight ignores the ground it stands on", and for a
 * long time only the first half was built. `generateEncounterEnemies` has always
 * composed a lair chamber at its `LairSpec.band` and a quest site at
 * `QUEST_BAND` — but the *stat multiplier* those bodies were then built with came
 * from `threatPowerScale(tile.threat, depth, haunted)` read off the party's world
 * hex, which for a lair is its **door**. So who turned up was curated and how
 * hard they hit was a lottery on where `mapGenerator` happened to drop that door.
 *
 * It is not a small lottery. Boss tiles are placed from a shuffled pool with
 * nothing but "at least 8 hexes from the city" constraining them, and every door
 * sits in haunted ground by construction. The Warren is gated at summed party
 * level 8 and composes at band 2 — `×1.56` — but a door landing deep in band 4
 * built those same bodies at `×2.65`, a **70% swing on identical opposition**,
 * invisible from inside the lair and different in every save. A playtest at
 * summed level 26 reported being decimated in a few turns by the first lair in
 * the game, which is exactly what that arithmetic predicts.
 *
 * Exported so the scene reads the curated band from the same place the composer
 * does. Two spellings of "which band is this fight" is how they came apart in the
 * first place.
 */
export function curatedBand(encounterId: string | null | undefined): ThreatBand | null {
  if (!encounterId) return null;
  // The Heart's Seal refight is the lair's own boss fight, at its band; its tier prices it
  // (`encounterSetup.encounterPowerScale`)
  if (heartTierFromId(encounterId) !== null) return curatedBand(HEART_LAIR_BOSS_ENCOUNTER);

  if (encounterId.startsWith("lair_")) {
    const spec = LAIR_SPECS.find((l) => encounterId.startsWith(l.id));
    if (!spec) return null;
    // The boss, the entry chamber and the chest guard are the spec's band; the
    // second chamber is one harder, matching the composition exactly.
    if (encounterId.endsWith("_2")) return Math.min(4, spec.band + 1) as ThreatBand;
    return spec.band;
  }

  if (encounterId.startsWith("quest_")) return questSite(encounterId)?.band ?? QUEST_BAND;

  const shrine = shrineOfEncounter(encounterId);
  if (shrine !== null) return shrineBand(shrine);

  const garrison = villageOfEncounter(encounterId);
  if (garrison) return garrison.band;

  // Jadeveil: Kairen on the summit, the top band — though his power is his own
  // (`encounterSetup.encounterPowerScale`), his ground is still the range's highest
  if (summitTierFromId(encounterId) !== null) return 4;

  // The castle and the siege have curated *compositions* but state their own
  // multipliers (`castleTierScale`, `siegePowerScale`), which already take
  // precedence in the scene. Returning null keeps this the answer to one
  // question rather than two.
  return null;
}

/**
 * Everything a scene needs to open a fight: who is here, and who they are.
 *
 * The faction used to be thrown away the moment the bodies were picked, which
 * is why `Faction.tagline` sat unread with a comment promising an encounter
 * banner. `factionId` is null for the fights that genuinely have no faction —
 * the tuning harness, and a lone boss.
 */
export interface EncounterPlan {
  enemies: string[];
  factionId: FactionId | null;
  shape: EncounterShape | null;
  /** Reinforcements the fight announces. Absent for most fights. */
  waves?: EncounterWave[];
  hunt?: { key: string; targets: string[] };
}

const unfactioned = (enemies: string[]): EncounterPlan =>
  ({ enemies, factionId: null, shape: null });

export function planEncounter(
  encounterId: string,
  /**
   * Danger band of the tile the fight is happening on.
   *
   * Random encounters are built entirely from this — it decides how many enemies
   * turn up and how many of them are elites. Curated encounters (bosses, quests,
   * the siege) ignore it: their composition is the point.
   */
  threat: ThreatBand = 0,
  /** Terrain of the tile, which biases which faction turns up. */
  terrain: TileType = TileType.Plains,
  /**
   * Hexes from the Obsidian castle.
   *
   * Separate from `threat` because a band is not a location: band 3 is reached
   * by standing near the castle *or* by being far from the city, and only the
   * first should ever produce a Legion patrol. Defaults to "nowhere near it".
   */
  fromCastle: number = Infinity,
  /**
   * Templates an active quest is asking the player to kill.
   *
   * A thumb on the scale for random encounters only — curated fights below
   * return before it is ever consulted, because a lair boss does not change
   * species because somebody wants wolf pelts.
   */
  hunted: readonly string[] = [],
  /** The world the fight is in, whose factions a wandering fight draws (`Faction.worlds`). */
  world: WorldId = 'empire',
  /** The tile is under frost (`MapTile.frost`): snowy highlands are winter ground. */
  frost: boolean = false,
): EncounterPlan {
  // The tuning harness names its opposition outright. Checked first so nothing
  // downstream can reinterpret it.
  if (encounterId === SIM_ENCOUNTER_ID || encounterId.startsWith(`${SIM_ENCOUNTER_ID}:`)) {
    return unfactioned([...useSimStore.getState().enemies]);
  }

  // Inside the castle. Curated stage by stage — the composition *is* the
  // content, so the tile's threat band and terrain have nothing to say here.
  const run = castleRunFromId(encounterId);
  if (run) {
    return {
      enemies: castleStageEnemies(run.tier, run.stage),
      factionId: 'obsidian_legion',
      shape: null,
    };
  }

  // The Legion collecting in person.
  const siegeWeek = siegeWeekFromId(encounterId);
  if (siegeWeek !== null) {
    return { enemies: siegeArmy(siegeWeek), factionId: 'obsidian_legion', shape: null };
  }

  // Named boss encounters. `wildTemplates` is doing real work here: the map
  // carries six boss tiles indexed `boss_0`…`boss_5`, and with Aethelred in the
  // global boss list `boss_3` would have put the emperor on a lair tile.
  // Lair encounters: `lair_<name>_1`, `_2`, `_boss`.
  //
  // The two guard rooms are wide fights and the boss is one creature, which is
  // the shape the lair is built around — the guards spend the party's resources
  // and the boss asks what is left. Tier climbs with the lair, so the third
  // lair's chaff is the first lair's boss.
  if (encounterId.startsWith("lair_")) {
    const spec = LAIR_SPECS.find((l) => encounterId.startsWith(l.id));
    if (spec) {
      // The boss is named on the spec. It used to be `bosses[lairIndex]` over
      // the tier list in file order, which put the dragon in the *first* lair.
      // A lair boss is the faction's own, so the banner still names them.
      if (encounterId.endsWith("_boss")) {
        return { enemies: [spec.boss], factionId: spec.faction, shape: null };
      }
      // The second chamber is one band harder *and* one body wider — the run
      // gets worse as it goes in, which is the whole reason a lair is rooms
      // rather than a door. Both levers are needed: the deepest lair is already
      // at the highest band there is, so the band bump alone does nothing there.
      //
      // `_chest` falls through to the same arrangement as `_1` on purpose: it is
      // optional content off the main route, so it is a real fight but never the
      // hardest one in the lair. Skipping the detour has to stay a legitimate
      // read of the resources left, not the obviously correct one.
      const deeper = encounterId.endsWith("_2");
      const band = deeper ? (Math.min(4, spec.band + 1) as ThreatBand) : spec.band;
      return composeForFaction(spec.faction, band, deeper ? 1 : 0);
    }
  }

  // A shrine's keepers: its faction's whole roster at its band, because the claim opens the band above
  const shrine = shrineOfEncounter(encounterId);
  if (shrine !== null) return composeShrineKeepers(SHRINE_KEEPERS[shrine], shrineBand(shrine));

  // A village's garrison: its occupier at the band its id names, a camp's width,
  // and the same bodies on every visit — the roll is seeded by the village.
  const garrison = villageOfEncounter(encounterId);
  if (garrison) {
    const occupier = villageSpec(garrison.theme).occupier;
    return composeForFaction(occupier, garrison.band, garrisonExtraBodies(occupier), seededRng(encounterId));
  }

  // Jadeveil: Kairen alone on the Cloud Crown; his brood comes later, from him
  if (summitTierFromId(encounterId) !== null) return { enemies: ['kairen'], factionId: 'draconic_host', shape: null };

  if (encounterId.startsWith("boss_")) {
    const bosses = wildTemplates("boss");
    const idx = parseInt(encounterId.split("_")[1] ?? "0") % bosses.length;
    return unfactioned([bosses[idx].id]);
  }

  // Quest encounters — a warband that came here, not a pile of the nearest
  // bodies.
  //
  // This was `elite + normals[0] × 2`, and `normals[0]` is the first normal
  // template in *file order*, which is the Goblin Whelp — so every quest fight
  // in the game was an elite plus two of the feeblest things the roster has,
  // mixing two factions to do it.
  //
  // Composed at a **fixed** band rather than the tile's, which keeps the rule
  // this function is built around: a curated fight ignores the ground it stands
  // on, or it is not curated. Terrain still colours *who* turns up, because that
  // costs the invariant nothing. `hunted` is deliberately not passed — a quest
  // site does not change species because somebody else wants wolf pelts.
  if (encounterId.startsWith("quest_")) {
    const enemies = siteEnemies(encounterId);
    if (enemies) return { enemies, factionId: siteFaction(encounterId), shape: null };
    return composeForBand(QUEST_BAND, terrain, fromCastle, [], Math.random, world, frost);
  }

  // A chest's guards are wandering opposition at the band `chestGuardBand`
  // gives them, drawn from a wider pool than a warband — see `chestGuardCandidates`.
  if (isChestGuard(encounterId)) return composeChestGuard(threat, terrain, fromCastle, hunted, Math.random, world, frost);

  // Everything else is a random encounter, sized and staffed by the ground it
  // happens on — at the band the tile actually says, with no bump.
  //
  // A danger tile used to fight one band above its surroundings, on the theory
  // that burned ground is the part you think twice about. But encounters fire
  // *only* on danger tiles, so there were no surroundings to be worse than: the
  // bump was a silent +1 on every fight in the game, and it made the threat
  // label the map shows you wrong by exactly one band. The gradient is supposed
  // to warn you, and a warning that is off by one is not one.
  return composeForBand(threat, terrain, fromCastle, hunted, Math.random, world, frost);
}

/**
 * Just the bodies. The shape of this call is what most of the game and every
 * test wants, so it stays — `planEncounter` is for the one caller that opens a
 * scene and has to name who turned up.
 */
export function generateEncounterEnemies(
  encounterId: string,
  threat: ThreatBand = 0,
  terrain: TileType = TileType.Plains,
  fromCastle: number = Infinity,
  hunted: readonly string[] = [],
): string[] {
  return planEncounter(encounterId, threat, terrain, fromCastle, hunted).enemies;
}

/**
 * The tier pool that curated non-Legion fights draw from.
 *
 * The Legion is the endgame and arrives on its own terms — at the siege, at the
 * castle, and in the two worst threat bands. A quest site three hours from the
 * city picking a Dread-Knight out of the global elite list because it happened
 * to land on that index would give the whole reveal away, and index-based picks
 * are exactly the kind of thing that quietly shifts when a template is added.
 */
function wildTemplates(tier: "normal" | "elite" | "boss") {
  const legion = new Set<string>([...factionMembers('obsidian_legion'), 'aethelred']);
  return enemyTemplates.filter((t) => t.tier === tier && !legion.has(t.id));
}

/**
 * The shape of the army at the gate, filled from the front.
 *
 * Elites lead so the dangerous part of the army is the part that reaches you
 * first, and the pattern repeats rather than escalating: a week-16 siege is the
 * same army with more of it, plus `siegePowerScale` on every stat block. Growth
 * by both count and strength is the design settled in §7 — more of them *and*
 * tougher versions of them.
 */
const SIEGE_SHAPE: EnemyRole[] = [
  'elite', 'front', 'caster',
  'front', 'elite', 'front',
  'caster', 'front',
];

/** The role the `slot`-th soldier at the gate fills. Past the shape, the army is front line. */
export function siegeRole(slot: number): EnemyRole {
  return SIEGE_SHAPE[slot] ?? 'front';
}

function siegeArmy(week: number): string[] {
  const legion = findFaction('obsidian_legion');
  const size = siegeArmySize(week);
  if (!legion) return [];

  // Deterministic, not random: the siege is the fight the player has been
  // watching the calendar count down to, and it should be the same army for
  // the same week rather than a roll they can reload their way out of.
  //
  // Each role takes its members in turn, counted within the role. Counting
  // along the whole army picked `members[slot % length]`, and the shape puts
  // every front place on an odd slot and every elite on an even one — so each
  // two-soldier role sent the same soldier every time, and the Infantry and
  // the Dread-Knight never came to the gate at all.
  const fielded = new Map<EnemyRole, number>();
  return Array.from({ length: size }, (_, slot) => {
    const role = siegeRole(slot);
    const members = membersForRole(legion, role);
    const nth = fielded.get(role) ?? 0;
    fielded.set(role, nth + 1);
    return members[nth % members.length];
  });
}

/** Injectable so tests can enumerate instead of sampling. See `generateForBand`. */
export type Rng = () => number;

/** A deterministic stream from a string (mulberry32 over an FNV hash): the same fight every time. */
function seededRng(seed: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickOne = <T,>(arr: T[], rng: Rng = Math.random): T =>
  arr[Math.floor(rng() * arr.length)];

/**
 * The shape table lives in `encounterShapes.ts` and is re-exported here.
 *
 * It moved because `questHints` has to derive *which bands actually field a
 * template* from it, and this module imports `questEvents` for
 * `huntedTemplates()` — so a hint importing the composer would close a cycle
 * through the quest layer. Re-exported rather than relocated in every caller:
 * the composer is still where a reader looks for how a fight is put together.
 */
export {
  shapesFor,
  shapesAtBand,
  shapeViolations,
  bandsFielding,
} from "@/systems/world/encounterShapes";
export type { EncounterShape } from "@/systems/world/encounterShapes";

function pickShape(shapes: EncounterShape[], rng: Rng): EncounterShape {
  // Weights as repeats, the same way `factionCandidates` expresses terrain — one
  // way of saying "more likely" in this codebase rather than two.
  const weighted = shapes.flatMap((s) => Array(s.weight ?? 1).fill(s) as EncounterShape[]);
  return pickOne(weighted, rng);
}

/**
 * Fills an encounter for a band from a single faction's roster.
 *
 * Composition only — the stat multiplier is applied separately when the units
 * are built, so a band-3 goblin is a band-3 goblin rather than a different
 * template. That split is what keeps the roster small while the difficulty
 * curve stays long.
 *
 * One faction per fight, always. A mixed encounter reads as the pool it came
 * from rather than as a group that travelled together, which is the whole thing
 * factions exist to fix.
 */
export interface ComposedEncounter {
  factionId: FactionId;
  /** Which arrangement was rolled. The banner names it; tests assert on it. */
  shape: EncounterShape;
  enemies: string[];
}

/** Fills a shape from one roster, preferring anything an objective is hunting. */
function fillShape(
  faction: Faction,
  shape: EncounterShape,
  want: Set<string>,
  rng: Rng,
): string[] {
  return shape.roles.map((role) => {
    const members = membersForRole(faction, role, shape.id);
    // Once the pack is the one you were looking for, its wolves are wolves —
    // otherwise a Beast warband could still come up all giant spiders and the
    // objective would not move despite the roll going the player's way.
    const wanted = members.filter((m) => want.has(m));
    return pickOne(wanted.length > 0 ? wanted : members, rng);
  });
}

/**
 * A fight from a **named** faction at a named band.
 *
 * The curated path. A lair says who holds it, so its guard chambers obey the
 * same one-faction rule as everything else — and unlike `composeForBand` the
 * faction is not required to be eligible for the band, because a curated fight
 * is allowed to put a roster somewhere the wandering rules never would.
 */
export function composeForFaction(
  factionId: FactionId,
  band: ThreatBand,
  /**
   * Bodies beyond the band's own size.
   *
   * Only curated fights may ask for this, and only because they are not part of
   * the wandering difficulty curve — a random encounter is pinned to
   * `threatEncounterSize` precisely so no shape can smuggle in extra actions per
   * round. A lair chamber is the castle's trick instead: count *and* strength,
   * two levers that multiply, which is the only way the deepest lair can
   * escalate at all once its band is already the highest one there is.
   *
   * The extra slots repeat the last **non-elite** role, so widening a chamber
   * adds bodies rather than quietly doubling the elites.
   */
  extraBodies: number = 0,
  rng: Rng = Math.random,
): ComposedEncounter {
  const faction = findFaction(factionId);
  if (!faction) throw new Error(`composeForFaction: no faction "${factionId}"`);
  const base = pickShape(shapesFor(band, faction), rng);

  const filler = [...base.roles].reverse().find((r) => r !== 'elite') ?? 'front';
  const shape: EncounterShape = extraBodies > 0
    ? { ...base, roles: [...base.roles, ...Array<EnemyRole>(extraBodies).fill(filler)] }
    : base;

  return { factionId, shape, enemies: fillShape(faction, shape, new Set(), rng) };
}

/** The order a shrine's keepers are drawn in: the line, the archers and casters, the elites, then any chaff. */
const KEEPER_ROLES: EnemyRole[] = ['front', 'ranged', 'caster', 'elite', 'chaff'];

/**
 * A shrine's keepers: one of every kind its faction fields, each once, to
 * `BALANCE.SHRINE_KEEPERS` bodies — not one of its warbands one body wider, which
 * the playtest of 2026-10-28 found far too easy for a claim that opens the band
 * above. Elites in a role are shuffled so a faction with more kinds than places
 * varies which stands; a roster with fewer kinds than places repeats from the top.
 */
export function composeShrineKeepers(factionId: FactionId, band: ThreatBand, rng: Rng = Math.random): ComposedEncounter {
  const faction = findFaction(factionId);
  if (!faction) throw new Error(`composeShrineKeepers: no faction "${factionId}"`);
  const kinds: { role: EnemyRole; id: string }[] = [];
  for (const role of KEEPER_ROLES) {
    const members = [...faction.roles[role]];
    while (members.length > 0) {
      const id = members.splice(Math.floor(rng() * members.length), 1)[0];
      if (!kinds.some((k) => k.id === id)) kinds.push({ role, id });
    }
  }
  const picked = Array.from({ length: BALANCE.SHRINE_KEEPERS }, (_, i) => kinds[i % kinds.length]);
  const base = pickShape(shapesFor(band, faction), rng);
  return {
    factionId,
    shape: { ...base, roles: picked.map((k) => k.role) },
    enemies: picked.map((k) => k.id),
  };
}

export function composeForBand(
  band: ThreatBand,
  terrain: TileType = TileType.Plains,
  fromCastle: number = Infinity,
  /** See `generateEncounterEnemies`. Empty means "nobody is hunting anything". */
  hunted: readonly string[] = [],
  /**
   * Injected so a test can enumerate the table instead of sampling it, and so a
   * future "a warband is camped here" map preview can roll the same fight twice.
   * Deliberately *not* seeded per tile today: there is no tile identity to seed
   * from (a random fight's encounter id is the literal `random_danger`), the
   * tile's encounter is consumed on arrival so it cannot present twice, and
   * combat is not persisted mid-fight so there is nothing to save-scum.
   */
  rng: Rng = Math.random,
  world: WorldId = 'empire',
  frost: boolean = false,
): ComposedEncounter {
  const want = new Set(hunted);

  // Faction first, then shape — never the other way round. Narrowing the
  // candidate pool by shape would skew the faction distribution the hunt
  // weighting is tuned against, and worse, it can empty the pool: the fallback
  // in `factionCandidates` then returns every non-Legion faction *regardless of
  // band*, which puts the Coven in the home ring.
  const faction = pickOne(huntWeighted(factionCandidates(band, terrain, fromCastle, world, frost), want, terrain, frost), rng);
  const shape = pickShape(shapesFor(band, faction), rng);

  return { factionId: faction.id, shape, enemies: fillShape(faction, shape, want, rng) };
}

export function generateForBand(
  band: ThreatBand,
  terrain: TileType = TileType.Plains,
  fromCastle: number = Infinity,
  hunted: readonly string[] = [],
  rng: Rng = Math.random,
): string[] {
  return composeForBand(band, terrain, fromCastle, hunted, rng).enemies;
}

/**
 * Who may guard a chest: the factions of the ground it lies on **and** of the
 * band its guards fight at, with home ground weighted more gently than a
 * wandering fight weights it.
 *
 * A chest's guards fight one band above the ground (`chestGuardBand`), and
 * composing them from that band's candidates alone handed most chests to one
 * faction. Chests lie on haunted plains and highlands more than anything else,
 * and from band 3 up the Thunder Herd is the only native of either — so the
 * band bump moved band-2 plains chests, which the Greenskins and the Brigands
 * share with the Herd, onto ground where the Herd held 3 of 8 entries, and a
 * band-4 plains chest 3 of 5. Every guard of a Herd chest, waves included, is a
 * centaur. A playtest of 2026-10-09 asked whether chests were always centaurs.
 *
 * The union keeps the guards the region's own (nothing is drawn that could not
 * be met on one of the two bands, on this terrain, at this distance from the
 * castle) while letting the ground's residents keep their chest. A faction keeps
 * its higher weight across the two bands, at `CHEST_GUARD_HOME_WEIGHT` entries
 * for a native against one for an outsider.
 */
export function chestGuardCandidates(
  band: ThreatBand,
  terrain: TileType,
  fromCastle: number = Infinity,
  world: WorldId = 'empire',
  frost: boolean = false,
): Faction[] {
  const bands: ThreatBand[] = band > 0 ? [(band - 1) as ThreatBand, band] : [band];
  const best = new Map<FactionId, { faction: Faction; native: boolean }>();
  for (const b of bands) {
    const counts = new Map<FactionId, number>();
    const seen = new Map<FactionId, Faction>();
    for (const f of factionCandidates(b, terrain, fromCastle, world, frost)) {
      counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
      seen.set(f.id, f);
    }
    for (const [id, faction] of seen) {
      const native = (counts.get(id) ?? 0) > 1 || best.get(id)?.native === true;
      best.set(id, { faction, native });
    }
  }
  const home = BALANCE.EXPLORATION_FINDS.CHEST_GUARD_HOME_WEIGHT;
  const weighted: Faction[] = [];
  for (const { faction, native } of best.values()) {
    for (let i = 0; i < (native ? home : 1); i++) weighted.push(faction);
  }
  return weighted;
}

/** A chest's guards: `composeForBand`, from `chestGuardCandidates`' wider pool. */
export function composeChestGuard(
  band: ThreatBand,
  terrain: TileType = TileType.Plains,
  fromCastle: number = Infinity,
  hunted: readonly string[] = [],
  rng: Rng = Math.random,
  world: WorldId = 'empire',
  frost: boolean = false,
): ComposedEncounter {
  const want = new Set(hunted);
  const faction = pickOne(huntWeighted(chestGuardCandidates(band, terrain, fromCastle, world, frost), want, terrain, frost), rng);
  const shape = pickShape(shapesFor(band, faction), rng);
  return { factionId: faction.id, shape, enemies: fillShape(faction, shape, want, rng) };
}

/**
 * Re-weights the faction pool toward whoever fields what the player is hunting.
 *
 * Without this a "kill five wolves" objective is a lottery run at whatever rate
 * random encounters happen to fire: Beasts are one of three factions at band 0
 * and terrain-weighted *against* on plains, so on a bad map the pack the gate
 * captain is worried about simply never turns up, and the quest reads as broken
 * rather than as unlucky. The world noticing what you are looking for is a
 * kinder lie than a player walking in circles for four in-game weeks.
 *
 * Expressed as duplicate entries, the same way `factionCandidates` expresses
 * terrain — so the two weightings compose instead of overriding each other, and
 * a faction that fields nothing hunted stays entirely possible.
 */
function huntWeighted(candidates: Faction[], want: Set<string>, terrain: TileType, frost: boolean): Faction[] {
  if (want.size === 0) return candidates;
  const weighted: Faction[] = [];
  for (const faction of candidates) {
    weighted.push(faction);
    // Only on the hunted faction's own ground: a roamer met off it is a stray,
    // and a hunt must not make strays common. A locked faction is a candidate
    // only at home, so the lock needs no clause of its own here.
    if (atHome(faction, terrain, frost) && factionMembers(faction.id).some((m) => want.has(m))) {
      for (let i = 0; i < HUNT_WEIGHT - 1; i++) weighted.push(faction);
    }
  }
  return weighted;
}

/**
 * How much more likely a hunted faction is, per candidate entry it already had.
 *
 * Five times the existing terrain-weighted entries, on the hunted faction's own
 * ground only; legality still comes from the faction and shape tables. A separate miss guarantee bounds unlucky runs.
 */
const HUNT_WEIGHT = BALANCE.QUEST_HUNT_WEIGHT;

/**
 * The plan for an encounter, as the game asks for it.
 *
 * `planEncounter` is the rule and takes the hunted list as an argument so it
 * stays free of the quest log. This is the adapter that supplies it — and the
 * `easy` default for a fight with no id — so no caller has to remember that an
 * active `kill` objective is supposed to bend who turns up.
 */
export function planForEncounter(
  encounterId: string | null,
  threat: ThreatBand,
  terrain: TileType,
  fromCastle: number,
  world: WorldId = 'empire',
  frost: boolean = false,
): EncounterPlan {
  // The Heart's Seal refight fields the lair's own boss fight: the Heart, which opens with its anchors
  const id = heartTierFromId(encounterId) !== null ? HEART_LAIR_BOSS_ENCOUNTER : encounterId ?? "easy";
  const wanted = huntedTemplates();
  let plan: EncounterPlan | null = null;
  let hunt: EncounterPlan['hunt'];
  if (id === WARBAND_ENCOUNTER_ID || ['easy', 'medium', 'hard'].includes(id)) {
    // Home ground only: a hunt fight waits for a tile where the hunted faction
    // lives, rather than fielding a roamer's stray band the hint never promised
    const options = huntPlans(threat, terrain, fromCastle, wanted, world, frost);
    const targets = [...new Set(options.flatMap(o => o.targets))].sort();
    if (targets.length) {
      const key = Object.entries(useQuestStore.getState().active).flatMap(([questId, record]) =>
        record ? questById(questId as Parameters<typeof questById>[0]).stages[record.stage]?.objectives.flatMap((o, i) =>
          o.kind === 'kill' && (record.progress[i] ?? 0) < o.count ? [`${questId}:${record.stage}:${i}:${o.templates.slice().sort().join(',')}`] : []) ?? [] : []).sort().join('|');
      const streak = useHuntStore.getState().streak;
      hunt = { key, targets };
      // PT-01: on the quarry's own ground most fights are the hunt (`QUEST_HUNT_CHANCE`),
      // and the miss streak still guarantees one when the roll keeps failing.
      const missedOut = streak.key === key && streak.misses >= BALANCE.QUEST_HUNT_MISSES;
      if (missedOut || Math.random() < BALANCE.QUEST_HUNT_CHANCE) {
        const { active, tracked } = useQuestStore.getState();
        // The first unfinished objective this ground can field at all: a named
        // unit before a faction-wide group, the tracked quest before the rest.
        const quarry = huntQuarry(active, tracked).find(set => set.some(t => targets.some(x => x === t)));
        const want: readonly string[] = quarry ?? targets;
        const serving = options.filter(o => o.targets.some(t => want.includes(t)));
        const chosen = pickHuntPlan(serving.length ? serving : options, Math.random);
        const hunted = new Set(chosen.targets.filter(t => want.includes(t)));
        const enemies = fillShape(chosen.faction, chosen.shape, hunted, Math.random);
        if (chosen.standIn) {
          // No shape of this band fields the quarry: it takes one chaff slot (`huntStandIns`)
          enemies[chosen.shape.roles.indexOf('chaff')] = pickOne([...hunted], Math.random);
        }
        plan = { factionId: chosen.faction.id, shape: chosen.shape, enemies };
      } else {
        // The roll is the whole of the hunt here: the rest are the ground's
        // ordinary fights, unweighted, so the rate stays near the chance at
        // every band instead of climbing wherever the shapes already hold the quarry
        plan = planEncounter(id, threat, terrain, fromCastle, [], world, frost);
      }
    }
  }
  plan ??= planEncounter(id, threat, terrain, fromCastle, wanted, world, frost);
  if (hunt) plan.hunt = hunt;
  // Attached here rather than in the composer: the roster is the rule's input,
  // and a plan with no waves must stay exactly what it was.
  plan = widenForJadeveil(id, plan, threat, world);
  const waves = wavesForPlan(id, plan);
  return waves.length > 0 ? { ...plan, waves } : plan;
}

/**
 * Jadeveil's wandering fights field `JADEVEIL_ENCOUNTER_SIZE` bodies, because the
 * party walks the range with four heroes from its first step. The extra slots
 * repeat the shape's last non-elite role (as a wider lair chamber does), so the
 * elite count stays the band's. `jadeveilSizeScale` takes the strength back out.
 */
function widenForJadeveil(id: string, plan: EncounterPlan, band: ThreatBand, world: WorldId): EncounterPlan {
  if (world !== 'jadeveil' || !isWanderingFight(id) || isChestGuard(id) || !plan.shape || !plan.factionId) return plan;
  const faction = findFaction(plan.factionId);
  const extra = BALANCE.JADEVEIL_ENCOUNTER_SIZE[band] - plan.enemies.length;
  if (!faction || extra <= 0) return plan;
  const filler = [...plan.shape.roles].reverse().find((r) => r !== 'elite') ?? 'front';
  const roles = [...plan.shape.roles, ...Array<EnemyRole>(extra).fill(filler)];
  const added = Array.from({ length: extra }, () => pickOne(membersForRole(faction, filler, plan.shape!.id), Math.random));
  return { ...plan, shape: { ...plan.shape, roles }, enemies: [...plan.enemies, ...added] };
}

/**
 * The unfinished kill objectives' templates, in the order the guaranteed hunt
 * fight serves them.
 *
 * An objective naming a **unit** ("the brigand captain") comes before one
 * naming a whole group (`group`: "Brigands"), and the tracked quest comes first
 * within each. The guarantee used to take the first fieldable template of the
 * tracked quest, so a stage asking for six brigands *and* their captain was
 * handed a footpad every time — the right faction, never the unit the stage
 * was stuck on. A faction-wide objective is still served, as the fallback.
 */
export function huntQuarry(
  active: Partial<Record<QuestId, QuestRecord>>,
  tracked: QuestId | null,
): string[][] {
  const named: string[][] = [];
  const groups: string[][] = [];
  const ids = Object.keys(active) as QuestId[];
  const order = tracked && active[tracked] ? [tracked, ...ids.filter(id => id !== tracked)] : ids;
  for (const id of order) {
    const record = active[id];
    if (!record) continue;
    questById(id).stages[record.stage]?.objectives.forEach((o, i) => {
      if (o.kind !== 'kill' || (record.progress[i] ?? 0) >= o.count) return;
      (o.group ? groups : named).push([...o.templates]);
    });
  }
  return [...named, ...groups];
}

/** The bodies alone, for callers with no banner to fill. */
export function enemiesForEncounter(
  encounterId: string | null,
  threat: ThreatBand,
  terrain: TileType,
  fromCastle: number,
): string[] {
  return planForEncounter(encounterId, threat, terrain, fromCastle).enemies;
}

/** Legal faction/shape pairs that can actually field an unfinished hunt target. */
export function eligibleHuntPlans(band: ThreatBand, terrain: TileType, fromCastle: number, wanted: readonly string[], world: WorldId = 'empire', frost: boolean = false) {
  const want = new Set(wanted);
  return [...new Set(factionCandidates(band, terrain, fromCastle, world, frost))].flatMap(faction =>
    shapesFor(band, faction).flatMap(shape => {
      const targets = [...new Set(shape.roles.flatMap(role => membersForRole(faction, role, shape.id).filter(m => want.has(m))))];
      return targets.length ? [{ faction, shape, targets }] : [];
    }));
}

/** A fight the hunt path can field: a faction, a shape, and the hunted templates it can hold. */
export interface HuntPlan {
  faction: Faction;
  shape: EncounterShape;
  targets: string[];
  /** The targets take a chaff slot rather than one of the shape's own (`huntStandIns`). */
  standIn?: boolean;
}

/**
 * Shapes with a chaff slot a hunted shooter or caster can stand in, for the
 * targets no legal shape of this band fields (`huntStandIns`).
 */
export function standInHuntPlans(band: ThreatBand, terrain: TileType, fromCastle: number, wanted: readonly string[], world: WorldId = 'empire', frost: boolean = false): HuntPlan[] {
  const want = new Set(wanted);
  return [...new Set(factionCandidates(band, terrain, fromCastle, world, frost))].flatMap(faction => {
    const targets = huntStandIns(faction, want);
    if (!targets.length) return [];
    return shapesFor(band, faction)
      .filter(shape => shape.roles.includes('chaff'))
      .map(shape => ({ faction, shape, targets, standIn: true }));
  });
}

/**
 * Every fight the hunt path may field on this tile: home ground only, legal
 * shapes first, and stand-ins only for targets no legal shape here can hold.
 */
export function huntPlans(band: ThreatBand, terrain: TileType, fromCastle: number, wanted: readonly string[], world: WorldId = 'empire', frost: boolean = false): HuntPlan[] {
  const home = (o: HuntPlan) => atHome(o.faction, terrain, frost);
  const legal: HuntPlan[] = eligibleHuntPlans(band, terrain, fromCastle, wanted, world, frost).filter(home);
  const covered = new Set(legal.flatMap(o => o.targets));
  const standIns = standInHuntPlans(band, terrain, fromCastle, wanted, world, frost)
    .filter(home)
    .map(o => ({ ...o, targets: o.targets.filter(t => !covered.has(t)) }))
    .filter(o => o.targets.length > 0);
  return [...legal, ...standIns];
}

/** One of the hunt fights, weighted by shape the way `pickShape` weights a band. */
function pickHuntPlan(options: HuntPlan[], rng: Rng): HuntPlan {
  return pickOne(options.flatMap(o => Array(o.shape.weight ?? 1).fill(o) as HuntPlan[]), rng);
}
