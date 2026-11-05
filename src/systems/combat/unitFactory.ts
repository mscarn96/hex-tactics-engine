

import { difficultyHp } from '@/systems/combat/runDifficulty';

import * as Crypto from '@/platform/uuid';


import { CombatUnit, Hero, HeroStats, HexCoord, EnemyTemplate, Item } from '@/models/types';



import { withBloodRush, withHardenedShell } from '@/systems/combat/passives';
import { fightStartAuras } from '@/systems/combat/beetle';
import { withFarLight } from '@/systems/combat/fireflyRules';



import { skillsForForm } from '@/systems/combat/wildshape';

import { getEffectiveStats } from '@/systems/progression/statCalc';

import { applyMasteryModifiers, masteryFormRanks, masteryModifiers, masteryPassives, masteryPassiveRanks } from '@/systems/progression/mastery';

import { enemyTemplates } from '@/data/templates/enemyTemplates';

import { selectGear, useInventoryStore } from '@/stores/inventoryStore';

import { EquippedItems, equippedItemsFor } from '@/systems/progression/equipRules';

import { basicAttackFor } from '@/systems/combat/basicAttack';

import { BALANCE } from '@/data/balanceConstants';
import { highestLevelCap } from '@/data/levelCap';
import { usesChi } from '@/data/classResource';
import { THREAT_BANDS, threatPowerScale, lateGroundPremium } from '@/systems/world/threat';
import { castleGarrisonScale, castleTierScale } from '@/systems/world/castle';


import { magicDefenseOf } from '@/systems/combat/damageType';
import { ARENA_Q_MAX, ARENA_R_MAX } from '@/systems/combat/arenaGeometry';
import { templateName } from '@/data/templates/unitText';



export function createPlayerUnits(
  heroes: Hero[],
  startPositions: HexCoord[],
  /**
   * What the heroes are wearing is looked up here, because the Basic Attack is
   * read off the weapon in hand. The whole bag, resolved per hero through
   * `equippedItemsFor`; `getEffectiveStats` still does its own lookup.
   */
  items: readonly Item[] = selectGear(useInventoryStore.getState()),
): CombatUnit[] {
  return heroes.map((hero, i) =>
    playerUnitFor(hero, equippedItemsFor(hero, items), {
      id: `pu_${Crypto.randomUUID()}`,
      position: startPositions[i] ?? { q: -2 + i, r: 4 },
    }),
  );
}


/**
 * Heroes fielded as the enemy side (PvP): built exactly as the party's units are, with the gear in the
 * inventory, then turned to face the party and handed to the enemy AI.
 */
export function createRivalUnits(heroes: Hero[], startPositions: HexCoord[]): CombatUnit[] {
  return createPlayerUnits(heroes, startPositions)
    .map((u) => ({ ...u, id: u.id.replace(/^pu_/, 'pvp_'), isPlayer: false, facingAngle: 0 }));
}

/**
 * One hero as the unit a fight would field, wearing `equipped`: effective stats,
 * the mastery-tuned kit with the Basic Attack the hand makes, passives and their
 * ranks. `createPlayerUnits` is this per hero; the hero sheet and the level-up
 * card call it through `heroAsCaster` so a skill described outside a fight is
 * described from the same unit — set bonuses, lifesteal nodes and all.
 */
export function playerUnitFor(
  hero: Hero,
  equipped: EquippedItems,
  place: { id: string; position: HexCoord },
): CombatUnit {
  // Modifiers are baked into the skill list here, once, so the HUD, the
  // targeting highlights and the damage resolution all read the same numbers.
  // A range bonus the highlight knew about but the range check did not would
  // let a player click a hex the skill then refused.
  const modifiers = masteryModifiers(hero);
  const stats = getEffectiveStats(hero);
  const chi = usesChi(hero.heroClass);
  /**
   * The whole kit, tuned once — form skills included.
   *
   * This is what `humanSkills` carries and what every later `skillsForForm`
   * draws on, so the modifiers are baked here and nowhere else: the upright
   * list below is a *filter* of it, and a shift is a different filter of the
   * same list. Baking them twice is how a range bonus gets added twice.
   */
  //
  // The Basic Attack leads it, built from the weapon worn *now*: it is not on
  // `hero.skills` because it is not a thing the hero owns, it is a thing the
  // hero is holding. A Wildshape beast filters it out like any other upright
  // skill — the shapes carry their own free attack.
  const basic = basicAttackFor(hero, equipped);
  // Blood Rush rewrites Bloodthirst here too, beside the modifiers, so the
  // highlights, the inspector and the resolver all see the dash; Far Light
  // lengthens three Firefly skills the same way, and Hardened Shell gives Iron Carapace its reach
  const passiveRanks = masteryPassiveRanks(hero);
  const kit = [basic, ...hero.skills].map((s) => withHardenedShell(
    withFarLight(withBloodRush(applyMasteryModifiers(s, modifiers), passiveRanks), passiveRanks), passiveRanks));
  return {
    id: place.id,
    name: hero.name,
    isPlayer: true,
    heroId: hero.id,
    level: hero.level,
    templateId: hero.templateId,
    stats,
    currentHp: hero.currentHp,
    // The fallback is the pool the unit will actually cast from. `baseStats`
    // here meant a hero whose mana had never been written started a fight
    // short of the bar the HUD then drew.
    // Chi is full at every fight start, a castle stage included: its pressure
    // is inside each fight, never carried between them.
    currentMana: chi ? stats.maxMana : hero.currentMana ?? stats.maxMana,
    ...(chi && { resource: 'chi' as const }),
    position: place.position,
    // `skillsForForm(null, …)` rather than the raw list: a hero standing
    // upright is a shape too, and it is the one that cannot use a bear's
    // skills. Routing the opening kit through the same function that builds
    // every later one means there is no second place to keep in step.
    skills: skillsForForm(null, kit, modifiers),
    /**
     * And the unfiltered list has to survive, or the filter is the only copy.
     *
     * `skillsForForm(null, …)` strips every `formSkill`, so a `setWildForm`
     * falling back to `unit.skills` on the first shift stashed a list those
     * skills had already been removed from — which made all twelve tier-2
     * Wildshape nodes grant a button that could never appear, in any shape.
     */
    humanSkills: kit,
    passives: masteryPassives(hero),
    // Which rung each shape was bought to. Read here beside `passiveRanks`
    // and for the same reason: the level is a fact about the tree, and
    // `setWildForm` has only the unit.
    formRanks: masteryFormRanks(hero),
    // Read here beside the list itself rather than looked up per resolution:
    // the two are one fact, and a passive present in one and absent from the
    // other is the drift that left every ranked passive flat for a version.
    passiveRanks,
    masteryModifiers: modifiers,
    masteryPath: hero.masteryPath,
    hasMoved: false,
    hasActed: false,
    facingAngle: Math.PI, // players face toward enemies (−Z)
    // Shoulder to Shoulder's badge, worn all fight (`beetle.fightStartAuras`)
    activeEffects: fightStartAuras({ id: place.id, passives: masteryPassives(hero), passiveRanks }),
  };
}


/**
 * A hero as the caster of their own skills, outside a fight: what the hero
 * sheet and the level-up card describe a skill from, so "for 15 damage" there
 * is the number the first swing of the next fight will be built from.
 */
export function heroAsCaster(hero: Hero, equipped: EquippedItems): CombatUnit {
  return playerUnitFor(hero, equipped, { id: `sheet_${hero.id}`, position: { q: 0, r: 0 } });
}


export function createEnemyUnits(
  templateIds: string[],
  startPositions: HexCoord[],
  /** Average party level. Enemies scale to it, since they wear no equipment. */
  partyLevel: number = 1,
  /**
   * Encounter-specific multiplier layered on top of the level scaling.
   *
   * Separate from `partyLevel` on purpose: the level scaling keeps an enemy
   * relevant, while this says "this particular fight is harder than usual". The
   * siege uses it to grow on the calendar; the dungeon tiers will use it next.
   */
  powerScale: number = 1,
  /** A home-ring fight's bodies: spared `ENEMY_STRENGTH` (`runDifficulty.sparesStrength`). */
  spared = false,
  /** The fight's content level beyond the Empire, which its enemies read as (`enemyContentLevel`). */
  contentLevel?: number,
): CombatUnit[] {
  return templateIds.map((templateId, i) => {
    const template = enemyTemplates.find((t) => t.id === templateId);
    const position = startPositions[i] ?? { q: 1 - i, r: -4 };
    // Fallback goblin — an unknown id must not silently drop a body from the
    // encounter, which would quietly make the fight easier
    return makeEnemyUnit(template ?? enemyTemplates[0], position, partyLevel, powerScale, spared, contentLevel);
  });
}


/**
 * Scales an enemy template to the party it is fighting.
 *
 * Enemy templates are authored at level 1 and never gain anything, while a
 * hero's nine equipment slots roughly double their sheet by the level cap.
 * `moveRange` and `maxMana` are deliberately left alone — scaling movement
 * changes the shape of the arena, not its difficulty.
 */
export function scaleEnemyStats(base: HeroStats, partyLevel: number, powerScale: number, spared = false): HeroStats {
  const mul = (1 + BALANCE.ENEMY_LEVEL_SCALE * Math.max(0, partyLevel - 1)) * powerScale;
  return difficultyHp({
    ...base,
    maxHp: Math.round(base.maxHp * mul),
    attack: Math.round(base.attack * mul),
    defense: Math.round(base.defense * mul),
    magicDefense: Math.round(magicDefenseOf(base) * mul),
    magic: Math.round(base.magic * mul),
    speed: Math.round(base.speed * mul),
  }, undefined, spared);
}

// Calibrate the label to the first campaign, rather than invert the hero stat curve.
// Near-town opening ground is the floor. The ceiling is the strongest world/lair
// ground or castle tier, fought at the hero cap. Siege weeks and harness extremes
// may exceed that strength, but their readout still stays inside the same range.
const openingEnemyPower = threatPowerScale(0, 0, false);
const peakEncounterScale = Math.max(
  ...THREAT_BANDS.map(band => threatPowerScale(band, 1, true) * lateGroundPremium(band)
    * Math.max(1, BALANCE.EXPLORATION_FINDS.CHEST_GUARD_POWER_MULT)),
  castleTierScale(BALANCE.MAX_SEAL_TIER),
  castleGarrisonScale(BALANCE.MAX_SEAL_TIER),
);
const peakEnemyPower = (1 + BALANCE.ENEMY_LEVEL_SCALE * (BALANCE.MAX_LEVEL - 1)) * peakEncounterScale;

/** A template's raw weight: the geometric mean of its health and its larger offensive stat. */
const rawStrength = (base: Pick<HeroStats, 'maxHp' | 'attack' | 'magic'>): number =>
  Math.sqrt(Math.max(1, base.maxHp) * Math.max(1, base.attack, base.magic));

/** The ordinary enemy a strength of 1 means: the median of the normal-tier templates. */
const referenceStrength = (() => {
  const normal = enemyTemplates.filter((t) => t.tier === 'normal').map((t) => rawStrength(t.baseStats)).sort((a, b) => a - b);
  return normal[Math.floor(normal.length / 2)] ?? 1;
})();

/**
 * How strong a creature is against the ordinary enemy, before any scaling: a
 * goblin whelp about 0.5, a Rime Jarl 2.4, a Dread-Knight 4, Aethelred 18. The
 * playtest of 2026-10-14 asked the level to say what kind of power a creature
 * is, and the multiplier alone said only how far its template had been scaled —
 * a pup and a Dread-Knight in one fight read the same.
 */
export function templateStrength(templateId: string | undefined): number {
  const template = templateId ? enemyTemplates.find((t) => t.id === templateId) : undefined;
  return template ? rawStrength(template.baseStats) / referenceStrength : 1;
}

/**
 * Compress the combined party/encounter power into a rounded campaign level;
 * never changes stats. `strength` is the creature's own (`templateStrength`),
 * weighed in at `ENEMY_LEVEL_TEMPLATE_WEIGHT` (a square root): a whole factor
 * would put every late elite on the cap, so the range would stop telling them
 * apart. An ordinary template (strength 1) reads as the multiplier alone did.
 */
export function enemyPowerLevel(partyLevel: number, powerScale: number, strength = 1): number {
  const multiplier = (1 + BALANCE.ENEMY_LEVEL_SCALE * Math.max(0, partyLevel - 1)) * powerScale
    * Math.pow(Math.max(0.01, strength), BALANCE.ENEMY_LEVEL_TEMPLATE_WEIGHT);
  const [min, max] = BALANCE.ENEMY_DISPLAY_LEVEL_RANGE;
  const progress = (multiplier - openingEnemyPower) / (peakEnemyPower - openingEnemyPower);
  return Math.min(max, Math.max(min, Math.round(min + (max - min) * progress)));
}


/**
 * The level an enemy reads as beyond the Empire: its fight's content level, nudged by how strong
 * its kind is, inside the expansion levels (21–40). Never changes stats. The Empire's compressed
 * range (`enemyPowerLevel`) says how far a multiplier has climbed; here the level is already a
 * number the player can hold their own against.
 */
export function enemyContentLevel(contentLevel: number, strength = 1): number {
  const reach = BALANCE.ENEMY_CONTENT_LEVEL_NUDGE_MAX;
  const nudge = Math.max(-reach, Math.min(reach, BALANCE.ENEMY_CONTENT_LEVEL_NUDGE * Math.log2(Math.max(0.01, strength))));
  return Math.min(highestLevelCap(), Math.max(BALANCE.MAX_LEVEL + 1, Math.round(contentLevel + nudge)));
}

function makeEnemyUnit(
  template: EnemyTemplate,
  position: HexCoord,
  partyLevel: number,
  powerScale: number = 1,
  spared = false,
  contentLevel?: number,
): CombatUnit {
  const stats = scaleEnemyStats(template.baseStats, partyLevel, powerScale, spared);
  return {
    id: `eu_${Crypto.randomUUID()}`,
    name: templateName(template.id),
    level: contentLevel !== undefined
      ? enemyContentLevel(contentLevel, templateStrength(template.id))
      : enemyPowerLevel(partyLevel, powerScale, templateStrength(template.id)),
    ...(contentLevel !== undefined && { contentLevel }),
    isPlayer: false,
    templateId: template.id,
    blow: template.blow,
    // Preserve Medium's existing rounded-HP strength recovery exactly. Difficulty
    // never enters this number, so the same summon sheet is inherited at all levels.
    enemyStatScale: Math.round(template.baseStats.maxHp * (1 + BALANCE.ENEMY_LEVEL_SCALE * Math.max(0, partyLevel - 1)) * powerScale) / template.baseStats.maxHp,
    stats,
    ...(spared && { sparedStrength: true }),
    currentHp: stats.maxHp,
    currentMana: 0,
    position,
    skills: template.skills,
    passives: template.passives,
    hasMoved: false,
    hasActed: false,
    facingAngle: 0, // enemies face toward players (+Z)
    activeEffects: [],
  };
}


/**
 * Spawn rows per side, back row first.
 *
 * Hardcoded here rather than in `BALANCE` because they are not a tunable: they
 * are derived from `ARENA_R_MAX`, and moving one without re-deriving the other
 * puts units outside `inArena`.
 *
 * A single row only holds five units (the arena's hexagonal corner clips the
 * back rows), which is why a sixth enemy used to be placed on an unreachable
 * hex. Two rows give eight per side with room to spare.
 */
const PLAYER_SPAWN_ROWS = [4, 3];

const ENEMY_SPAWN_ROWS = [-4, -3];


/** The inclusive `q` span that `inArena` admits on row `r`. */
function legalQRange(r: number): { min: number; max: number } {
  // |q| ≤ Q_MAX and |q + r| ≤ R_MAX — the second bound is what shortens the
  // rows nearest the arena's far corners.
  return {
    min: Math.max(-ARENA_Q_MAX, -ARENA_R_MAX - r),
    max: Math.min(ARENA_Q_MAX, ARENA_R_MAX - r),
  };
}


/**
 * Lays `count` units out across `rows`, filling each row before spilling into
 * the next and centring every row so a formation reads as deliberate rather
 * than left-aligned.
 *
 * Throws rather than returning a hex outside the arena: an over-full encounter
 * is a content bug, and silently spawning a unit that can neither move nor be
 * targeted hides it until someone plays that fight.
 */
function generateSpawnPositions(count: number, rows: number[]): HexCoord[] {
  if (count < 0) throw new Error(`generateSpawnPositions: negative count ${count}`);

  const capacities = rows.map((r) => {
    const { min, max } = legalQRange(r);
    return max - min + 1;
  });
  const capacity = capacities.reduce((a, b) => a + b, 0);
  if (count > capacity) {
    throw new Error(
      `generateSpawnPositions: cannot place ${count} units on rows [${rows.join(', ')}] (capacity ${capacity})`
    );
  }

  const positions: HexCoord[] = [];
  let remaining = count;
  for (let i = 0; i < rows.length && remaining > 0; i++) {
    const r = rows[i];
    const inRow = Math.min(remaining, capacities[i]);
    const { min } = legalQRange(r);
    const start = min + Math.floor((capacities[i] - inRow) / 2);
    for (let j = 0; j < inRow; j++) positions.push({ q: start + j, r });
    remaining -= inRow;
  }
  return positions;
}


export function generatePlayerPositions(count: number): HexCoord[] {
  return generateSpawnPositions(count, PLAYER_SPAWN_ROWS);
}


export function generateEnemyPositions(count: number): HexCoord[] {
  return generateSpawnPositions(count, ENEMY_SPAWN_ROWS);
}
