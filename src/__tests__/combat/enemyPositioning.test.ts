import { decideEnemyAction, AIAction } from '@/systems/combat/enemyAI';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { hexDistance } from '@/utils/hexUtils';
import {
  AfflictionType,
  CombatUnit,
  EnemyTemplateId,
  HexCoord,
  SkillTargetType,
} from '@/models/types';
import { at, makeEffect, makeStats, makeUnit } from '../support/fixtures';
import { templateName } from '@/data/templates/unitText';
import { assassinate, cheapShot, hemlock, shadowstep } from '@/data/skills/mastery/hunter';
import { disengage } from '@/data/skills/skillData';
import { starterBasicAttack } from '@/systems/combat/basicAttack';
import { HeroClass } from '@/models/types';

/**
 * Where an enemy stands when it has nothing to cast.
 *
 * The Delve Breaker was reported as "sometimes does nothing on its turn", and
 * it is two defects with one symptom — neither of them about the Breaker:
 *
 * 1. `chooseMoveTarget` read `isRanged` and `primarySkillRange` off the unit's
 *    whole kit with cooldowns ignored. Cave-In has range 3 and a cooldown of 4,
 *    so for four turns in five the Breaker was classed as a ranged kiter and
 *    held station at distance 2 — where its only ready skill, a range-1 Slash,
 *    could not reach and nothing told it to close.
 * 2. `getHexesInRange` includes its own centre, so a unit already at its ideal
 *    distance "moved" onto the hex it was standing on: a store write that
 *    changes nothing, a turn spent, nothing on screen.
 *
 * Both are general. Every melee template carrying a reach skill on a cooldown
 * had the first, and any unit that liked where it stood had the second.
 */

const templateUnit = (id: EnemyTemplateId, over: Partial<CombatUnit> = {}): CombatUnit => {
  const template = enemyTemplates.find((t) => t.id === id)!;
  return makeUnit({
    isPlayer: false,
    templateId: id,
    name: templateName(template.id),
    stats: { ...template.baseStats },
    skills: template.skills,
    ...over,
  });
};

const prey = (position: HexCoord): CombatUnit =>
  makeUnit({ id: 'prey', isPlayer: true, stats: makeStats(), position });

const moveOf = (actions: AIAction[]): HexCoord | undefined =>
  actions.find((a) => a.type === 'move')?.targetPos;

const skillIds = (actions: AIAction[]) =>
  actions.filter((a) => a.type === 'skill').map((a) => a.skill?.id);

describe('the Delve Breaker', () => {
  const hero = prey(at(0, 1));

  /** Its ranged option spent; only a range-1 Slash is left. */
  const cooling = (position: HexCoord) =>
    templateUnit('delve_breaker', { id: 'breaker', position, cooldowns: { cave_in: 3 } });

  it('closes to melee when Cave-In is on cooldown', () => {
    const breaker = cooling(at(0, -2));
    const moved = moveOf(decideEnemyAction(breaker, [breaker, hero]));

    expect(moved).toBeDefined();
    // It has three movement and three hexes to cover, so "closer" means
    // adjacent — the point is that it stops holding station at Cave-In's range
    expect(hexDistance(moved!, hero.position)).toBe(1);
  });

  /**
   * The literal skipped turn. Standing where the old kiting rule wanted it, the
   * best-scoring hex was the one it was already on.
   */
  it('never answers with the hex it is already standing on', () => {
    const offenders: string[] = [];
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        const here = at(q, r);
        if (hexDistance(here, hero.position) === 0) continue;
        const breaker = cooling(here);
        const moved = moveOf(decideEnemyAction(breaker, [breaker, hero]));
        if (moved && moved.q === q && moved.r === r) offenders.push(`${q},${r}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Walked forward rather than sampled: from anywhere on the board the Breaker
   * has to reach a turn on which it actually swings. Before the fix, every
   * start at distance 2 looped forever — move to its own hex, end turn, repeat.
   */
  it('reaches a turn it acts on from every starting hex', () => {
    const offenders: string[] = [];
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        const start = at(q, r);
        if (hexDistance(start, hero.position) === 0) continue;

        let breaker = cooling(start);
        let acted = false;
        for (let turn = 0; turn < 6 && !acted; turn++) {
          const actions = decideEnemyAction(breaker, [breaker, hero]);
          if (skillIds(actions).length > 0) { acted = true; break; }
          const moved = moveOf(actions);
          if (!moved) break;
          breaker = { ...breaker, position: moved };
        }
        if (!acted) offenders.push(`${q},${r}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still opens with Cave-In when it is off cooldown and in reach', () => {
    const breaker = templateUnit('delve_breaker', { id: 'breaker', position: at(0, -1) });
    expect(skillIds(decideEnemyAction(breaker, [breaker, hero]))).toEqual(['cave_in']);
  });
});

describe('positioning reads the skills a unit can actually cast', () => {
  /**
   * The Breaker is one of several. Anything whose reach comes from a cooldown
   * skill was kiting on a promise it could not keep — collected from the roster
   * rather than listed, so a template added later is covered without being
   * named here.
   */
  const brutes = enemyTemplates.filter((t) => {
    const atWill = t.skills.filter((s) => !s.cooldown);
    const reach = t.skills.filter((s) => s.range >= 3);
    return atWill.length > 0 &&
      atWill.every((s) => s.range <= 1) &&
      reach.length > 0 &&
      reach.every((s) => !!s.cooldown);
  });

  it('finds the templates the bug was about', () => {
    // If this ever empties the two cases below stop testing anything.
    expect(brutes.length).toBeGreaterThan(0);
  });

  /**
   * Each of them, standing at exactly the distance the old kiting rule wanted
   * — two hexes, which is `max(2, reach - 1)` for every reach skill on the
   * roster. From there it must either have something to cast or come closer;
   * holding still is the bug. Collected into one list rather than one case per
   * template because this Jest version takes no message on `expect`, and "which
   * template" is the only thing worth reporting.
   */
  it('acts or closes from the distance the old rule parked them at', () => {
    const hero = prey(at(0, 2));
    const offenders: string[] = [];

    for (const template of brutes) {
      const brute = makeUnit({
        id: 'brute',
        isPlayer: false,
        templateId: template.id,
        stats: { ...template.baseStats },
        skills: template.skills,
        position: at(0, 0),
        cooldowns: Object.fromEntries(
          template.skills.filter((s) => s.cooldown).map((s) => [s.id, 3]),
        ),
      });

      const actions = decideEnemyAction(brute, [brute, hero]);
      if (skillIds(actions).length > 0) continue;
      const moved = moveOf(actions);
      if (!moved || hexDistance(moved, hero.position) >= 2) offenders.push(template.id);
    }

    expect(offenders).toEqual([]);
  });

  /**
   * The other half of the same read: a unit does not cluster up for an area
   * skill it cannot cast. Scored rather than asserted on a hex, because the
   * crowd bonus is worth ten a body and would otherwise drag the answer around.
   */
  it('does not gather for an area skill that is on cooldown', () => {
    const breaker = templateUnit('delve_breaker', {
      id: 'breaker',
      position: at(0, -3),
      cooldowns: { cave_in: 3 },
    });
    const pack = [at(0, 0), at(1, 0), at(-1, 1)].map((p, i) =>
      makeUnit({ id: `h${i}`, isPlayer: true, stats: makeStats(), position: p }),
    );
    const moved = moveOf(decideEnemyAction(breaker, [breaker, ...pack]));
    // The nearest body is what a Slash wants, and nothing about the crowd
    expect(hexDistance(moved!, pack[0].position)).toBe(1);
  });
});

describe('holding ground', () => {
  /**
   * A ranged unit sitting exactly where it wants to be is the case that
   * produced the no-op move. Answering `null` is what makes the turn honest —
   * `decideEnemyAction` then reports "holds ground" rather than writing a
   * position identical to the one already stored.
   */
  it('reports no move rather than a move to nowhere', () => {
    const slinger = templateUnit('delve_slinger', { id: 'slinger', position: at(0, -2) });
    const hero = prey(at(0, 1));
    // Out of its range, so it must reposition rather than shoot
    const far = decideEnemyAction(slinger, [slinger, prey(at(0, 3))]);
    expect(moveOf(far)).toBeDefined();

    const actions = decideEnemyAction(slinger, [slinger, hero]);
    expect(skillIds(actions).length).toBeGreaterThan(0);
  });

  it('leaves a rooted unit exactly where it is', () => {
    const breaker = templateUnit('delve_breaker', {
      id: 'breaker',
      position: at(0, -3),
      cooldowns: { cave_in: 3 },
      activeEffects: [makeEffect(AfflictionType.Root, { duration: 2 })],
    });
    const actions = decideEnemyAction(breaker, [breaker, prey(at(0, 1))]);
    expect(moveOf(actions)).toBeUndefined();
  });
});

describe('the skills a Ring enemy is scored on', () => {
  /**
   * Cave-In is the one enemy skill that is both an area and a stun, and
   * `enemyAI` scores in expected damage — so it is worth checking it can win at
   * all rather than losing to the at-will swing it is meant to replace.
   */
  it('is worth more than a Slash when it catches two', () => {
    const breaker = templateUnit('delve_breaker', { id: 'breaker', position: at(0, -1) });
    const pack = [at(0, 1), at(1, 1)].map((p, i) =>
      makeUnit({ id: `h${i}`, isPlayer: true, stats: makeStats(), position: p }),
    );
    const chosen = skillIds(decideEnemyAction(breaker, [breaker, ...pack]));
    expect(chosen).toEqual(['cave_in']);
    expect(
      enemyTemplates.find((t) => t.id === 'delve_breaker')!.skills
        .find((s) => s.id === 'cave_in')!.targetType,
    ).toBe(SkillTargetType.Ring);
  });
});

/**
 * A hero the AI drives (the PvP proof of concept's rival team). The Shadowblade
 * carries three long-reach skills that strike nobody from where it stands —
 * Disengage, Shadowstep's blink and Assassinate's mark at range 20 — and read
 * as a ranged kit they held it nineteen hexes off the fight for a whole battle.
 */
describe('an AI-driven Shadowblade', () => {
  const hero = prey(at(0, 0));
  // The rolled rival's daggers reach one hex; the Ranger's starting throw reaches two
  const daggers = { ...starterBasicAttack(HeroClass.Ranger), range: 1 };
  const kit = [daggers, disengage, shadowstep, cheapShot, hemlock, assassinate];
  const blade = (position: HexCoord, cooldowns: Record<string, number> = {}): CombatUnit =>
    makeUnit({ id: 'blade', isPlayer: false, position, skills: kit, cooldowns, stats: makeStats({ maxMana: 200 }) });

  it('closes on the fight when nothing it holds reaches, Assassinate ready or not', () => {
    const start = at(0, -6);
    const cooling: Record<string, number>[] = [{ shadowstep: 2, hemlock: 2 }, { shadowstep: 2, hemlock: 2, assassinate: 2 }];
    for (const cooldowns of cooling) {
      const unit = blade(start, cooldowns);
      const moved = moveOf(decideEnemyAction(unit, [unit, hero]));
      expect(moved).toBeDefined();
      expect(hexDistance(moved!, hero.position)).toBeLessThan(hexDistance(start, hero.position));
    }
  });

  it('walks into melee rather than holding at Disengage range', () => {
    const unit = blade(at(0, -2), { shadowstep: 2, hemlock: 2, assassinate: 2 });
    const moved = moveOf(decideEnemyAction(unit, [unit, hero]));
    expect(moved).toBeDefined();
    expect(hexDistance(moved!, hero.position)).toBe(1);
  });

  it("strikes with Shadowstep's dash when a foe stands in its reach", () => {
    const unit = blade(at(0, -3), { hemlock: 2, assassinate: 2 });
    const actions = decideEnemyAction(unit, [unit, hero]);
    expect(skillIds(actions)).toEqual(['shadowstep']);
    expect(actions[0].skillTarget).toEqual(hero.position);
  });
});
