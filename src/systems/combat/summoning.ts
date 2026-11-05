import { difficultyHp } from '@/systems/combat/runDifficulty';
import * as Crypto from '@/platform/uuid';
import { CombatUnit, HeroStats, HexCoord, SummonSpec } from '@/models/types';
import { hexDistance, hexKey, getHexesInRange } from '@/utils/hexUtils';
import { SummonTemplate, findSummonTemplate } from '@/data/templates/summonTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { inArena } from '@/systems/combat/arenaGeometry';
import { magicDefenseOf } from '@/systems/combat/damageType';
import { combatMaxHp } from '@/systems/combat/forms';
import { t } from '@/i18n';
import { templateName } from '@/data/templates/unitText';

/**
 * Calling creatures into a fight.
 *
 * Summons are ordinary `CombatUnit`s in every respect except two: they have no
 * `heroId`, and they exist only in `combatStore`. Nothing writes them to
 * `partyStore`, so they cannot be equipped, cannot earn XP, and disappear the
 * moment combat state is dropped — which is exactly the "vanish at battle end"
 * requirement, achieved by not building the thing that would persist them.
 *
 * They inherit `isPlayer` from their summoner, so a hero's elemental fights the
 * enemy and a necromancer's skeletons fight the party with no branching.
 */

/** How far out from the caster to look for space before giving up. */
const MAX_SUMMON_RADIUS = 3;

/**
 * Free hexes for `count` summons, nearest to the caster first.
 *
 * Returns fewer than requested — possibly none — when the caster is boxed in.
 * Callers decide whether a partial summon is acceptable; `executeSkill` treats
 * zero as a failed cast so the player doesn't silently lose a turn and the mana.
 */
export function findSummonHexes(
  origin: HexCoord,
  count: number,
  allUnits: CombatUnit[],
): HexCoord[] {
  const occupied = new Set(
    allUnits.filter((u) => u.currentHp > 0).map((u) => hexKey(u.position)),
  );

  return getHexesInRange(origin, MAX_SUMMON_RADIUS)
    .filter((h) => inArena(h) && !occupied.has(hexKey(h)) && hexKey(h) !== hexKey(origin))
    // Closest first, so a summon lands beside its caster rather than across the arena
    .sort((a, b) => hexDistance(origin, a) - hexDistance(origin, b))
    .slice(0, count);
}

/**
 * Scales a summon to its caster's level, matching how encounter enemies scale.
 *
 * Without it a level-20 Arcanist's elemental would be as weak as a level-5
 * one's, which makes the capstone worse the further you get.
 */
function scaleForLevel(base: number, level: number): number {
  return Math.round(base * (1 + BALANCE.ENEMY_LEVEL_SCALE * Math.max(0, level - 1)));
}

/**
 * A summon template's sheet at a given caster level.
 *
 * Exported because `transformUnit` builds the next stage of a staged summon
 * from the same arithmetic — a second copy would drift the moment the scaling
 * constant moves, and only on the path nobody looks at.
 */
export function summonStatsFor(
  template: SummonTemplate,
  casterLevel: number,
  /** The node rank's share of the template's numbers; see `SummonSpec.statScale`. */
  strength = 1,
): HeroStats {
  const scaled = (base: number) => Math.round(scaleForLevel(base, casterLevel) * strength);
  return {
    ...template.baseStats,
    maxHp: scaled(template.baseStats.maxHp),
    attack: scaled(template.baseStats.attack),
    defense: scaled(template.baseStats.defense),
    magicDefense: scaled(magicDefenseOf(template.baseStats)),
    magic: scaled(template.baseStats.magic),
  };
}

export function createSummonUnits(
  spec: SummonSpec,
  caster: CombatUnit,
  positions: HexCoord[],
  casterLevel: number = 1,
): CombatUnit[] {
  const template = findSummonTemplate(spec.templateId);
  if (!template) return [];

  return positions.slice(0, spec.count).map((position, i) => {
    const scaled = summonStatsFor(template, casterLevel, spec.statScale);
    // A companion's Magic is a share of its owner's, never the template's
    const echoed = template.companion && spec.echoMagic !== undefined
      ? { ...scaled, magic: companionMagic(caster.stats.magic, spec.echoMagic) }
      : scaled;
    // A share of the caster's own health (the Lantern Beacon), the rung's strength on the share
    const base = spec.ofCasterMaxHp !== undefined
      ? { ...echoed, maxHp: casterShareHp(caster, spec.ofCasterMaxHp * (spec.statScale ?? 1)) }
      : echoed;
    const stats = caster.isPlayer ? base : difficultyHp(base, undefined, caster.sparedStrength);

    return {
      id: `su_${Crypto.randomUUID()}`,
      // Numbered when there is more than one, so the log stays readable
      name: spec.count > 1
        ? t('units.numbered', { name: templateName(template.id), number: i + 1 })
        : templateName(template.id),
      ...(spec.count > 1 && { nameIndex: i + 1 }),
      isPlayer: caster.isPlayer,
      templateId: template.id,
      ...(caster.sparedStrength && { sparedStrength: true }),
      summonedBy: caster.id,
      summonTurnsLeft: spec.duration,
      ...(template.companion && { companion: true, echoMagic: spec.echoMagic ?? 0 }),
      stats,
      currentHp: stats.maxHp,
      currentMana: 0,
      position,
      skills: template.skills,
      hasMoved: false,
      hasActed: false,
      // Face the way the caster is facing — usually toward the enemy
      facingAngle: caster.facingAngle,
      activeEffects: [],
    };
  });
}

/** A share of the caster's combat maximum HP, rounded, never below 1. */
export function casterShareHp(caster: CombatUnit, share: number): number {
  return Math.max(1, Math.round(combatMaxHp(caster) * share));
}

/** A unit that exists only for this battle. */
export function isSummon(unit: CombatUnit): boolean {
  return unit.summonedBy !== undefined;
}

/** A companion's Magic: its share of its owner's, rounded, never below zero. */
export function companionMagic(ownerMagic: number, share: number): number {
  return Math.max(0, Math.round(ownerMagic * share));
}

/**
 * Where a companion stands after its owner moved to `ownerPos`: where it already is
 * if that is beside the owner, else the nearest free arena hex beside the owner,
 * else the nearest free one within `MAX_SUMMON_RADIUS`, else nowhere new
 * (`undefined`: it stays put rather than overlapping anyone). Distance never
 * matters — a blink across the arena is followed — and nothing is walked, so the
 * companion never blocks or slows its owner's movement.
 */
export function companionFollowHex(
  companion: CombatUnit,
  ownerPos: HexCoord,
  allUnits: CombatUnit[],
): HexCoord | undefined {
  if (hexDistance(companion.position, ownerPos) === 1) return undefined;
  const others = allUnits.filter((u) => u.id !== companion.id);
  return findSummonHexes(ownerPos, 1, others)[0];
}
