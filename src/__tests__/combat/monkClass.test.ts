import { BALANCE } from '@/data/balanceConstants';
import { usesChi } from '@/data/classResource';
import { FORMS } from '@/data/items/itemForms';
import { STARTER_KIT, itemTemplates } from '@/data/items/itemTemplates';
import { WEAPON_ATTACKS } from '@/data/items/weaponAttacks';
import { meditate } from '@/data/skills/skillData';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { useCombatStore } from '@/stores/combatStore';
import { starterBasicAttack } from '@/systems/combat/basicAttack';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { combatMaxHp } from '@/systems/combat/forms';
import { CombatSink, resolveSkillUse } from '@/systems/combat/skillResolution';
import { playerUnitFor } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { itemFromTemplateId } from '@/systems/economy/itemFactory';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { canEquip, canUnequip, illegalSlots, mainHandLocked } from '@/systems/progression/equipRules';
import { AuraType, CombatUnit, Hero, HeroClass, Item } from '@/models/types';
import { makeHero, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Monk base class (the private project notes, "The base class" and
 * "Equipment rules"): its template, Meditate, the hand wraps and their fist, the
 * starter kit, and the main hand locked until a path is chosen. Pinned as rules
 * against `BALANCE`, not as numbers.
 */

const M = BALANCE.MEDITATE;
const at = (q: number, r: number) => ({ q, r });
const template = heroTemplates.find((t) => t.id === 'monk')!;

const item = (templateId: string): Item => {
  const made = itemFromTemplateId(templateId);
  if (!made) throw new Error(`no template ${templateId}`);
  return made;
};

const monk = (over: Partial<Hero> = {}): Hero =>
  makeHero({
    templateId: 'monk',
    heroClass: HeroClass.Monk,
    masteryPath: null,
    baseStats: calculateStatsForLevel(template, 3),
    ...over,
  });

const sink = (): CombatSink => ({ log: () => {}, float: () => {}, vfx: () => {}, status: () => {} });

/** A level-3 Monk fielded with its starter wraps against one far-off dummy. */
function field(): void {
  useCombatStore.getState().reset();
  const unit = playerUnitFor(monk(), { mainHand: item('hand_wraps_plain') }, { id: 'monk', position: at(0, 0) });
  const foe = makeUnit({ id: 'foe', isPlayer: false, position: at(0, 4), stats: makeStats({ maxHp: 999 }) });
  useCombatStore.getState().initCombat([{ ...unit, skills: [...unit.skills, meditate] }], [foe]);
}

const self = (): CombatUnit => requireUnit(useCombatStore.getState().units, 'monk');
const has = (type: AuraType) => self().activeEffects.some((e) => e.type === type);
const startTurn = () => {
  useCombatStore.getState().tickCooldowns('monk');
  useCombatStore.getState().tickEffectsOnUnit('monk');
};

describe('the Monk class', () => {
  it('is a hero template that casts from chi, with a pool that does not grow', () => {
    expect(template.heroClass).toBe(HeroClass.Monk);
    expect(usesChi(template.heroClass)).toBe(true);
    expect(template.statGrowth.maxMana).toBe(0);
    expect(calculateStatsForLevel(template, BALANCE.MAX_LEVEL).maxMana).toBe(BALANCE.CHI.POOL);
  });

  it('owns Meditate as its level-3 identity skill, and nothing else before a path', () => {
    expect(template.skills.map((s) => s.id)).toEqual(['meditate']);
    expect(meditate.unlockLevel).toBe(3);
  });
});

describe('Meditate', () => {
  it('costs no chi, and is the action only: the turn keeps its move', () => {
    expect(meditate.manaCost).toBe(0);
    expect(meditate.freeAction).toBeFalsy();
    field();
    const result = resolveSkillUse(self(), meditate, self().position, sink());
    expect(result.ok).toBe(true);
    expect(self().hasMoved).toBeFalsy();
  });

  it('braces both defences now, until the next turn begins, and refills chi now', () => {
    field();
    useCombatStore.getState().spendMana('monk', BALANCE.CHI.POOL);
    const before = getCombatEffectiveStats(self());
    resolveSkillUse(self(), meditate, self().position, sink());
    const braced = getCombatEffectiveStats(self());
    expect(braced.defense).toBe(before.defense + M.PHYSICAL_DEFENSE);
    expect(braced.magicDefense).toBe((before.magicDefense ?? 0) + M.MAGIC_DEFENSE);
    expect(self().currentMana).toBe(BALANCE.CHI.MEDITATE_REFILL);
    // Nothing of the payout yet
    expect(braced.attack).toBe(before.attack);

    startTurn();
    const next = getCombatEffectiveStats(self());
    expect(next.defense).toBe(before.defense);
    expect(next.magicDefense).toBe(before.magicDefense);
  });

  it('heals and sharpens at the next turn start, for that turn only', () => {
    field();
    useCombatStore.getState().damageUnit('monk', 60);
    const hurt = self().currentHp;
    const before = getCombatEffectiveStats(self());
    resolveSkillUse(self(), meditate, self().position, sink());
    expect(self().currentHp).toBe(hurt);

    startTurn();
    const heal = Math.round(combatMaxHp(self()) * M.HEAL_SHARE);
    const regen = self().currentHp - hurt;
    expect(regen).toBe(heal);
    const sharp = getCombatEffectiveStats(self());
    expect(sharp.attack).toBe(before.attack + M.ATTACK);
    expect(sharp.magic).toBe(before.magic + M.MAGIC);
    expect(has(AuraType.Meditation)).toBe(false);

    // The turn after, the edge is gone and nothing pays twice
    startTurn();
    const after = getCombatEffectiveStats(self());
    expect(after.attack).toBe(before.attack);
    expect(after.magic).toBe(before.magic);
    expect(self().currentHp).toBe(hurt + heal);
  });

  it('can be pressed every other turn', () => {
    field();
    resolveSkillUse(self(), meditate, self().position, sink());
    startTurn();
    expect(canUseSkill(self(), meditate)).toBe(false);
    startTurn();
    expect(canUseSkill(self(), meditate)).toBe(true);
  });
});

describe('the hand wraps', () => {
  it('make a full-strength fist, where bare hands make half a blow', () => {
    expect(FORMS.hand_wraps.attack).toBe('fist');
    const fist = WEAPON_ATTACKS.fist;
    expect(fist.style).toBe('melee');
    expect(fist.range).toBe(1);
    expect(fist.scaling).toBe('attack');
    expect(fist.damage).toBe(1);
    expect(fist.damage).toBeGreaterThan(WEAPON_ATTACKS.unarmed.damage);
    expect(starterBasicAttack(HeroClass.Monk).damage).toBe(fist.damage);
  });

  it('are the starter weapon, with plain vestment and no off-hand', () => {
    const kit = STARTER_KIT[HeroClass.Monk].map((id) => itemTemplates.find((t) => t.id === id)!);
    expect(kit[0].form).toBe('hand_wraps');
    expect(kit.map((t) => t.slot).sort()).toEqual(['chest', 'feet', 'legs', 'mainHand']);
    expect(kit.filter((t) => t.slot !== 'mainHand').every((t) => t.form.startsWith('vestment_'))).toBe(true);
    expect(kit.every((t) => t.motif === 'plain')).toBe(true);
  });
});

describe('the locked main hand', () => {
  const wraps = () => item('hand_wraps_plain');

  it('locks a Monk without a path, and nobody else', () => {
    expect(mainHandLocked(monk())).toBe(true);
    expect(mainHandLocked(makeHero({ masteryPath: null }))).toBe(false);
    for (const cls of Object.values(HeroClass)) {
      if (cls === HeroClass.Monk) continue;
      expect(mainHandLocked({ heroClass: cls, masteryPath: null })).toBe(false);
    }
  });

  it('will not let the wraps come off before a path', () => {
    expect(canUnequip(monk(), 'mainHand').ok).toBe(false);
    expect(canUnequip(monk(), 'chest').ok).toBe(true);
    expect(canUnequip(makeHero({ masteryPath: null }), 'mainHand').ok).toBe(true);
  });

  it('will not let the wraps be replaced, even by another pair', () => {
    const worn = { mainHand: wraps() };
    expect(canEquip(monk(), wraps(), 'mainHand', worn).ok).toBe(false);
  });

  it('keeps the worn wraps legal, and lets them bind an empty hand', () => {
    expect(illegalSlots(monk(), { mainHand: wraps() })).toEqual([]);
    expect(canEquip(monk(), wraps(), 'mainHand', {}).ok).toBe(true);
  });

  it('refuses any other weapon in the main hand', () => {
    const sword = { ...item('short_sword_plain'), classLock: undefined };
    expect(canEquip(monk(), sword, 'mainHand', {}).ok).toBe(false);
  });

  it('opens once the hero has a path', () => {
    // No Monk path exists yet, so any path stands in for one
    expect(mainHandLocked(monk({ masteryPath: 'bulwark' }))).toBe(false);
    expect(canUnequip(monk({ masteryPath: 'bulwark' }), 'mainHand').ok).toBe(true);
  });
});
