import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import {
  executeThresholdFraction,
  executeThresholdHp,
  executeTierDivisor,
  meetsTargetRequirement,
} from '@/systems/combat/statusEffects';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { skillEffectLines } from '@/data/display/skillDisplay';
import { executioner } from '@/data/skills/masterySkills';
import { slash } from '@/data/skills/skillData';
import { BALANCE } from '@/data/balanceConstants';
import { CombatUnit, HeroStats } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';
import { requireUnit } from '@/systems/combat/unitLookup';

/**
 * Executioner's window.
 *
 * The rule lives in one place but is asked in three, and they have to agree:
 * the highlights decide what may be clicked, the resolver decides what actually
 * lands, and the AI decides what is worth scoring. A gate honoured by two of
 * the three is either a button that refuses for no visible reason or a turn the
 * AI spends doing nothing.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ ...over });

const unit = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ stats: stats(), ...over });

describe('the execution window', () => {
  it('widens with attack', () => {
    const weak = unit({ stats: stats({ attack: 10 }) });
    const strong = unit({ stats: stats({ attack: 40 }) });
    expect(executeThresholdFraction(strong)).toBeGreaterThan(executeThresholdFraction(weak));
  });

  /**
   * The cap is the whole reason this is safe next to Frenzy, which is two tiers
   * up the same path and refunds the action on a kill. Without a ceiling every
   * point of attack would eventually buy a turn.
   */
  it('stops widening', () => {
    const colossal = unit({ stats: stats({ attack: 9999 }) });
    expect(executeThresholdFraction(colossal)).toBe(BALANCE.EXECUTE_THRESHOLD_MAX);
  });

  it('stays a finishing blow rather than an opener', () => {
    // A window wide enough to catch a healthy enemy is not an execution
    const typical = unit({ stats: stats({ attack: 25 }) });
    expect(executeThresholdFraction(typical)).toBeLessThan(0.25);
  });

  it('does not flicker as the executioner is buffed', () => {
    // Read off base stats deliberately: the window is drawn on the board, and
    // one that moved with every buff would be a gate the player cannot predict.
    const base = unit({ stats: stats({ attack: 20 }) });
    const buffed = unit({
      stats: stats({ attack: 20 }),
      activeEffects: [{ type: 'attack_buff' as never, magnitude: 40, duration: 3 }],
    });
    expect(executeThresholdFraction(buffed)).toBe(executeThresholdFraction(base));
  });
});

describe('every site asks the same question', () => {
  const board = (foeHp: number) => {
    const hero = unit({ position: { q: 0, r: 0 }, skills: [executioner] });
    const foe = unit({ isPlayer: false, position: { q: 1, r: 0 } });
    foe.currentHp = foeHp;
    useCombatStore.setState({ units: [hero, foe] });
    return { hero, foe };
  };

  it('offers no highlight over a target it would refuse', () => {
    const { hero, foe } = board(90);
    expect(getValidSkillTargetHexes(executioner, hero, [hero, foe])).toEqual([]);
  });

  it('offers the highlight once the target is inside the window', () => {
    const { hero, foe } = board(5);
    const hexes = getValidSkillTargetHexes(executioner, hero, [hero, foe]);
    expect(hexes).toHaveLength(1);
    expect(hexes[0]).toEqual({ q: 1, r: 0 });
  });

  it('refuses in the resolver, and says why', () => {
    const { hero, foe } = board(90);
    const result = resolveSkillUse(hero, executioner, foe.position, SILENT_SINK);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('finish');
    // And the target is untouched — a refusal must not deal partial damage
    expect(requireUnit(useCombatStore.getState().units, foe.id).currentHp).toBe(90);
  });

  it('lands in the resolver once the target is inside the window', () => {
    // 12 of 100, against a 20-attack hero whose window is 16 — comfortably in
    const { hero, foe } = board(12);
    expect(executeThresholdHp(hero, foe)).toBeGreaterThanOrEqual(12);
    const result = resolveSkillUse(hero, executioner, foe.position, SILENT_SINK);
    expect(result.ok).toBe(true);
    expect(requireUnit(useCombatStore.getState().units, foe.id).currentHp).toBeLessThan(12);
  });

  /**
   * The AI half. Scoring a target the resolver would refuse means picking a
   * move, spending the turn on it and achieving nothing — the same bug as an
   * illegal highlight, seen from the other side.
   */
  it('is never chosen by the AI against a healthy target', () => {
    const enemy = unit({ isPlayer: false, position: { q: 0, r: 0 }, skills: [executioner] });
    const hero = unit({ position: { q: 1, r: 0 } });
    useCombatStore.setState({ units: [enemy, hero] });

    const used = decideEnemyAction(enemy, [enemy, hero]).map((a) => a.skill?.id);
    expect(used).not.toContain('executioner');
  });

  it('is chosen by the AI when the target is dying', () => {
    const enemy = unit({ isPlayer: false, position: { q: 0, r: 0 }, skills: [slash, executioner] });
    const hero = unit({ position: { q: 1, r: 0 } });
    hero.currentHp = 4;
    useCombatStore.setState({ units: [enemy, hero] });

    const used = decideEnemyAction(enemy, [enemy, hero]).map((a) => a.skill?.id);
    expect(used).toContain('executioner');
  });
});

describe('the tooltip', () => {
  it('quotes the real number when it knows who is casting', () => {
    const hero = unit({ stats: stats({ attack: 20 }) });
    const pct = Math.round(executeThresholdFraction(hero) * 100);
    expect(skillEffectLines(executioner, hero)[0]).toContain(`${pct}%`);
  });

  it('names the rule when there is no caster yet', () => {
    // The mastery tree shows skills for a hero who is not in a fight
    const line = skillEffectLines(executioner)[0];
    expect(line).toContain('near death');
    expect(line).not.toContain('%');
  });
});

describe('tougher prey, narrower window', () => {
  const prey = (templateId: string) =>
    unit({ isPlayer: false, templateId: templateId as never, stats: stats({ maxHp: 1000 }) });

  const hero = () => unit({ stats: stats({ attack: 20 }) });

  it('halves the window against an elite', () => {
    const normal = enemyTemplates.find((t) => t.tier === 'normal')!;
    const elite = enemyTemplates.find((t) => t.tier === 'elite')!;
    expect(executeTierDivisor(prey(elite.id))).toBe(2);
    expect(executeThresholdHp(hero(), prey(elite.id))).toBe(
      Math.floor(executeThresholdHp(hero(), prey(normal.id)) / 2),
    );
  });

  it('cuts it to a fifth against a boss', () => {
    const boss = enemyTemplates.find((t) => t.tier === 'boss')!;
    expect(executeTierDivisor(prey(boss.id))).toBe(5);
  });

  /**
   * Derived from the tier, never listed. A boss added later must not inherit
   * the trash-mob window by being absent from a table somebody forgot.
   */
  it('covers every boss in the game, including the emperor', () => {
    const wrong = enemyTemplates
      .filter((t) => t.tier === 'boss')
      .filter((t) => executeTierDivisor(prey(t.id)) !== 5)
      .map((t) => t.id);
    expect(wrong).toEqual([]);
    expect(executeTierDivisor(prey('aethelred'))).toBe(5);
  });

  it('treats anything without a template as ordinary', () => {
    // Heroes are not executable prey, and a summon should not be sturdier than
    // whatever it is standing in for
    expect(executeTierDivisor(unit({ isPlayer: false }))).toBe(1);
  });
});

describe('the threshold in hp', () => {
  it('is measured against the target rather than the attacker', () => {
    const hero = unit({ stats: stats({ attack: 20 }) });
    const small = unit({ isPlayer: false, stats: stats({ maxHp: 50 }) });
    const big = unit({ isPlayer: false, stats: stats({ maxHp: 500 }) });
    expect(executeThresholdHp(hero, big)).toBeGreaterThan(executeThresholdHp(hero, small));
  });

  it('passes everything without a requirement through untouched', () => {
    const hero = unit();
    const healthy = unit({ isPlayer: false });
    expect(meetsTargetRequirement(hero, healthy, slash)).toBe(true);
    expect(meetsTargetRequirement(hero, healthy, executioner)).toBe(false);
  });
});
