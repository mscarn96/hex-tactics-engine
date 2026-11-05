import { bagFrom } from '@/data/items/bag';
import { CombatUnit, Hero, HeroClass, VfxSpec } from '@/models/types';
import { apexForm, bearForm, hawkForm, wolfForm } from '@/data/skills/masterySkills';
import { WILD_FORMS } from '@/data/templates/wildForms';
import { useCombatStore } from '@/stores/combatStore';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { createPlayerUnits } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { formToCarry, openingForm } from '@/systems/combat/wildshape';
import { planOpeningForms, takeOpeningForms } from '@/systems/combat/openingForms';
import { SILENT_SINK } from '@/systems/combat/skillResolution';
import { combatMaxHp } from '@/systems/combat/forms';
import { at, makeHero, makeStats, makeUnit } from '../support/fixtures';

/**
 * PT-16: a Druid keeps the animal they ended a fight in and begins the next fight in
 * it, with the shift drawn. Only Bear, Wolf and Hawk are carried — Apex is a burst on
 * a clock, and a fight ended in it (or ended fallen) is carried as the Druid's own
 * shape. The opening shape costs nothing: no mana, no cooldown, no action.
 */

const SHIFTS = [bearForm, wolfForm, hawkForm, apexForm];

const druidHero = (over: Partial<Hero> = {}): Hero =>
  makeHero({
    id: 'druid', name: 'Druid', heroClass: HeroClass.Healer,
    baseStats: makeStats({ maxHp: 100, maxMana: 60, magic: 10, critChance: 0, dodgeChance: 0 }),
    currentHp: 80, currentMana: 20,
    skills: SHIFTS,
    ...over,
  });

const unitIn = (form: CombatUnit['wildForm'], hp = 50) =>
  makeUnit({ id: 'u', heroId: 'druid', position: at(0, 0), wildForm: form, currentHp: hp });

beforeEach(() => {
  useCombatStore.getState().reset();
  useInventoryStore.setState({ bag: bagFrom({ gear: [] }) });
});

describe('the shape a fight ends in', () => {
  it('carries each of the three animals', () => {
    expect(formToCarry(unitIn('bear'))).toBe('bear');
    expect(formToCarry(unitIn('wolf'))).toBe('wolf');
    expect(formToCarry(unitIn('hawk'))).toBe('hawk');
  });

  it('carries Apex, the Druid\'s own shape and a fallen Druid as their own shape', () => {
    expect(formToCarry(unitIn('apex'))).toBeNull();
    expect(formToCarry(unitIn(null))).toBeNull();
    expect(formToCarry(unitIn(undefined))).toBeNull();
    expect(formToCarry(unitIn('bear', 0))).toBeNull();
  });

  it('is written to the hero and cleared again by the party store', () => {
    usePartyStore.setState({ heroes: [druidHero()] });
    usePartyStore.getState().setCarriedForm('druid', 'wolf');
    expect(usePartyStore.getState().heroes[0].wildForm).toBe('wolf');
    usePartyStore.getState().setCarriedForm('druid', null);
    expect(usePartyStore.getState().heroes[0].wildForm ?? null).toBeNull();
  });

  it('survives the save: the hero is persisted as it stands', () => {
    // `persistence.ts` writes `party.heroes` whole, so the field round-trips as JSON
    const saved = JSON.parse(JSON.stringify(druidHero({ wildForm: 'hawk' }))) as Hero;
    expect(openingForm(saved)).toBe('hawk');
  });
});

describe('the shape a fight begins in', () => {
  it('is the carried animal while the hero still knows its shift', () => {
    expect(openingForm(druidHero({ wildForm: 'bear' }))).toBe('bear');
    expect(openingForm(druidHero({ wildForm: null }))).toBeNull();
    expect(openingForm(druidHero())).toBeNull();
  });

  it('is upright when the shift was lost to a respec, or the value is not a carried shape', () => {
    expect(openingForm(druidHero({ wildForm: 'hawk', skills: [bearForm] }))).toBeNull();
    expect(openingForm(druidHero({ wildForm: 'apex' as never }))).toBeNull();
    expect(openingForm(druidHero({ wildForm: 'dragon' as never }))).toBeNull();
  });

  it('is taken at the start of the fight, free, with health scaled into the shape and the shift drawn', () => {
    const hero = druidHero({ wildForm: 'bear' });
    const fielded = createPlayerUnits([hero], [at(0, 2)]);
    useCombatStore.getState().initCombat(fielded, [makeUnit({ id: 'foe', isPlayer: false, position: at(0, -3) })], 0);
    const units = useCombatStore.getState().units;
    const plan = planOpeningForms([hero], units);
    expect(plan).toEqual([{ unitId: fielded[0].id, form: 'bear' }]);

    const before = requireUnit(units, fielded[0].id);
    const drawn: VfxSpec[] = [];
    const taken = takeOpeningForms(plan, { ...SILENT_SINK, vfx: (spec) => drawn.push(spec) });
    const after = requireUnit(useCombatStore.getState().units, fielded[0].id);

    expect(taken.map((t) => t.skill.id)).toEqual(['bear_form']);
    expect(after.wildForm).toBe('bear');
    expect(after.skills.some((s) => s.formSkill === 'bear' || WILD_FORMS.bear.skills.includes(s.id))).toBe(true);
    // Free: the mana stands, the shift has no cooldown running, the turn is untouched
    expect(after.currentMana).toBe(before.currentMana);
    expect(after.cooldowns?.bear_form ?? 0).toBe(0);
    expect(after.hasActed).toBe(false);
    // The same share of a bigger pool, as a cast would leave it
    expect(after.currentHp / combatMaxHp(after)).toBeCloseTo(before.currentHp / combatMaxHp(before), 1);
    // The shift's own picture, on the Druid
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ kind: bearForm.vfxKind, casterId: after.id, color: WILD_FORMS.bear.color });
  });

  it('round-trips: a fight won as a wolf begins the next as a wolf, one won in Apex begins upright', () => {
    usePartyStore.setState({ heroes: [druidHero()] });
    usePartyStore.getState().setCarriedForm('druid', formToCarry(unitIn('wolf')));
    const next = usePartyStore.getState().heroes;
    expect(planOpeningForms(next, createPlayerUnits(next, [at(0, 2)])).map((s) => s.form)).toEqual(['wolf']);

    usePartyStore.getState().setCarriedForm('druid', formToCarry(unitIn('apex')));
    const after = usePartyStore.getState().heroes;
    expect(planOpeningForms(after, createPlayerUnits(after, [at(0, 2)]))).toEqual([]);
  });
});
