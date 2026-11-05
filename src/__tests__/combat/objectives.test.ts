import {
  AfflictionType,
  CombatUnit,
  HeroSkill,
  SkillTargetType,
} from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { requireUnit } from '@/systems/combat/unitLookup';
import { combatOutcome } from '@/systems/combat/combatOutcome';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import {
  createObjective,
  MAX_OBJECTIVE_PROTECTION,
  objectiveProtection,
  protectedDamage,
} from '@/systems/combat/objectives';
import { castObjectives, placeObjective } from '@/systems/combat/objectiveBoard';
import { applyAllyHealOnHit } from '@/systems/combat/combatEvents';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { BALANCE } from '@/data/balanceConstants';
import { imperialStandards } from '@/data/templates/aethelred';

/**
 * An attackable objective is a unit that never acts, never decides the fight,
 * and means something to the unit that raised it. The rules pinned here are the
 * three that make it an objective rather than a body: heroes can target and
 * destroy it, destroying it changes the encounter, and the AI will raise one
 * even though raising it deals nothing.
 */

const EXPOSED = { type: AfflictionType.DefenseDown, magnitude: 6, duration: 3 };

const banner = (over: Partial<HeroSkill> = {}): HeroSkill =>
  makeSkill({
    id: 'test_banner' as HeroSkill['id'],
    name: 'Test Banner',
    targetType: SkillTargetType.Self,
    range: 0,
    manaCost: 0,
    cooldown: 2,
    places: {
      kind: 'standard',
      name: 'Standard',
      count: 2,
      hpFraction: 0.05,
      protection: 0.3,
      onAllDestroyed: [EXPOSED],
    },
    ...over,
  });

const boss = (over: Partial<CombatUnit> = {}) =>
  makeFoe({
    id: 'boss',
    name: 'Boss',
    position: at(0, -3),
    stats: makeStats({ maxHp: 400, attack: 20, defense: 0, speed: 20, critChance: 0, dodgeChance: 0 }),
    skills: [banner()],
    ...over,
  });

const hero = (id = 'h1', position = at(0, 0)) =>
  makeUnit({
    id,
    heroId: id,
    name: id,
    position,
    stats: makeStats({ maxHp: 300, attack: 40, speed: 5, critChance: 0, dodgeChance: 0, moveRange: 2 }),
    skills: [makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 6 })],
  });

const units = () => useCombatStore.getState().units;
const unitOf = (id: string) => requireUnit(units(), id);
const standards = () => units().filter((u) => u.objective?.kind === 'standard');

function start(bossOver: Partial<CombatUnit> = {}) {
  const store = useCombatStore.getState();
  store.reset();
  store.initCombat([hero()], [boss(bossOver)]);
  useCombatStore.setState({ currentUnitId: 'boss' });
}

const raise = () => resolveSkillUse(unitOf('boss'), banner(), at(0, -3), SILENT_SINK);

describe('placing one', () => {
  it('raises the objectives beside the caster, on its side', () => {
    start();
    expect(raise().ok).toBe(true);

    expect(standards()).toHaveLength(2);
    for (const s of standards()) {
      expect(s.isPlayer).toBe(false);
      expect(s.objective?.ownerId).toBe('boss');
      expect(s.currentHp).toBe(20); // 5% of 400
    }
  });

  it('never enters the turn order', () => {
    start();
    raise();
    const ids = useCombatStore.getState().turnOrder;
    expect(ids).toEqual(expect.not.arrayContaining(standards().map((s) => s.id)));
  });

  it('does not hold a won fight open, nor a lost one', () => {
    start();
    raise();
    expect(combatOutcome(units())).toBe('ongoing');

    useCombatStore.getState().damageUnit('boss', 9999);
    expect(combatOutcome(units())).toBe('victory');
    expect(standards().every((s) => s.currentHp > 0)).toBe(true);
  });

  it('cannot be recast on top of its own field', () => {
    start();
    raise();
    useCombatStore.getState().startCooldown('boss', banner()); // refunded below
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'boss' ? { ...u, cooldowns: {} } : u)),
    }));

    const again = raise();

    expect(again.ok).toBe(false);
    expect(standards()).toHaveLength(2);
  });

  it('is available again once enough have fallen', () => {
    start();
    raise();
    const [first] = standards();
    useCombatStore.getState().damageUnit(first.id, 999);
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'boss' ? { ...u, cooldowns: {} } : u)),
    }));
    expect(raise().ok).toBe(true);
    expect(standards().filter((s) => s.currentHp > 0)).toHaveLength(2);
  });
});

describe('attacking one', () => {
  it('can be targeted and destroyed by a hero', () => {
    start();
    raise();
    const target = standards()[0];
    useCombatStore.setState({ currentUnitId: 'h1' });

    // The highlight pass offers it as a target
    const offered = getValidSkillTargetHexes(unitOf('h1').skills[0], unitOf('h1'), units());
    expect(offered).toContainEqual(target.position);

    const swing = unitOf('h1').skills[0];
    const hit = resolveSkillUse(unitOf('h1'), swing, target.position, SILENT_SINK);

    expect(hit.ok).toBe(true);
    expect(unitOf(target.id).currentHp).toBe(0);
  });

  it('reduces what its owner takes while it stands, and only then', () => {
    start();
    raise();
    const owner = unitOf('boss');
    const open = protectedDamage({ ...owner }, [], 100);
    const covered = protectedDamage(owner, units(), 100);

    expect(open).toBe(100);
    expect(covered).toBeLessThan(100);
    expect(objectiveProtection(owner, units())).toBeCloseTo(0.6); // two at 0.3
  });

  it('caps what the objectives can soak, so the owner is never untouchable', () => {
    start();
    const owner = unitOf('boss');
    for (let i = 0; i < 6; i++) {
      placeObjective({
        kind: 'standard', name: 'Standard', owner, position: at(i - 3, 0), hp: 10, protection: 0.5,
      });
    }
    expect(objectiveProtection(owner, units())).toBe(MAX_OBJECTIVE_PROTECTION);
    expect(protectedDamage(owner, units(), 50)).toBeGreaterThanOrEqual(1);
  });

  it('changes the encounter when the last one falls: the owner is exposed', () => {
    start();
    raise();
    const [a, b] = standards();
    const store = useCombatStore.getState();

    store.damageUnit(a.id, 999, 'h1');
    // One still stands: nothing yet
    expect(unitOf('boss').activeEffects.some((e) => e.type === AfflictionType.DefenseDown)).toBe(false);
    expect(objectiveProtection(unitOf('boss'), units())).toBeCloseTo(0.3);

    const { deathEvents } = store.damageUnit(b.id, 999, 'h1');

    expect(unitOf('boss').activeEffects.some((e) => e.type === AfflictionType.DefenseDown)).toBe(true);
    expect(objectiveProtection(unitOf('boss'), units())).toBe(0);
    expect(deathEvents?.map((e) => e.text)).toContain('is left exposed');
  });

  it('counts down on its owner\'s turns and then fades', () => {
    start();
    placeObjective({
      kind: 'timed', name: 'Timed', owner: unitOf('boss'), position: at(1, -3), hp: 10, turnsLeft: 2,
    });
    const timed = () => units().find((u) => u.objective?.kind === 'timed')!;

    beginTurn('boss', SILENT_SINK);
    expect(timed().currentHp).toBe(10);
    beginTurn('boss', SILENT_SINK);
    expect(timed().currentHp).toBe(0);
  });

  it('shatters at its owner\'s phase transition', () => {
    start({ templateId: 'aethelred' });
    raise();
    expect(standards().every((s) => s.currentHp > 0)).toBe(true);

    // He has lived a turn in the opening phase, so the threshold may be crossed
    useCombatStore.getState().patchBossScript('boss', { phaseTurns: 1 });
    // Past the third of its health the standards were soaking from
    useCombatStore.getState().damageUnit('boss', 400);

    expect(standards().every((s) => s.currentHp === 0)).toBe(true);
  });

  it('is cancelled with its linked warning, and spent by it', () => {
    start();
    const owner = unitOf('boss');
    const heart = placeObjective({
      kind: 'heart', name: 'Heart', owner, position: at(1, -3), hp: 10, linkedPreparedId: 'prep_x',
    });
    useCombatStore.getState().addPreparedAttack({
      id: 'prep_x', casterId: 'boss', skill: banner(), spec: {}, aim: at(1, -3),
      origin: at(0, -3), hexes: [at(1, -3)], responders: [], responded: [],
    });

    useCombatStore.getState().damageUnit(heart.id, 999, 'h1');

    expect(useCombatStore.getState().preparedAttacks).toHaveLength(0);
  });
});

describe('the AI', () => {
  it('raises an objective even though it deals no damage', () => {
    start();
    const actions = decideEnemyAction(unitOf('boss'), units());
    const skill = actions.find((a) => a.type === 'skill');

    expect(skill?.skill?.id).toBe('test_banner');
  });

  it('does not replant a full field', () => {
    start();
    raise();
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'boss' ? { ...u, cooldowns: {} } : u)),
    }));
    const actions = decideEnemyAction(unitOf('boss'), units());
    expect(actions.some((a) => a.type === 'skill')).toBe(false);
  });

  it('executes the same cast the player\'s resolver makes', () => {
    start();
    const actions = decideEnemyAction(unitOf('boss'), units());
    executeAIActions(unitOf('boss'), actions);
    expect(standards()).toHaveLength(2);
  });

  it('is never the ally a damaging blow mends', () => {
    start();
    raise();
    const standard = standards()[0];
    const wounded = makeFoe({ id: 'grunt', position: at(3, -3), stats: makeStats({ maxHp: 100 }), currentHp: 10 });
    useCombatStore.getState().addUnits([wounded]);
    useCombatStore.getState().damageUnit(standard.id, 5); // nearer, and hurt

    const mend = makeSkill({ id: 'test_spill' as HeroSkill['id'], damage: 1, allyHeal: 1 });
    applyAllyHealOnHit(unitOf('boss'), mend, 10);

    expect(unitOf('grunt').currentHp).toBeGreaterThan(10);
    expect(unitOf(standard.id).currentHp).toBe(standard.currentHp - 5);
  });
});

describe('what it is made of', () => {
  it('builds the same unit placing does, without touching the store', () => {
    const owner = boss();
    const made = createObjective({ kind: 'x', name: 'X', owner, position: at(0, 0), hp: 10 });
    expect(made.objective?.ownerId).toBe('boss');
    expect(made.skills).toEqual([]);
    expect(made.stats.moveRange).toBe(0);
  });

  it('refuses to place with nowhere to stand', () => {
    start();
    const owner = unitOf('boss');
    const crowded = castObjectives(
      { ...owner, skills: [banner({ places: { ...banner().places!, count: 0 } })] },
      banner({ places: { ...banner().places!, count: 0 } }),
      owner.position,
      units(),
      () => {},
    );
    expect(crowded).toEqual([]);
  });
});

// Playtest 2026-10-14: Whiteout Convergence's spires and Aethelred's standards fell
// to one area spell. They take half from anything that reaches several at once.
describe('area resistance', () => {
  const owner = makeFoe({ id: 'boss', stats: makeStats({ maxHp: 1000 }) });
  const spire = (areaResist?: number) => createObjective({
    kind: 'ice_spire', name: 'Ice Spire', owner, position: at(2, 0), hp: 500, areaResist,
  });
  const hero = makeUnit({ id: 'hero', stats: makeStats({ attack: 40, magic: 40 }) });
  const single = makeSkill({ id: 'slash', damage: 1, targetType: SkillTargetType.Single, range: 3 });
  const blast = makeSkill({ id: 'blizzard', damage: 1, targetType: SkillTargetType.Ring, range: 3, aoeRadius: 2 });
  const beam = makeSkill({ id: 'absolute_zero', damage: 1, targetType: SkillTargetType.Line, range: 6 });

  it('halves an area or line hit on a resisting objective and leaves a single hit whole', () => {
    expect(calculateDamage(hero, spire(0.5), single)).toBe(calculateDamage(hero, spire(), single));
    expect(calculateDamage(hero, spire(0.5), blast)).toBe(Math.round(calculateDamage(hero, spire(), blast) / 2));
    expect(calculateDamage(hero, spire(0.5), beam)).toBe(Math.round(calculateDamage(hero, spire(), beam) / 2));
  });

  it('is what the spires and standards are raised with', () => {
    expect(BALANCE.HEART_SPIRE_AREA_RESIST).toBe(0.5);
    expect(imperialStandards.places?.areaResist).toBe(BALANCE.AETHELRED_STANDARD_AREA_RESIST);
    expect(BALANCE.AETHELRED_STANDARD_AREA_RESIST).toBe(0.5);
  });
});
