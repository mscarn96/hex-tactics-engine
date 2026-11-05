import { AfflictionType, AuraType, CombatUnit, HeroSkill, SkillTargetType } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { requireUnit } from '@/systems/combat/unitLookup';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { ignoresDisable, isBoss, previewInterrupts, showsBossHealthBar } from '@/systems/combat/bossControl';
import { applySkillStatus } from '@/systems/combat/combatEvents';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { skillEffectLines } from '@/data/display/skillDisplay';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * Bosses ignore ordinary disables and stay tauntable; a preparation says which
 * of them interrupt it, and an interrupt cancels that preparation and nothing
 * else.
 */

const bossTemplate = enemyTemplates.find((t) => t.tier === 'boss')!;
const eliteTemplate = enemyTemplates.find((t) => t.tier === 'elite')!;

const warned = (over: Partial<HeroSkill> = {}): HeroSkill =>
  makeSkill({
    id: 'warned_slam' as HeroSkill['id'],
    name: 'Warned Slam',
    targetType: SkillTargetType.Ring,
    range: 0,
    aoeRadius: 1,
    damage: 1,
    prepares: { interruptedBy: ['stun', 'silence', 'freeze'], tauntCancels: false },
    ...over,
  });

const boss = (over: Partial<CombatUnit> = {}) =>
  makeFoe({
    id: 'boss',
    name: 'Boss',
    templateId: bossTemplate.id,
    position: at(0, 0),
    stats: makeStats({ maxHp: 500, speed: 20, critChance: 0, dodgeChance: 0 }),
    skills: [warned()],
    ...over,
  });

const hero = () =>
  makeUnit({
    id: 'hero',
    heroId: 'hero',
    name: 'Hero',
    position: at(1, 0),
    stats: makeStats({ maxHp: 300, speed: 5, critChance: 0, dodgeChance: 0 }),
  });

const unitOf = (id: string) => requireUnit(useCombatStore.getState().units, id);
const pending = () => useCombatStore.getState().preparedAttacks;

function start(bossOver: Partial<CombatUnit> = {}, prepare: HeroSkill | null = warned()) {
  const store = useCombatStore.getState();
  store.reset();
  store.initCombat([hero()], [boss(bossOver)]);
  useCombatStore.setState({ currentUnitId: 'boss' });
  if (prepare) resolveSkillUse(unitOf('boss'), prepare, at(0, 0), SILENT_SINK);
}

const land = (type: AfflictionType, duration = 3) =>
  applySkillStatus(unitOf('hero'), 'boss', { type, magnitude: 1, duration }, undefined);

describe('which bar shows health', () => {
  // The top-of-screen readout and the arena's in-world bar both ask
  // `showsBossHealthBar`: a unit gets exactly one of them.
  it('is the top readout for a living boss, and nothing over its body', () => {
    expect(showsBossHealthBar(boss())).toBe(true);
  });

  it('is the in-world bar for an elite and a hero', () => {
    expect(showsBossHealthBar(makeFoe({ templateId: eliteTemplate.id }))).toBe(false);
    expect(showsBossHealthBar(hero())).toBe(false);
  });

  it('leaves the top once the boss falls', () => {
    expect(showsBossHealthBar(boss({ currentHp: 0 }))).toBe(false);
  });
});

describe('what a boss ignores', () => {
  it('is decided by the template tier', () => {
    expect(isBoss(boss())).toBe(true);
    expect(isBoss(makeFoe({ templateId: eliteTemplate.id }))).toBe(false);
    expect(isBoss(hero())).toBe(false);
  });

  it.each([
    AfflictionType.Stun,
    AfflictionType.Silence,
    AfflictionType.Freeze,
    AfflictionType.Root,
  ])('does not keep %s as an ordinary disable', (type) => {
    start({}, null);
    land(type);
    expect(unitOf('boss').activeEffects.some((e) => e.type === type)).toBe(false);
    expect(ignoresDisable(unitOf('boss'), type)).toBe(true);
  });

  it('cannot be stun-locked: it acts on every turn however often it is stunned', () => {
    start({}, null);
    for (let round = 0; round < 4; round++) {
      land(AfflictionType.Stun, 3);
      expect(beginTurn('boss', SILENT_SINK).kind).toBe('act');
    }
  });

  it('is still tauntable', () => {
    start({}, null);
    land(AfflictionType.Taunt);
    const taunt = unitOf('boss').activeEffects.find((e) => e.type === AfflictionType.Taunt);
    expect(taunt).toBeDefined();
    expect(ignoresDisable(unitOf('boss'), AfflictionType.Taunt)).toBe(false);
  });

  it('leaves the same disables on an elite, which keeps them', () => {
    const store = useCombatStore.getState();
    store.reset();
    store.initCombat([hero()], [makeFoe({ id: 'elite', templateId: eliteTemplate.id, position: at(0, 0) })]);
    applySkillStatus(unitOf('hero'), 'elite', { type: AfflictionType.Stun, magnitude: 1, duration: 3 });
    expect(unitOf('elite').activeEffects.some((e) => e.type === AfflictionType.Stun)).toBe(true);
  });
});

describe('interrupting a preparation', () => {
  it.each([AfflictionType.Stun, AfflictionType.Silence, AfflictionType.Freeze])(
    'cancels it when it lists %s, though the status does not stay',
    (type) => {
      start();
      expect(pending()).toHaveLength(1);

      land(type);

      expect(pending()).toHaveLength(0);
      expect(unitOf('boss').activeEffects.some((e) => e.type === type)).toBe(false);
    },
  );

  it('ignores a disable the preparation does not list, Root among them', () => {
    start();
    land(AfflictionType.Root);
    expect(pending()).toHaveLength(1);
  });

  it('lets a preparation list Root explicitly', () => {
    start({}, warned({ prepares: { interruptedBy: ['root'] } }));
    land(AfflictionType.Root);
    expect(pending()).toHaveLength(0);
  });

  it('cancels only the preparation, not the boss itself', () => {
    start();
    land(AfflictionType.Stun);
    const after = unitOf('boss');
    expect(after.currentHp).toBe(500);
    expect(after.activeEffects).toEqual([]);
    // It acts on its next turn as it always would
    expect(beginTurn('boss', SILENT_SINK).kind).toBe('act');
  });

  it('keeps Taunt as target control whether or not it cancels the preparation', () => {
    start({}, warned({ prepares: { interruptedBy: [], tauntCancels: false } }));
    land(AfflictionType.Taunt);
    expect(pending()).toHaveLength(1);
    expect(unitOf('boss').activeEffects.some((e) => e.type === AfflictionType.Taunt)).toBe(true);

    start({}, warned({ prepares: { interruptedBy: [], tauntCancels: true } }));
    land(AfflictionType.Taunt);
    expect(pending()).toHaveLength(0);
    expect(unitOf('boss').activeEffects.some((e) => e.type === AfflictionType.Taunt)).toBe(true);
  });

  it('cancels it even when the target shrugs off every debuff', () => {
    start();
    useCombatStore.getState().applyEffect('boss', {
      type: AuraType.DebuffImmunity, magnitude: 1, duration: 5,
    });
    land(AfflictionType.Stun);
    expect(pending()).toHaveLength(0);
  });

  it('does not cancel another caster\'s preparation', () => {
    start();
    const other = makeFoe({ id: 'other', position: at(0, 3), templateId: bossTemplate.id });
    useCombatStore.getState().addUnits([other]);
    resolveSkillUse(
      requireUnit(useCombatStore.getState().units, 'other'),
      warned({ id: 'other_slam' as HeroSkill['id'] }),
      at(0, 3),
      SILENT_SINK,
    );
    expect(pending()).toHaveLength(2);

    land(AfflictionType.Stun);

    expect(pending().map((p) => p.casterId)).toEqual(['other']);
  });
});

describe('the skill preview', () => {
  const stun = makeSkill({
    id: 'test_stun' as HeroSkill['id'],
    name: 'Test Stun',
    appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 2 },
  } as Partial<HeroSkill>);

  it('says which warnings a skill would interrupt', () => {
    start();
    const hits = previewInterrupts(stun, pending());
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ name: 'Warned Slam', certain: true });
  });

  it('says "may" when the status rides on a chance', () => {
    start();
    const chancy = makeSkill({
      ...stun,
      appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 2, chance: 0.4 },
    } as Partial<HeroSkill>);
    expect(previewInterrupts(chancy, pending())[0].certain).toBe(false);
  });

  it('says nothing for a skill that would not interrupt', () => {
    start();
    const bleed = makeSkill({
      appliesEffect: { type: AfflictionType.Bleed, magnitude: 1, duration: 2 },
    } as Partial<HeroSkill>);
    expect(previewInterrupts(bleed, pending())).toEqual([]);
  });

  it('writes the authored rule on the preparing skill itself', () => {
    const lines = skillEffectLines(warned({ prepares: { interruptedBy: ['stun'], tauntCancels: true } }));
    expect(lines).toContain('Interrupted by Stun, Taunt');
    expect(skillEffectLines(warned({ prepares: {} }))).toContain('Cannot be interrupted');
  });
});
