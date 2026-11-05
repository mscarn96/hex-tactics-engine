import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { QUESTS } from '@/quests/questData';
import { questStageSummary, questSummary } from '@/quests/questText';
import { AfflictionType, HeroClass, MasteryNode, MasteryPath } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { CINDER_RIFT_LABEL, skyfire } from '@/data/templates/emeraldDragon';
import { at } from '../support/fixtures';
import {
  dragonArena, dragonFx, dragonHero, dragonLog, dragonPrepared, dragonStore, dragonUnit, heroRound, landDragon, pinDragonDice, restoreDragonDice,
} from '../support/dragonBoard';
import { warningLines } from '@/data/display/preparedDisplay';
import { arenaHexes } from '@/systems/combat/arenaGeometry';
import { applySkillStatus } from '@/systems/combat/combatEvents';
import { castDragonMove } from '@/systems/combat/dragonActions';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { previewPrepared } from '@/systems/combat/preparedAttacks';
import { useCombatStore } from '@/stores/combatStore';
import { skillEffects } from '@/systems/combat/statusEffects';
import { findSkill, pointsEarnedByLevel, prerequisitesFor } from '@/systems/progression/mastery';
import { DRAGON_GATE_PARTY_LEVEL } from '@/systems/sim/dragonMeasure';

/**
 * Skyfire asks the party to bring an answer, so the answer has to be reachable and
 * the need has to be readable before the door is opened.
 *
 * The Hollow's gate is a summed party level of 22, the pair at level 11 that
 * `dragonFight.test.ts` measures. What is held here is that **every class has a
 * mastery path whose skill lands one of the four interrupts within the points a
 * level-11 hero has earned**, so no party composition is locked out of the answer,
 * and that the contract the player reads before going in says what to bring.
 */

const INTERRUPTS: readonly string[] = [
  AfflictionType.Stun, AfflictionType.Silence, AfflictionType.Freeze, AfflictionType.Taunt,
];

/** Points to own `node`, counting everything it needs on the way. */
function costOf(path: MasteryPath, node: MasteryNode): number {
  const seen = new Set<string>();
  const walk = (n: MasteryNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    for (const p of prerequisitesFor(path, n)) walk(p);
  };
  walk(node);
  return seen.size;
}

/** The fewest points at which this path grants a skill that lands an interrupt, or Infinity. */
function cheapestInterrupt(path: MasteryPath): number {
  let best = Infinity;
  for (const node of path.nodes) {
    if (!node.grantsSkill) continue;
    const skill = findSkill(node.grantsSkill);
    if (!skill) continue;
    if (skillEffects(skill).some((e) => INTERRUPTS.includes(e.type as string))) {
      best = Math.min(best, costOf(path, node));
    }
  }
  return best;
}

describe('an answer to Skyfire is reachable by mid-game', () => {
  const points = pointsEarnedByLevel(DRAGON_GATE_PARTY_LEVEL);

  it.each(Object.values(HeroClass))('has a %s path that interrupts within the points a level-11 hero has', (heroClass) => {
    const paths = MASTERY_PATHS.filter((p) => p.heroClass === heroClass);
    expect(paths.length).toBeGreaterThan(0);
    const cheapest = Math.min(...paths.map(cheapestInterrupt));
    expect(cheapest).toBeLessThanOrEqual(points);
  });

  it('can be broken by exactly the four things the contract names', () => {
    expect(skyfire.prepares?.interruptedBy).toEqual(['stun', 'silence', 'freeze']);
    expect(skyfire.prepares?.tauntCancels).toBe(true);
  });
});

// ─── Skyfire: the trench and the sprawl ──────────────────────────────────────

describe('Skyfire has two answers beside the interrupt', () => {
  beforeEach(pinDragonDice);
  afterEach(restoreDragonDice);

  /** A burning Rift on the row q = -2, laid as his Rift is (owned, burning, replaceable). */
  const burnRow = () => {
    dragonStore().addHazard({
      id: 'rift_t', hexes: arenaHexes().filter((h) => h.q === -2).map((h) => ({ q: h.q, r: h.r })), solid: false,
      label: CINDER_RIFT_LABEL, lasts: 'replaced', kind: 'cinder_rift', ownerId: 'boss', crossDamage: 5,
    });
  };
  /** The fire is cast with the heroes where they stand, then they take their turn and it falls. */
  const fall = () => {
    castDragonMove(dragonUnit('boss'), skyfire, dragonFx);
    const [attack] = dragonPrepared();
    heroRound();
    landDragon();
    return attack;
  };
  const place = (id: string, hex: ReturnType<typeof at>) =>
    useCombatStore.setState((st) => ({ units: st.units.map((u) => (u.id === id ? { ...u, position: hex } : u)) }));
  const inMark = (attack: { landing?: { q: number; r: number }[] }, hex: { q: number; r: number }) =>
    (attack.landing ?? []).some((h) => h.q === hex.q && h.r === hex.r);

  it('shelters a hero on a burning Rift from the whole flame, and the banner names them', () => {
    dragonArena({ heroes: [dragonHero('trench', at(-2, -3)), dragonHero('open', at(3, 0))] });
    burnRow();
    castDragonMove(dragonUnit('boss'), skyfire, dragonFx);
    const [attack] = dragonPrepared();
    expect(inMark(attack, at(-2, -3))).toBe(false);
    const preview = previewPrepared(attack, dragonStore().units, dragonStore().hazards);
    expect(preview.sheltered.length).toBeGreaterThan(0);
    const line = warningLines([attack], [preview], dragonStore().units)[0];
    expect(line.detail).toContain('trench');
    expect(line.detail).toContain('sheltered');
    heroRound();
    landDragon();
    expect(dragonUnit('trench').currentHp).toBe(600);
    expect(dragonUnit('open').currentHp).toBeLessThan(600);
  });

  it('counts the sheltered hero as unharmed and the other as having taken it', () => {
    dragonArena({ heroes: [dragonHero('trench', at(-2, -3)), dragonHero('open', at(3, 0))] });
    burnRow();
    fall();
    const row = dragonStore().answerTally.skyfire;
    expect(row.unharmed).toBe(1);
    expect(row.took).toBe(1);
  });

  it('gives no shelter off the Rift: the same hero one hex over takes the flame', () => {
    dragonArena({ heroes: [dragonHero('near', at(-1, -3)), dragonHero('open', at(3, 0))] });
    burnRow();
    fall();
    expect(dragonUnit('near').currentHp).toBeLessThan(600);
  });

  it('leaves the Rift burning when it has fallen: the Rift goes out on its own clock', () => {
    dragonArena({ heroes: [dragonHero('trench', at(-2, -3)), dragonHero('open', at(3, 0))] });
    burnRow();
    fall();
    expect(dragonStore().hazards.some((h) => h.kind === 'cinder_rift')).toBe(true);
  });

  it('sprawls him when a hero stands in the landing mark: Exposed, his fire quenched, the blow still taken', () => {
    dragonArena({ heroes: [dragonHero('mark', at(2, 0)), dragonHero('far', at(-4, 4))] });
    dragonStore().patchBossScript('boss', { heat: 7 });
    castDragonMove(dragonUnit('boss'), skyfire, dragonFx);
    const [attack] = dragonPrepared();
    const standing = attack.landing![0];
    place('mark', standing);
    const before = getCombatEffectiveStats(dragonUnit('boss')).defense;
    heroRound();
    landDragon();
    expect(getCombatEffectiveStats(dragonUnit('boss')).defense).toBeLessThan(before);
    expect(dragonUnit('boss').bossScript?.heat).toBe(7 - BALANCE.DRAGON_QUENCH_STEPS);
    // He landed in the mark, and the hero there took the flame and the landing blow both
    expect(dragonUnit('mark').currentHp).toBeLessThan(dragonUnit('far').currentHp);
    expect(dragonLog.join(' ')).toContain('sprawls');
  });

  it('lands upright when nobody stands in the mark: no Exposed, no quench', () => {
    dragonArena({ heroes: [dragonHero('a', at(-4, 4)), dragonHero('b', at(-4, 3))] });
    dragonStore().patchBossScript('boss', { heat: 7 });
    const attack = (castDragonMove(dragonUnit('boss'), skyfire, dragonFx), dragonPrepared()[0]);
    expect(inMark(attack, at(-4, 4)) || inMark(attack, at(-4, 3))).toBe(false);
    const before = getCombatEffectiveStats(dragonUnit('boss')).defense;
    heroRound();
    landDragon();
    expect(getCombatEffectiveStats(dragonUnit('boss')).defense).toBe(before);
    expect(dragonUnit('boss').bossScript?.heat).toBe(7);
  });

  it('is still cancelled whole by an interrupt: no flame, no landing, no sprawl, and a quenched fire', () => {
    dragonArena({ heroes: [dragonHero('trench', at(-2, -3)), dragonHero('open', at(3, 0))] });
    burnRow();
    dragonStore().patchBossScript('boss', { heat: 7 });
    const start = dragonStore().units.map((u) => [u.id, u.currentHp, `${u.position.q},${u.position.r}`]);
    castDragonMove(dragonUnit('boss'), skyfire, dragonFx);
    applySkillStatus(
      dragonUnit('open'), 'boss', { type: AfflictionType.Stun, magnitude: 1, duration: 2, sourceUnitId: 'open' },
      { log: () => {}, float: () => {} },
    );
    expect(dragonPrepared()).toHaveLength(0);
    heroRound();
    expect(landDragon()).toEqual([]);
    expect(dragonStore().units.map((u) => [u.id, u.currentHp, `${u.position.q},${u.position.r}`])).toEqual(start);
    expect(dragonUnit('boss').bossScript?.heat).toBe(7 - BALANCE.DRAGON_QUENCH_STEPS);
    // The Rift burns on: that Skyfire never fell
    expect(dragonStore().hazards.some((h) => h.kind === 'cinder_rift')).toBe(true);
  });

  it('keeps the shelter and the interrupt on the move itself', () => {
    expect(skyfire.prepares?.shelter).toEqual({ onHazard: CINDER_RIFT_LABEL });
    expect(skyfire.prepares?.interruptedBy).toEqual(['stun', 'silence', 'freeze']);
    expect(skyfire.prepares?.tauntCancels).toBe(true);
    expect(skyfire.prepares?.quenchedOnBreak).toBe(true);
  });
});
