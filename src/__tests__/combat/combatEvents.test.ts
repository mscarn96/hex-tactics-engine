import { applyOnHitStatuses, applySkillStatus } from '@/systems/combat/combatEvents';
import { STATUS_DISPLAY } from '@/data/display/statusDisplay';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { useCombatStore } from '@/stores/combatStore';
import { slash, groundSlam, thunderbeat } from '@/data/skills/skillData';
import { whirlwind } from '@/data/skills/masterySkills';
import {
  ActiveEffect,
  AfflictionType,
  AuraType,
  CombatUnit,
  HexCoord,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { makeStats, makeUnit } from '../support/fixtures';
import { requireUnit } from '@/systems/combat/unitLookup';
import { statusName } from '@/data/gameText';

const at = (q: number, r: number): HexCoord => ({ q, r });
const eff = (type: ActiveEffect['type'], over: Partial<ActiveEffect> = {}): ActiveEffect => ({
  type,
  magnitude: 1,
  duration: 3,
  ...over,
});

const unit = (id: string, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, isPlayer: false, stats: makeStats({ maxHp: 60, attack: 12, defense: 4, magic: 12, moveRange: 2, maxMana: 20 }), ...over });

const hpOf = (id: string) => requireUnit(useCombatStore.getState().units, id).currentHp;
const effectsOf = (id: string) =>
  requireUnit(useCombatStore.getState().units, id).activeEffects.map((e) => e.type);

describe('on-hit statuses', () => {
  const attacker = unit('attacker', { position: at(0, -1) });
  const defender = unit('defender', { isPlayer: true, position: at(0, 0) });
  const bystander = unit('bystander', { isPlayer: true, position: at(1, 0) });

  const setup = (...over: CombatUnit[]) => {
    useCombatStore.getState().reset();
    const players = [defender, bystander].map((u) => over.find((o) => o.id === u.id) ?? u);
    const enemies = [over.find((o) => o.id === 'attacker') ?? attacker];
    useCombatStore.getState().initCombat(players, enemies);
  };

  it('reflects thorns back at whoever landed the hit', () => {
    setup({ ...defender, activeEffects: [eff(AuraType.Thorns, { magnitude: 0.5 })] });
    applyOnHitStatuses(attacker, useCombatStore.getState().units[0], 20);
    expect(hpOf('attacker')).toBe(50);
  });

  // A hit fully eaten by a barrier never reached the target, so nothing bounces
  it('reflects nothing when no HP was lost', () => {
    setup({ ...defender, activeEffects: [eff(AuraType.Thorns, { magnitude: 0.5 })] });
    applyOnHitStatuses(attacker, useCombatStore.getState().units[0], 0);
    expect(hpOf('attacker')).toBe(60);
  });

  it('chains a shocked target’s damage to an adjacent ally, off a spell that applies Shock', () => {
    setup({ ...defender, activeEffects: [eff(AfflictionType.Shock)] });
    applyOnHitStatuses(attacker, useCombatStore.getState().units[0], 20, undefined, undefined, undefined, thunderbeat);
    expect(hpOf('bystander')).toBe(60 - Math.round(20 * BALANCE.SHOCK_CHAIN_FRACTION));
    expect(hpOf('defender')).toBe(60);   // the chain is extra, not redirected
  });

  it('breaks the attacker’s own stealth', () => {
    setup({ ...attacker, activeEffects: [eff(AuraType.Stealth)] });
    const hidden = useCombatStore.getState().units.find((u) => u.id === 'attacker')!;
    applyOnHitStatuses(hidden, useCombatStore.getState().units[0], 10);
    expect(effectsOf('attacker')).toEqual([]);
  });

  // Stealth is spent by attacking whether or not the strike connected — the
  // position is given away either way
  it('breaks stealth even on a hit that dealt nothing', () => {
    setup({ ...attacker, activeEffects: [eff(AuraType.Stealth)] });
    const hidden = useCombatStore.getState().units.find((u) => u.id === 'attacker')!;
    applyOnHitStatuses(hidden, useCombatStore.getState().units[0], 0);
    expect(effectsOf('attacker')).toEqual([]);
  });

  it('does nothing at all when no status is in play', () => {
    setup();
    applyOnHitStatuses(attacker, useCombatStore.getState().units[0], 20);
    expect(hpOf('attacker')).toBe(60);
    expect(hpOf('bystander')).toBe(60);
  });

  it('lets thorns and shock both fire off one hit', () => {
    setup({
      ...defender,
      activeEffects: [eff(AuraType.Thorns, { magnitude: 0.5 }), eff(AfflictionType.Shock)],
    });
    applyOnHitStatuses(attacker, useCombatStore.getState().units[0], 20, undefined, undefined, undefined, thunderbeat);
    expect(hpOf('attacker')).toBe(50);
    expect(hpOf('bystander')).toBeLessThan(60);
  });
});

describe('the AI obeys the new locks', () => {
  const hero = unit('hero', { isPlayer: true, position: at(0, 1) });

  it('repositions instead of passing when silenced', () => {
    const silenced = unit('foe', {
      skills: [slash],
      position: at(0, -3),
      activeEffects: [eff(AfflictionType.Silence)],
    });
    const actions = decideEnemyAction(silenced, [silenced, hero]);
    expect(actions.some((a) => a.type === 'skill')).toBe(false);
    expect(actions.some((a) => a.type === 'move')).toBe(true);
  });

  it('stays put and still fights when rooted', () => {
    const rooted = unit('foe', {
      skills: [slash],
      position: at(0, 0),
      activeEffects: [eff(AfflictionType.Root)],
    });
    const actions = decideEnemyAction(rooted, [rooted, hero]);
    expect(actions.some((a) => a.type === 'move')).toBe(false);
    expect(actions.find((a) => a.type === 'skill')?.skill?.id).toBe('slash');
  });

  it('cannot aim a single-target skill at a stealthed hero', () => {
    const stealthed = { ...hero, activeEffects: [eff(AuraType.Stealth)] };
    const foe = unit('foe', { skills: [slash], position: at(0, 0) });
    expect(decideEnemyAction(foe, [foe, stealthed]).some((a) => a.type === 'skill')).toBe(false);
  });

  it('can still sweep a stealthed hero out with an area skill', () => {
    const stealthed = { ...hero, activeEffects: [eff(AuraType.Stealth)] };
    const foe = unit('foe', { skills: [whirlwind], position: at(0, 0), currentMana: 99 });
    expect(decideEnemyAction(foe, [foe, stealthed]).some((a) => a.type === 'skill')).toBe(true);
  });

  it('attacks the loudest taunter rather than the weakest hero', () => {
    const squishy = unit('squishy', { isPlayer: true, position: at(1, 0), currentHp: 5 });
    const tank = unit('tank', { isPlayer: true, position: at(0, 1), currentHp: 60 });
    const foe = unit('foe', {
      skills: [slash],
      position: at(0, 0),
      activeEffects: [
        eff(AfflictionType.Taunt, { magnitude: 1, sourceUnitId: 'squishy', appliedAt: 5 }),
        eff(AfflictionType.Taunt, { magnitude: 4, sourceUnitId: 'tank', appliedAt: 1 }),
      ],
    });
    const action = decideEnemyAction(foe, [foe, squishy, tank]).find((a) => a.type === 'skill');
    expect(action?.skillTarget).toEqual(tank.position);
  });

  // The area skill is ignored; the turn is not lost but spent on the fallback
  // Basic Attack (playtest 2026-10-23)
  it('ignores an area skill while taunted, and strikes the taunter with its Basic Attack', () => {
    const tank = unit('tank', { isPlayer: true, position: at(0, 1) });
    const foe = unit('foe', {
      skills: [whirlwind],
      currentMana: 99,
      position: at(0, 0),
      activeEffects: [eff(AfflictionType.Taunt, { magnitude: 2, sourceUnitId: 'tank' })],
    });
    const casts = decideEnemyAction(foe, [foe, tank]).filter((a) => a.type === 'skill');
    expect(casts.map((a) => a.skill?.id)).toEqual([BASIC_ATTACK_ID]);
    expect(casts[0].skillTarget).toEqual(tank.position);
  });

  it('goes back to normal targeting once the taunter dies', () => {
    const corpse = unit('tank', { isPlayer: true, position: at(0, 1), currentHp: 0 });
    const live = unit('mage', { isPlayer: true, position: at(1, 0) });
    const foe = unit('foe', {
      skills: [slash],
      position: at(0, 0),
      activeEffects: [eff(AfflictionType.Taunt, { magnitude: 5, sourceUnitId: 'tank' })],
    });
    const action = decideEnemyAction(foe, [foe, corpse, live]).find((a) => a.type === 'skill');
    expect(action?.skillTarget).toEqual(live.position);
  });

  // Ground Slam is a Ring at range 0, which the targeted branch can never reach
  it('will cast the summon’s area taunt', () => {
    const golem = unit('golem', {
      skills: [groundSlam],
      position: at(0, 0),
      currentMana: 0,
      stats: { ...unit('x').stats, maxMana: 0 },
    });
    const action = decideEnemyAction(golem, [golem, hero]).find((a) => a.type === 'skill');
    expect(action?.skill?.id).toBe('ground_slam');
  });
});

// ─── Announcing a status ──────────────────────────────────────────────────────

/**
 * A status landing is a thing that happens *to a unit*, and until it was
 * announced the only record was a line in a scrolling log nobody reads
 * mid-fight.
 *
 * The rule worth pinning is not that the popup exists — it is that it exists on
 * **every route in**. `combatEvents` is shared precisely because the player's
 * resolver and the AI's executor are two copies of "resolve a skill" that have
 * drifted before, and a status the player can see land on an enemy but not see
 * land on themselves would be that same bug wearing a new hat.
 */
describe('status announcements', () => {
  const caster = unit('caster', { position: at(0, -1) });
  const victim = unit('victim', { isPlayer: true, position: at(0, 0) });

  const record = () => {
    const seen: { label: string; color: string }[] = [];
    return {
      sink: { log: () => {}, status: (_at: HexCoord, label: string, color: string) => { seen.push({ label, color }); } },
      seen,
    };
  };

  const setup = () => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([{ ...victim }], [{ ...caster }]);
  };

  it('names a status that landed, in that status own colour', () => {
    setup();
    const { sink, seen } = record();
    applySkillStatus(
      requireUnit(useCombatStore.getState().units, 'caster'),
      'victim',
      eff(AfflictionType.Stun, { duration: 2 }),
      sink,
    );
    expect(seen.map((s) => s.label)).toEqual([statusName(AfflictionType.Stun)]);
    expect(seen[0].color).toBe(STATUS_DISPLAY[AfflictionType.Stun].color);
  });

  /**
   * `applyEffect` is where `DebuffImmunity` silently drops afflictions. A word
   * floating over a unit that shrugged the affliction off is worse than saying
   * nothing, because it reports the opposite of what happened.
   */
  it('says nothing when the status never landed', () => {
    setup();
    useCombatStore.getState().applyEffect('victim', eff(AuraType.DebuffImmunity, { duration: -1 }));
    const { sink, seen } = record();
    applySkillStatus(
      requireUnit(useCombatStore.getState().units, 'caster'),
      'victim',
      eff(AfflictionType.Stun, { duration: 2 }),
      sink,
    );
    expect(seen).toEqual([]);
  });

  /** Poison is the one status whose count is the story rather than a detail. */
  it('counts the doses on a pile of poison', () => {
    setup();
    const { sink, seen } = record();
    const source = () => requireUnit(useCombatStore.getState().units, 'caster');
    for (let i = 0; i < 2; i++) {
      applySkillStatus(source(), 'victim', eff(AfflictionType.Poison, {
        magnitude: 4, duration: BALANCE.POISON_TICKS, sourceUnitId: 'caster',
      }), sink);
    }
    expect(seen[0].label).toBe(statusName(AfflictionType.Poison));
    expect(seen[1].label).toContain('2');
  });

  /**
   * Internal bookkeeping the player is never meant to see. The display table
   * already records which those are; this is what stops the popup becoming the
   * one place that ignores it.
   */
  it('never announces a hidden status', () => {
    const hidden = Object.entries(STATUS_DISPLAY)
      .filter(([, d]) => d.hidden)
      .map(([type]) => type);
    const announced: string[] = [];
    for (const type of hidden) {
      setup();
      const { sink, seen } = record();
      applySkillStatus(
        requireUnit(useCombatStore.getState().units, 'caster'),
        'victim',
        eff(type as ActiveEffect['type'], { duration: 3 }),
        sink,
      );
      if (seen.length) announced.push(type);
    }
    expect(announced).toEqual([]);
  });
});
