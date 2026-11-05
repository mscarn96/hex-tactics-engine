import { CarriedWildFormId, CombatUnit, Hero, HeroSkill } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { unitById } from '@/systems/combat/unitLookup';
import { openingForm } from '@/systems/combat/wildshape';
import { announceShift, CombatSink } from '@/systems/combat/skillResolution';

/**
 * A Druid walking into a fight in the animal they left the last one in (PT-16).
 *
 * The shape is the hero's (`Hero.wildForm`, written when a fight is won or lost);
 * the rules for which shapes are carried live in `wildshape` (`formToCarry`,
 * `openingForm`). This is the store half: the same `setWildForm` a shift cast
 * makes, drawn with the same picture (`announceShift`).
 *
 * **It is free.** No mana, no cooldown on the shift skill, no action: the shape
 * was paid for in the fight it was taken in and simply never given back. Charging
 * the shift's mana again would make carrying a shape a tax on the Druid who kept
 * it, and a cooldown on the opening turn would stop them changing their mind.
 * Health is scaled into the shape's pool by `setWildForm` exactly as a cast scales
 * it, so a hero who walks in at 80% walks in as a bear at 80%.
 */
export interface OpeningShift {
  unitId: string;
  form: CarriedWildFormId;
}

/** Which of the fielded heroes begin in a shape, and which. Pure. */
export function planOpeningForms(heroes: readonly Hero[], units: readonly CombatUnit[]): OpeningShift[] {
  const shifts: OpeningShift[] = [];
  for (const unit of units) {
    if (!unit.isPlayer || !unit.heroId || unit.currentHp <= 0 || unit.wildForm) continue;
    const hero = heroes.find((h) => h.id === unit.heroId);
    const form = hero && openingForm(hero);
    if (form) shifts.push({ unitId: unit.id, form });
  }
  return shifts;
}

/**
 * Takes each planned shape and draws it. Returns the shift skill each was drawn
 * with, so the scene can hold the first turn until the longest picture is done.
 */
export function takeOpeningForms(
  shifts: readonly OpeningShift[],
  sink: CombatSink,
): { unit: CombatUnit; skill: HeroSkill }[] {
  const store = useCombatStore.getState();
  const taken: { unit: CombatUnit; skill: HeroSkill }[] = [];
  for (const { unitId, form } of shifts) {
    const unit = unitById(useCombatStore.getState().units, unitId);
    if (!unit || unit.currentHp <= 0 || unit.wildForm) continue;
    const skill = (unit.humanSkills ?? unit.skills).find((s) => s.shiftsTo === form);
    if (!skill) continue;
    store.setWildForm(unitId, form);
    const shifted = unitById(useCombatStore.getState().units, unitId) ?? unit;
    announceShift(shifted, skill, form, sink);
    taken.push({ unit: shifted, skill });
  }
  return taken;
}
