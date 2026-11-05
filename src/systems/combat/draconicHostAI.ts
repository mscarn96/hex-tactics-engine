import { AfflictionType, CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { canPrepare } from '@/systems/combat/preparedCast';
import { canAim } from '@/systems/combat/targetLegality';
import { getSkillTargets, getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { hasEffect } from '@/systems/combat/statusEffects';
import { EliteValue, ELITE_SIGNATURE_VALUE } from '@/systems/combat/eliteActions';
import { hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * What the Draconic Host's two elites make of their signatures
 * (`data/skills/draconicHostSkills.ts`).
 *
 * Both ride the shared warning (`prepares`), so neither needs a script: the cast fixes the
 * footprint and pays the cooldown (`castPrepared`, through `resolveSkillUse`), and the landing
 * is the ordinary resolver over the warned ground (`preparedResolve`). What the generic AI
 * cannot do is want them. The Warlord's Doom deals nothing at the cast and nothing when it
 * lands — it lays a status — so its expected damage is zero and it would never be pressed.
 * The Daitengu's Gale would be scored as an ordinary arc and lose to a Hush that also
 * silences. Each is scored on what it would catch, above an at-will whenever it catches
 * anybody: its cooldown is what limits it, as for every elite's signature.
 *
 * Pure over the roster but for `canPrepare`, the one-warning-per-caster rule.
 */

/** What each hero a signature would catch adds to the score. */
const PER_HERO_CAUGHT = 10;

/** Heroes standing on these hexes, the caster's foes only and no objective. */
export function heroesOn(hexes: HexCoord[], caster: CombatUnit, units: CombatUnit[]): CombatUnit[] {
  const inside = new Set(hexes.map(hexKey));
  return units.filter(
    (u) => u.currentHp > 0 && !u.objective && u.isPlayer !== caster.isPlayer && inside.has(hexKey(u.position)),
  );
}

/**
 * Where the Warlord brands: the hero whose circle catches the most heroes not already
 * Doomed (then the one with the least health, then by id), within his reach. Null when no
 * hero in reach would take a new Doom.
 */
export function doomAim(
  warlord: CombatUnit,
  skill: HeroSkill,
  foes: CombatUnit[],
  units: CombatUnit[],
): { aim: HexCoord; caught: CombatUnit[] } | null {
  let best: { aim: HexCoord; caught: CombatUnit[]; hp: number; id: string } | null = null;
  for (const foe of foes) {
    if (foe.objective || !canAim(warlord, foe, skill)) continue;
    if (hexDistance(warlord.position, foe.position) > skill.range) continue;
    const caught = heroesOn(getSkillTargets(skill, warlord.position, foe.position, units), warlord, units)
      .filter((h) => !hasEffect(h, AfflictionType.Doom));
    if (caught.length === 0) continue;
    const better =
      !best ||
      caught.length > best.caught.length ||
      (caught.length === best.caught.length && (foe.currentHp < best.hp || (foe.currentHp === best.hp && foe.id < best.id)));
    if (better) best = { aim: foe.position, caught, hp: foe.currentHp, id: foe.id };
  }
  return best ? { aim: best.aim, caught: best.caught } : null;
}

/**
 * Where the Daitengu aims the Gale: the legal aim whose wedge holds the most heroes (then
 * the nearest aim, then by coordinate). Null when no wedge holds anybody.
 */
export function galeAim(
  daitengu: CombatUnit,
  skill: HeroSkill,
  units: CombatUnit[],
): { aim: HexCoord; caught: CombatUnit[] } | null {
  let best: { aim: HexCoord; caught: CombatUnit[] } | null = null;
  for (const aim of getValidSkillTargetHexes(skill, daitengu, units)) {
    const caught = heroesOn(getSkillTargets(skill, daitengu.position, aim, units), daitengu, units);
    if (caught.length === 0) continue;
    if (
      !best ||
      caught.length > best.caught.length ||
      (caught.length === best.caught.length &&
        hexDistance(daitengu.position, aim) < hexDistance(daitengu.position, best.aim))
    ) {
      best = { aim, caught };
    }
  }
  return best;
}

/**
 * What a Host elite's signature is worth to its AI, or `undefined` for any other skill so
 * the generic scoring runs.
 */
export function draconicHostSkillValue(
  caster: CombatUnit,
  skill: HeroSkill,
  foes: CombatUnit[],
  allUnits: CombatUnit[],
): EliteValue | null | undefined {
  switch (skill.id) {
    case 'warlords_doom': {
      if (!canPrepare(caster.id)) return null;
      const brand = doomAim(caster, skill, foes, allUnits);
      return brand
        ? { skill, targetPos: brand.aim, value: ELITE_SIGNATURE_VALUE + PER_HERO_CAUGHT * brand.caught.length }
        : null;
    }
    case 'great_gale': {
      if (!canPrepare(caster.id)) return null;
      const gale = galeAim(caster, skill, allUnits);
      return gale
        ? { skill, targetPos: gale.aim, value: ELITE_SIGNATURE_VALUE + PER_HERO_CAUGHT * gale.caught.length }
        : null;
    }
    default:
      return undefined;
  }
}
