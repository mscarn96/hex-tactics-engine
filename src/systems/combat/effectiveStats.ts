


import * as Crypto from '@/platform/uuid';


import { CombatUnit, HeroStats, AuraType, AfflictionType } from '@/models/types';



import { passiveStatMods } from '@/systems/combat/passives';


import { applyStatMultipliers, combatMaxHp, secondNatureShare } from '@/systems/combat/forms';








import { BALANCE } from '@/data/balanceConstants';


import { magicDefenseOf } from '@/systems/combat/damageType';




/**
 * The defence Crumble strips from `unit` now: per source, the largest shred any
 * Stun or Root it laid still carries, summed over sources. An overlapping Stun and
 * Root from one Stoneshaper strip it once; the shred goes when the control does.
 */
export function crumbleOn(unit: CombatUnit): number {
  const bySource = new Map<string, number>();
  for (const e of unit.activeEffects) {
    if (!e.crumble || (e.type !== AfflictionType.Stun && e.type !== AfflictionType.Root)) continue;
    const key = e.sourceUnitId ?? '';
    bySource.set(key, Math.max(bySource.get(key) ?? 0, e.crumble));
  }
  let total = 0;
  for (const v of bySource.values()) total += v;
  return total;
}


export function getCombatEffectiveStats(unit: CombatUnit): HeroStats {
  // The beast comes first: a form is what the hero *is* right now, so buffs,
  // shred and passives all layer on top of the animal's numbers rather than on
  // the numbers of a person who is not currently standing there.
  // Copied, because `applyStatMultipliers` returns its input **by reference**
  // when there are no multipliers to apply — and everything below writes into
  // `stats`. A unit carrying a `formVigor` or a `formBonus` but no `formStats`
  // would otherwise have the results written back onto `unit.stats` itself, and
  // the next read would compound them. The store never produces that pair, but
  // "it is fine as long as nobody writes half a form" is not a property worth
  // depending on for the sake of one shallow copy.
  const stats = { ...applyStatMultipliers(unit.stats, unit.formStats) };
  /**
   * Still the form layer: what the shape *adds* rather than what it multiplies.
   *
   * Wildshape's magic conversion is the only writer — a Druid's gear is
   * magic-tilted and a beast cannot cast, so the shape carries that magic over
   * as attack. Folded in here, above the buffs, because it is part of the animal
   * rather than something laid on top of one; and it never carries `maxHp`,
   * which is `combatMaxHp`'s alone (the line below overwrites it either way, so
   * a stray one could not double-count even if it appeared).
   */
  for (const [key, value] of Object.entries(unit.formBonus ?? {}) as [
    keyof HeroStats,
    number,
  ][]) {
    stats[key] = (stats[key] ?? 0) + value;
  }
  stats.maxHp = combatMaxHp(unit);
  // Always a stated number from here on, so the buffs below move it as they
  // move Physical Defense and the shred floor has a base to measure against.
  stats.magicDefense = magicDefenseOf(stats);
  /**
   * What the unit is worth before anything is done to it — the floor the shred
   * cap below is measured against. Captured here rather than re-derived after
   * the loop, because `applyStatMultipliers` is what the *form* is: a bear's
   * numbers, not the Druid's, are what a bear's debuffs are a fraction of.
   */
  const base = {
    attack: stats.attack,
    defense: stats.defense,
    magicDefense: stats.magicDefense,
    magic: stats.magic,
  };
  for (const effect of unit.activeEffects) {
    if (effect.type === AuraType.AttackBuff)   stats.attack   += effect.magnitude;
    // The defence buff is Physical Defence only (Magic Defence has its own,
    // `MagicDefenseBuff`), and every text that grants it names it so. The
    // generic debuff below still answers both hit types.
    if (effect.type === AuraType.DefenseBuff) {
      stats.defense += effect.magnitude;
    }
    if (effect.type === AuraType.MagicDefenseBuff) stats.magicDefense += effect.magnitude;
    if (effect.type === AuraType.MagicBuff)    stats.magic    += effect.magnitude;
    // The Beetle's banked Carapace charges, each a few points of Physical Defense
    if (effect.type === AuraType.Carapace) {
      stats.defense += Math.round(effect.magnitude) * BALANCE.BEETLE.CARAPACE_DEFENSE;
    }

    // Seismic Sense's sidestep: movement, for the one turn it is laid on
    if (effect.type === AuraType.SeismicStep)  stats.moveRange += effect.magnitude;
    if (effect.type === AuraType.SpeedBuff)    stats.speed    += effect.magnitude;

    if (effect.type === AfflictionType.AttackDown)  stats.attack  -= effect.magnitude;
    if (effect.type === AfflictionType.MagicDown)   stats.magic   -= effect.magnitude;
    if (effect.type === AfflictionType.DefenseDown) {
      stats.defense -= effect.magnitude;
      stats.magicDefense -= effect.magnitude;
    }
    // Physical only: the other half of `DefenseDown`, which moves both
    if (effect.type === AfflictionType.PhysicalDefenseDown) stats.defense -= effect.magnitude;
    // The Troll Chieftain's wound strips both defences, like `DefenseDown`
    if (effect.type === AfflictionType.Wound) {
      stats.defense -= effect.magnitude;
      stats.magicDefense -= effect.magnitude;
    }
    if (effect.type === AfflictionType.Chill)       stats.speed   -= effect.magnitude;

    // Blood Howl counts only while the carrier is a Wolf (remaster, 2026-10)
    if (effect.type === AuraType.BloodHowl && unit.wildForm === 'wolf') {
      stats.attack += effect.magnitude;
      stats.critChance = (stats.critChance ?? BALANCE.BASE_CRIT_CHANCE) + BALANCE.BLOOD_HOWL_CRIT;
    }
    // Slip the Net's evasion
    if (effect.type === AuraType.Evasive) {
      stats.dodgeChance = (stats.dodgeChance ?? BALANCE.BASE_DODGE) + effect.magnitude;
    }
    // The Lantern Beacon's light counts like any other crit buff, beside it
    if (effect.type === AuraType.CritBuff || effect.type === AuraType.BeaconLight) {
      stats.critChance = (stats.critChance ?? BALANCE.BASE_CRIT_CHANCE) + effect.magnitude;
    }
    // Bladestorm's other half. Read here rather than special-cased in the
    // movement code so every consumer of `moveRange` — the highlights, the
    // pathfinder and the AI's reachability scan — agrees without being told.
    if (effect.type === AuraType.BladeStorm) {
      stats.moveRange += BALANCE.BLADESTORM_MOVE;
    }
    if (effect.type === AuraType.CritDamageBuff) {
      stats.critDamage = (stats.critDamage ?? BALANCE.BASE_CRIT_DAMAGE) + effect.magnitude;
    }
  }
  // Second Nature: a share of the worn shape's own numbers per step, beside Blood Howl
  // and not in `formStats`, so the shape's band and its body stay what they were
  const settled = secondNatureShare(unit);
  if (settled > 0) {
    stats.attack += Math.round(base.attack * settled);
    stats.defense += Math.round(base.defense * settled);
    stats.magicDefense += Math.round(base.magicDefense * settled);
  }
  stats.magic = Math.round(stats.magic * (1 + (unit.activeEffects.find(e => e.type === AuraType.GroundedFocus)?.magnitude ?? 0)));
  const crumbled = crumbleOn(unit);
  stats.defense -= crumbled;
  stats.magicDefense -= crumbled;

  // Passives contribute continuously rather than as timed effects, so they fold
  // in alongside the auras before any flooring happens
  for (const [key, value] of Object.entries(passiveStatMods(unit)) as [
    keyof HeroStats,
    number,
  ][]) {
    stats[key] = (stats[key] ?? 0) + value;
  }

  // Smoke Bomb: a Dodge floor while the carrier stands in its own cloud. Laid
  // after every bonus, so it is a floor rather than one more addition
  if (unit.activeEffects.some((e) => e.type === AuraType.SmokeCover
    && e.zone?.some((h) => h.q === unit.position.q && h.r === unit.position.r))) {
    stats.dodgeChance = Math.max(stats.dodgeChance ?? BALANCE.BASE_DODGE, BALANCE.SMOKE_DODGE);
  }

  /**
   * Shred can never take a stat below `1 - MAX_SHRED_FRACTION` of what the unit
   * started the calculation with.
   *
   * These used to floor at zero, which is enough to stop the *arithmetic* going
   * wrong — negative defence would turn a debuff into a damage bonus growing
   * without bound — but not enough to stop the *fight* going wrong. Weakened is
   * authored in flat points (4, 5, 6, 8) against attack values that start at 5,
   * so a single application could take an early hero to literally zero attack:
   * every blow they landed for the next three turns dealt `MIN_DAMAGE`, and
   * nothing on screen distinguished that from the game being broken. A flat
   * debuff against a scaling stat is a debuff whose severity is decided by when
   * in the campaign it lands.
   *
   * A fraction of the unit's own base rather than a cap on the effect's points:
   * the same 4-point shred should be crippling to a level-1 Arcanist and a
   * scratch to a mastered Champion, which is what makes it worth casting at all.
   * Capping the magnitude instead would flatten that.
   *
   * Symmetric, because this runs for every unit on the board — the player's
   * Weakened lands on an orc under the same rule.
   *
   * A base of zero floors at zero: enemies are authored with `magic: 0` and
   * handing them a point of it here would be a buff dressed as a safety rail.
   */
  const shredFloor = (value: number, baseValue: number): number =>
    Math.max(baseValue === 0 ? 0 : Math.max(1, Math.round(baseValue * (1 - BALANCE.MAX_SHRED_FRACTION))), value);

  stats.attack  = shredFloor(stats.attack, base.attack);
  stats.defense = shredFloor(stats.defense, base.defense);
  stats.magicDefense = shredFloor(stats.magicDefense, base.magicDefense);
  stats.magic   = shredFloor(stats.magic, base.magic);
  // Speed decides turn order; a unit at zero would never act again.
  stats.speed   = Math.max(1, stats.speed);

  // The Brigand Captain's word: a share more of every stat, laid on last so it multiplies
  // what the unit already is — buffs, shred and all. Max HP was done above, in `combatMaxHp`.
  const word = unit.activeEffects.find((e) => e.type === AuraType.Authority)?.magnitude ?? 0;
  if (word > 0) {
    const raise = (value: number) => Math.round(value * (1 + word));
    stats.attack = raise(stats.attack);
    stats.defense = raise(stats.defense);
    stats.magicDefense = raise(stats.magicDefense);
    stats.magic = raise(stats.magic);
    stats.speed = raise(stats.speed);
    stats.moveRange = Math.max(1, raise(stats.moveRange));
  }

  return stats;
}
