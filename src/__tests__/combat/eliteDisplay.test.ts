import { AfflictionType, AuraType, CombatUnit, HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { ELITE_LINK_STYLE, eliteLinks } from '@/data/display/eliteLinks';
import { warningLines } from '@/data/display/preparedDisplay';
import { STATUS_DISPLAY } from '@/data/display/statusDisplay';
import { useCombatStore } from '@/stores/combatStore';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { geasWarning } from '@/systems/combat/eliteKits';
import { previewPrepared } from '@/systems/combat/preparedAttacks';
import { isHiddenFrom } from '@/systems/combat/statusEffects';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';
import { statusDescription } from '@/data/display/statusDisplay';

/**
 * What the party is told: the lines the arena draws between an elite and what its
 * signature is tied to, the words on each warning, the skill panel's note about a
 * Geas, and the status badges. Presentation is a rule here, not decoration — a
 * mechanic the party cannot read is the one thing the plan forbids.
 */

const hero = (id: string, position = at(0, 2)) =>
  makeUnit({ id, heroId: id, name: id, position, stats: makeStats({ maxHp: 4000, attack: 30, speed: 5 }) });

const units = () => useCombatStore.getState().units;
const prepared = () => useCombatStore.getState().preparedAttacks;

function start(template: string, position: ReturnType<typeof at>, heroes: CombatUnit[], extra: string[] = []) {
  const store = useCombatStore.getState();
  store.reset();
  const bodies = createEnemyUnits([template, ...extra], [position, ...extra.map((_, i) => at(i + 2, -3))], 1, 1);
  store.initCombat(heroes, bodies);
}

function turnOf(template: string, only: string) {
  const unit = units().find((u) => u.templateId === template)!;
  const view = { ...unit, skills: unit.skills.filter((s) => s.id === only) };
  executeAIActions(unit, decideEnemyAction(view, units()));
}

describe('the lines between an elite and its signature', () => {
  it('draws the Captain\'s word to every ally under it, and to nobody else', () => {
    start('brigand_captain', at(0, -4), [hero('h1')], ['bandit', 'footpad']);
    const [link] = eliteLinks(units()).filter((l) => l.kind === 'authority');
    expect(link.pairs).toHaveLength(2);
    const captain = units().find((u) => u.templateId === 'brigand_captain')!;
    for (const [from] of link.pairs) expect(from).toEqual(captain.position);
  });

  it('draws each soul fragment to its body, and a seed to the hero it feeds on', () => {
    start('revenant', at(0, -3), [hero('h1')]);
    useCombatStore.getState().damageUnit(units().find((u) => u.templateId === 'revenant')!.id, 99999, 'h1');
    const [souls] = eliteLinks(units()).filter((l) => l.kind === 'soul');
    expect(souls.pairs).toHaveLength(BALANCE.SOUL_FRAGMENTS);

    start('coven_matriarch', at(0, -3), [hero('h1', at(0, -1))]);
    turnOf('coven_matriarch', 'briar_blight');
    const [briar] = eliteLinks(units()).filter((l) => l.kind === 'briar');
    expect(briar.pairs).toHaveLength(1);
  });

  it('draws the hero the Mage holds and the hero the Warchief named, and drops a link when its giver falls', () => {
    start('dark_mage', at(0, -3), [hero('h1'), hero('h2', at(2, 2))]);
    const mage = units().find((u) => u.templateId === 'dark_mage')!;
    useCombatStore.getState().applyEffect('h1', {
      type: AfflictionType.MindControl, magnitude: 1, duration: 2, sourceUnitId: mage.id,
    });
    expect(eliteLinks(units()).some((l) => l.kind === 'mind')).toBe(true);
    useCombatStore.getState().damageUnit(mage.id, 99999, 'h2');
    expect(eliteLinks(units()).some((l) => l.kind === 'mind')).toBe(false);

    start('orc_warchief', at(0, -3), [hero('h1'), hero('h2', at(2, 2))]);
    const chief = units().find((u) => u.templateId === 'orc_warchief')!;
    useCombatStore.getState().applyEffect('h1', {
      type: AfflictionType.Warband, magnitude: 1, duration: 2, sourceUnitId: chief.id,
    });
    expect(eliteLinks(units()).some((l) => l.kind === 'warband')).toBe(true);
  });

  it('has a style for every kind and draws nothing when nothing is tied', () => {
    start('ghost', at(0, -3), [hero('h1')]);
    expect(eliteLinks(units())).toEqual([]);
    for (const kind of ['authority', 'soul', 'briar', 'mind', 'warband'] as const) {
      expect(ELITE_LINK_STYLE[kind].colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('the words on a warning', () => {
  const line = (id: string) => {
    const attack = prepared().find((p) => p.id === id)!;
    const previews = prepared().map((p) => previewPrepared(p, units(), useCombatStore.getState().hazards));
    return warningLines([attack], previews, units())[0];
  };

  it('says what the marsh does and how to answer it', () => {
    start('bog_hulk', at(0, -3), [hero('h1', at(-1, -2)), hero('h2', at(0, 0))]);
    turnOf('bog_hulk', 'mire_undertow');
    const text = line(prepared()[0].id).detail;
    expect(text).toContain('marsh');
    expect(text).toContain('hold your ground');
  });

  it('names the heroes the cracked ground follows', () => {
    start('delve_overseer', at(0, -3), [hero('a', at(-2, 0)), hero('b', at(3, 0))]);
    useCombatStore.getState().applyEffect('b', {
      type: AfflictionType.Fracture, magnitude: 1, duration: 3, sourceUnitId: units().find((u) => u.templateId === 'delve_overseer')!.id,
    });
    turnOf('delve_overseer', 'fracture_slam');
    expect(line(prepared()[0].id).detail).toContain('b');
  });

  it('says a seed needs both to grow, and that the Mage can be interrupted', () => {
    start('coven_matriarch', at(0, -3), [hero('h1', at(0, -1))]);
    turnOf('coven_matriarch', 'briar_blight');
    expect(line(prepared()[0].id).detail).toContain('cut down');

    start('dark_mage', at(0, -3), [hero('h1', at(0, 0)), hero('h2', at(2, 2))]);
    turnOf('dark_mage', 'mind_control');
    expect(line(prepared()[0].id).detail).toContain('step off the mark');
  });

  it('says a feast is wide, bleeds and can be broken', () => {
    start('orc_berserker', at(0, -3), [hero('h1', at(0, -2))]);
    const orc = units().find((u) => u.templateId === 'orc_berserker')!;
    for (let i = 0; i < BALANCE.PAIN_FEAST_THRESHOLD; i++) useCombatStore.getState().damageUnit(orc.id, 1, 'h1');
    const view = units().find((u) => u.id === orc.id)!;
    executeAIActions(view, decideEnemyAction(view, units()));
    expect(line(prepared()[0].id).detail).toContain('Stun, Silence or Freeze');
  });
});

describe('the skill panel on a Geas', () => {
  const spell = makeSkill({ id: 'bolt' as HeroSkill['id'], damage: 1, manaCost: 5 });
  const basic = makeSkill({ id: BASIC_ATTACK_ID as HeroSkill['id'], damage: 1 });
  const cursed = makeUnit({
    id: 'c', activeEffects: [{ type: AfflictionType.Geas, magnitude: 1, duration: 3 }],
  });

  it('says nothing to a hero with no curse', () => {
    expect(geasWarning(spell, makeUnit({ id: 'free' }))).toBeNull();
  });
});

describe('the statuses', () => {
  it('describes each new one in the party\'s words and sorts it onto its side', () => {
    for (const type of [AuraType.Slumber, AuraType.Rage, AuraType.Authority, AuraType.SoulSplit]) {
      expect(STATUS_DISPLAY[type].kind).toBe('aura');
    }
    for (const type of [AfflictionType.MindControl, AfflictionType.Warband, AfflictionType.Fracture, AfflictionType.Geas]) {
      expect(STATUS_DISPLAY[type].kind).toBe('affliction');
      expect(statusDescription(type).length).toBeGreaterThan(30);
    }
  });

  it('keeps a broken Revenant out of every single-target skill\'s reach', () => {
    start('revenant', at(0, -3), [hero('h1')]);
    const body = units().find((u) => u.templateId === 'revenant')!;
    useCombatStore.getState().damageUnit(body.id, 99999, 'h1');
    const aimed = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 6 });
    expect(isHiddenFrom(units().find((u) => u.id === body.id)!, aimed)).toBe(true);
  });
});
