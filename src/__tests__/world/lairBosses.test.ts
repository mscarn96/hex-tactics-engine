import { LAIR_SPECS } from '@/locations/lairs';
import { starterBasicAttack } from '@/systems/combat/basicAttack';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { expectedDamage } from '@/systems/combat/damageCalc';
import { neutralDepth, threatPowerScale } from '@/systems/world/threat';
import { PASSIVE_DEFS, passiveRank } from '@/systems/combat/passives';
import { BALANCE } from '@/data/balanceConstants';
import { CombatUnit, HeroStats, PassiveId } from '@/models/types';
import { makeUnit } from '../support/fixtures';

/**
 * The three lair bosses, measured against the parties their gates imply.
 *
 * Two rules, and the first one is not a difficulty preference — it is whether
 * the fight can be finished at all.
 *
 * **A percentage regeneration is a ceiling on how long a fight may last.**
 * Healing `p` of max HP every round means a boss is unkillable unless the party
 * clears `p × maxHp` a round, and both sides of that comparison scale with the
 * party — so a boss the wrong side of the line is not *hard*, it is impossible,
 * for ever, at every level and every party size. The Warren's shipped for a long
 * time: at 8% regeneration and 300 base HP it healed 54 a round against a
 * two-hero party dealing 33, and a playtest reported being decimated on every
 * attempt at more than three times its gate level. Nothing in the game said why.
 *
 * The second rule is the ordering. Lair gates run 8 → 22 → 39 and the bosses
 * used to run the other way: `troll_chieftain` was authored at 300 HP and 22
 * attack against the *dragon's* 250 and 20. That is the same inversion the lair
 * assignment itself once had — the dragon guarded The Warren — and naming the
 * boss on `LairSpec` fixed which door each stood behind without anything
 * retuning the stat blocks for the positions they had moved to.
 *
 * Measured analytically through the real `damageCalc`, the `homeRing.test.ts`
 * method, and **deliberately pessimistic**: class at-will skills only, no
 * equipment, no mastery tree, no healing. A real party at these levels carries
 * all four. So the thresholds here are floors on the arithmetic, not a claim
 * about how the fight plays.
 */

const byId = new Map(enemyTemplates.map((t) => [t.id as string, t]));

const unit = (stats: HeroStats, isPlayer: boolean): CombatUnit =>
  makeUnit({
    id: isPlayer ? 'hero' : 'boss',
    isPlayer,
    stats: { ...stats },
    position: { q: 0, r: isPlayer ? 1 : 0 },
  });

/** `scaleEnemyStats`, which is private to `combatEngine`. */
function scaled(base: HeroStats, avgPartyLevel: number, powerScale: number): HeroStats {
  const m = (1 + BALANCE.ENEMY_LEVEL_SCALE * Math.max(0, avgPartyLevel - 1)) * powerScale;
  return {
    ...base,
    maxHp: Math.round(base.maxHp * m),
    attack: Math.round(base.attack * m),
    defense: Math.round(base.defense * m),
    magic: Math.round(base.magic * m),
    speed: Math.round(base.speed * m),
  };
}

/**
 * What fraction of its own max HP a unit heals per turn.
 *
 * Read off `PASSIVE_DEFS` by running the passive rather than from a table here:
 * a second copy of the number is the thing that would drift, and this rule is
 * only worth having if it tracks the passive it is about.
 */
function regenFraction(passives: readonly string[] | undefined, stats: HeroStats): number {
  if (!passives?.length) return 0;
  const self = unit({ ...stats }, false);
  self.currentHp = 1;
  let healed = 0;
  for (const id of passives) {
    const def = PASSIVE_DEFS[id as keyof typeof PASSIVE_DEFS];
    if (!def?.resolve || def.trigger !== 'onTurnStart') continue;
    for (const outcome of def.resolve(
      { self, allUnits: [self] } as never,
      passiveRank(self, id as PassiveId),
    ) ?? []) {
      if (outcome.kind === 'heal' && outcome.unitId === self.id) healed += outcome.amount;
    }
  }
  return healed / stats.maxHp;
}

/** Every legal party shape at a lair's gate: 2, 3 and 4 heroes summing to it. */
function partiesAtGate(gate: number): { levels: number[]; avg: number }[] {
  const out: { levels: number[]; avg: number }[] = [];
  for (let size = 2; size <= BALANCE.MAX_PARTY_SIZE; size++) {
    const per = Math.max(1, Math.round(gate / size));
    out.push({ levels: Array(size).fill(per), avg: per });
  }
  return out;
}

/** Best at-will damage per round the whole party can put out, bare. */
function partyDamage(levels: number[], target: CombatUnit): number {
  return levels.reduce((sum, level, i) => {
    const template = heroTemplates[i % heroTemplates.length];
    const hero = unit(calculateStatsForLevel(template, level), true);
    // The starting weapon's Basic Attack plus the template's own — measured bare,
    // so the weapon is the plain one every hero is handed
    const kit = [starterBasicAttack(template.heroClass), ...template.skills]
      .filter((s) => s.unlockLevel <= level && s.damage);
    if (!kit.length) return sum;
    return sum + Math.max(...kit.map((s) => expectedDamage(hero, target, s)));
  }, 0);
}

describe('every lair boss can actually be killed', () => {
  /**
   * The rule the Warren broke, stated as the arithmetic that broke it.
   *
   * Margin rather than parity: a party that out-damages the regeneration by a
   * hair still faces a fight running hundreds of rounds, which is unwinnable in
   * practice and reads identically to unwinnable in principle. Three times over
   * is the floor, and it is measured **bare** — no gear, no tree, no healer — so
   * the real margin is far wider.
   */
  it('never regenerates faster than the party gated to fight it can damage it', () => {
    const offenders: string[] = [];

    for (const spec of LAIR_SPECS) {
      const boss = byId.get(spec.boss)!;
      const power = threatPowerScale(spec.band, neutralDepth(spec.band), false);

      for (const { levels, avg } of partiesAtGate(spec.unlockLevel)) {
        const stats = scaled(boss.baseStats, avg, power);
        const fraction = regenFraction(boss.passives, stats);
        if (fraction === 0) continue;

        const healed = stats.maxHp * fraction;
        const dealt = partyDamage(levels, unit(stats, false));
        if (dealt < healed * 3) {
          offenders.push(
            `${spec.id} v ${levels.length}×lv${levels[0]}: heals ${healed.toFixed(0)}/round, party deals ${dealt.toFixed(0)}`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * The same rule one level up, and the one that generalises: a percentage heal
   * caps a fight's length at `1/p` rounds whoever is carrying it, so no passive
   * in the game may sit near a plausible fight length.
   *
   * At 8% the cap was 12.5 rounds. A lair boss at its gate takes eight to twelve
   * in the bare model above, so the ceiling and the fight were the same size —
   * which is why it went from "a slog" to "impossible" on a stat retune nobody
   * connected to it.
   */
  it('keeps every turn-start regeneration well clear of a plausible fight length', () => {
    const dummy: HeroStats = {
      maxHp: 1000, attack: 10, defense: 10, magic: 10, speed: 10, moveRange: 2, maxMana: 0,
    };
    const offenders: string[] = [];
    for (const id of Object.keys(PASSIVE_DEFS)) {
      const fraction = regenFraction([id], dummy);
      // 1/p must leave daylight over a 12-round boss fight
      if (fraction > 0 && 1 / fraction < 24) {
        offenders.push(`${id}: heals ${(fraction * 100).toFixed(0)}%, caps a fight at ${(1 / fraction).toFixed(0)} rounds`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the lair bosses ascend with their gates', () => {
  /**
   * One number for "how much boss is this", and it has to see a caster.
   *
   * `maxHp + attack × 5` is `threatCurve`'s weight and it reads the Lich — 8
   * attack, 25 magic — as feebler than a goblin. Taking the larger of the two
   * offensive stats is the smallest change that makes the metric mean the same
   * thing for all three.
   */
  const weight = (id: string): number => {
    const s = byId.get(id)!.baseStats;
    return s.maxHp + Math.max(s.attack, s.magic) * 5;
  };

  /**
   * Bosses exempt from the ordering. **Empty**: the Warren's boss and the Hollow's were
   * once named here because they were tuned to the plan's encounter HP ahead of a Heart
   * still on a temporary kit, and the Heart's own stat block now sits between the
   * Dragon's and the Emperor's, so the full rule applies to all three.
   */
  const RETUNED_AHEAD_OF_ORDER: string[] = [];

  it('orders the bosses the way the gates do', () => {
    const gates = LAIR_SPECS.map((s) => s.unlockLevel);
    expect([...gates].sort((a, b) => a - b)).toEqual(gates);

    const ordered = LAIR_SPECS.filter((s) => !RETUNED_AHEAD_OF_ORDER.includes(s.boss));
    const offenders: string[] = [];
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const here = ordered[i];
      if (weight(here.boss) <= weight(prev.boss)) {
        offenders.push(
          `${here.boss} (gate ${here.unlockLevel}, ${weight(here.boss)}) is not above ${prev.boss} (gate ${prev.unlockLevel}, ${weight(prev.boss)})`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The last lair's boss is strictly above the other two and short of the Emperor, who
   * is the end of the campaign: the Heart is set between the Dragon and Aethelred.
   */
  it('puts the ice lair\'s boss between the Dragon and the Emperor, with nothing exempt', () => {
    expect(RETUNED_AHEAD_OF_ORDER).toEqual([]);
    expect(weight('dragon')).toBeGreaterThan(weight('troll_chieftain'));
    expect(weight('heart_of_winter')).toBeGreaterThan(weight('dragon'));
    expect(weight('aethelred')).toBeGreaterThan(weight('heart_of_winter'));
  });

  /**
   * And the first one is still the first one a player meets: before any other
   * boss, on a party of two, with no mastery path yet chosen —
   * `MASTERY_UNLOCK_LEVEL` is 5 and the gate divides to level 4 across two
   * heroes. The fight is now tuned for a party well past that gate, which the
   * Troll's own tuning note and `trollFight.test.ts` state; what is pinned here
   * is that nothing makes it a later door.
   */
  it('keeps the Warren the first door, before any mastery path is chosen', () => {
    const first = LAIR_SPECS[0];
    expect(first.boss).toBe('troll_chieftain');
    expect(Math.round(first.unlockLevel / 2)).toBeLessThan(BALANCE.MASTERY_UNLOCK_LEVEL);
  });
});
