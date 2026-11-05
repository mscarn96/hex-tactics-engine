import { AfflictionType, AuraType, CombatUnit, SoundIntent, VfxSpec } from '@/models/types';
import { SHATTER_COLOR, THAW_COLOR } from '@/systems/combat/iceBreak';
import { BALANCE } from '@/data/balanceConstants';
import { STATUS_DISPLAY } from '@/data/display/statusDisplay';
import { useCombatStore } from '@/stores/combatStore';
import { beginTurn } from '@/systems/combat/turnStart';
import { combatOutcome, isDeadlocked } from '@/systems/combat/combatOutcome';
import { applyOnHitStatuses, applySkillStatus } from '@/systems/combat/combatEvents';
import { combatMaxHp } from '@/systems/combat/forms';
import { SILENT_SINK } from '@/systems/combat/skillResolution';
import { at, makeEffect, makeFoe, makeUnit } from '../support/fixtures';
import { statusName } from '@/data/gameText';

/**
 * Freeze is fixed-turn crowd control that pays out when it breaks.
 *
 * Three rules, and each replaced something that had quietly not worked:
 *
 * 1. It lasts `FREEZE_DURATION` turns and is read **pre-tick**, the way a Stun
 *    is. It used to be authored at the `99` sentinel and read *post*-tick, which
 *    is the only reading under which "until struck" could work — and the exact
 *    reading that turns a real duration into one turn fewer than it says.
 * 2. A blow shatters it for `SHATTER_BURST_HP` of the target's own
 *    `combatMaxHp`. A share of the *target* rather than of the attacker, so a
 *    Doom, a Thorns reflection or a summon's decay — none of which have an
 *    attacker at all — shatter exactly like a sword does.
 * 3. An all-frozen board is a fight in progress, not a defeat. `isDeadlocked`
 *    counted Freeze back when the ice held until damaged; leaving it there would
 *    hand the player a loss for landing a Blizzard well.
 */

const hero = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'hero', heroId: 'h1', position: at(0, 2), ...over });
const foe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({ id: 'foe', position: at(0, -2), ...over });

const setup = (heroOver: Partial<CombatUnit> = {}, foeOver: Partial<CombatUnit> = {}) => {
  useCombatStore.getState().reset();
  useCombatStore.getState().initCombat([hero(heroOver)], [foe(foeOver)]);
};

const unitNow = (id: string) => useCombatStore.getState().units.find((u) => u.id === id)!;
const frozen = (id: string) =>
  unitNow(id).activeEffects.find((e) => e.type === AfflictionType.Freeze);
const iced = (duration: number = BALANCE.FREEZE_DURATION) =>
  makeEffect(AfflictionType.Freeze, { duration });

describe('freeze costs its duration in turns', () => {
  it('costs exactly two turns at FREEZE_DURATION, and the third is free', () => {
    setup({}, { activeEffects: [iced()] });

    const verdicts: string[] = [];
    for (let i = 0; i < 3; i++) verdicts.push(beginTurn('foe', SILENT_SINK).kind);

    expect(verdicts).toEqual(['frozen', 'frozen', 'act']);
    expect(frozen('foe')).toBeUndefined();
  });

  /**
   * The pre-tick read is the whole reason "two turns" can be spelled `2`.
   *
   * Post-tick, the final turn's decrement has already retired the effect, so the
   * unit acts on a turn the duration says it should have lost — the `duration: 1`
   * trap Root, Silence and Doom each fell into.
   */
  it('reads the ice pre-tick, so the last frozen turn is still lost', () => {
    setup({}, { activeEffects: [iced(1)] });

    expect(beginTurn('foe', SILENT_SINK).kind).toBe('frozen');
    expect(frozen('foe')).toBeUndefined();
  });

  it('reports no deadlock flag on the frozen verdict at all', () => {
    setup({}, { activeEffects: [iced()] });
    const verdict = beginTurn('foe', SILENT_SINK);
    expect(Object.keys(verdict)).toEqual(['kind']);
  });
});

describe('a struck frozen unit shatters', () => {
  const burstFor = (unit: CombatUnit) =>
    Math.max(1, Math.round(combatMaxHp(unit) * BALANCE.SHATTER_BURST_HP));

  it('takes the blow plus a share of its own maximum health', () => {
    setup({}, { activeEffects: [iced()] });
    const target = unitNow('foe');
    const before = target.currentHp;

    const result = useCombatStore.getState().damageUnit('foe', 10, 'hero');

    expect(result.shatter).toBe(burstFor(target));
    expect(result.hpLost).toBe(10 + burstFor(target));
    expect(before - unitNow('foe').currentHp).toBe(10 + burstFor(target));
  });

  it('leaves nothing behind to shatter twice', () => {
    setup({}, { activeEffects: [iced()] });
    useCombatStore.getState().damageUnit('foe', 10, 'hero');

    expect(frozen('foe')).toBeUndefined();
    expect(useCombatStore.getState().damageUnit('foe', 10, 'hero').shatter).toBeUndefined();
  });

  /**
   * The entire argument for a %HP burst rather than an attacker-derived one.
   *
   * A poison tick, a Doom, a summon's decay and a Martyr blast all reach
   * `damageUnit` with no attacker to roll a strike against; a burst measured off
   * one would silently be nothing down every one of those paths.
   */
  it('fires for a damage source with no attacker at all', () => {
    setup({}, { activeEffects: [iced()] });
    const target = unitNow('foe');

    const result = useCombatStore.getState().damageUnit('foe', 7);

    expect(result.shatter).toBe(burstFor(target));
    expect(result.hpLost).toBe(7 + burstFor(target));
  });

  it('reports nothing when the target was never frozen', () => {
    setup();
    expect(useCombatStore.getState().damageUnit('foe', 10, 'hero').shatter).toBeUndefined();
  });

  /**
   * A bear is fought out of the bear's pool, so the ice is worth the bear's
   * share of it. Reading `stats.maxHp` here would charge a Wildshaped Druid the
   * burst of the person they are not currently standing there as.
   */
  it('is measured against combatMaxHp, not the hero\'s own maximum', () => {
    setup({ activeEffects: [iced()] });
    useCombatStore.getState().setWildForm('hero', 'bear');

    const bear = unitNow('hero');
    expect(combatMaxHp(bear)).toBeGreaterThan(bear.stats.maxHp);

    const result = useCombatStore.getState().damageUnit('hero', 5, 'foe');
    expect(result.shatter).toBe(Math.round(combatMaxHp(bear) * BALANCE.SHATTER_BURST_HP));
    expect(result.shatter).not.toBe(Math.round(bear.stats.maxHp * BALANCE.SHATTER_BURST_HP));
  });

  // The burst rides the one funnel, so everything already sitting on it applies
  it('goes through the barrier like any other damage', () => {
    setup({}, { activeEffects: [iced(), makeEffect(AuraType.Barrier, { magnitude: 500 })] });
    const result = useCombatStore.getState().damageUnit('foe', 10, 'hero');

    expect(result.hpLost).toBe(0);
    expect(result.absorbed).toBeGreaterThan(10);
  });
});

describe('an iced-over board is a fight, not a loss', () => {
  it('is ongoing when every living unit is frozen', () => {
    setup({ activeEffects: [iced()] }, { activeEffects: [iced()] });
    const units = useCombatStore.getState().units;

    expect(combatOutcome(units)).toBe('ongoing');
    expect(isDeadlocked(units)).toBe(false);
    expect(beginTurn('hero', SILENT_SINK).kind).toBe('frozen');
  });
});

describe('what landed is what is announced', () => {
  /**
   * The bug: `applyEffect` upgrades a Chill on an already-chilled unit into a
   * Freeze, and `announceStatus` asked the store whether the *Chill* it
   * requested was there. It was not — it had become the Freeze nobody asked
   * about — so neither float ever appeared, which is why "frozen" was never once
   * shown in combat.
   */
  it('announces Frozen when a second Chill upgrades', () => {
    setup({}, { activeEffects: [makeEffect(AfflictionType.Chill, { duration: 3 })] });

    const announced: string[] = [];
    applySkillStatus(
      unitNow('hero'),
      'foe',
      { type: AfflictionType.Chill, magnitude: 2, duration: 3, sourceUnitId: 'hero' },
      { log: () => {}, status: (_at, label) => announced.push(label) },
    );

    expect(announced).toEqual([statusName(AfflictionType.Freeze)]);
    expect(frozen('foe')?.duration).toBe(BALANCE.FREEZE_DURATION);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Chill)).toBe(false);
  });

  it('still announces the plain status when nothing was substituted', () => {
    setup();

    const announced: string[] = [];
    applySkillStatus(
      unitNow('hero'),
      'foe',
      { type: AfflictionType.Chill, magnitude: 2, duration: 3, sourceUnitId: 'hero' },
      { log: () => {}, status: (_at, label) => announced.push(label) },
    );

    expect(announced).toEqual([statusName(AfflictionType.Chill)]);
  });

  // The guard the announcement rests on is still the one it was written for
  it('says nothing when the target shrugged the affliction off', () => {
    setup({}, {
      activeEffects: [makeEffect(AuraType.DebuffImmunity, { duration: 3 })],
    });

    const announced: string[] = [];
    applySkillStatus(
      unitNow('hero'),
      'foe',
      { type: AfflictionType.Chill, magnitude: 2, duration: 3, sourceUnitId: 'hero' },
      { log: () => {}, status: (_at, label) => announced.push(label) },
    );

    expect(announced).toEqual([]);
  });
});

describe('the ice is seen breaking', () => {
  it('bursts the shatter on the struck unit, as the blow lands, and is heard as ice', () => {
    setup({}, { activeEffects: [iced()] });
    const before = unitNow('foe');
    const result = useCombatStore.getState().damageUnit('foe', 10, 'hero');
    const pictures: VfxSpec[] = [];
    const sounds: SoundIntent[] = [];
    const texts: string[] = [];
    applyOnHitStatuses(unitNow('hero'), before, result.hpLost, {
      log: () => {},
      impactVfx: (spec) => pictures.push(spec),
      sound: (intent) => sounds.push(intent),
      status: (_at, label) => texts.push(label),
    });
    expect(texts.some((t) => t.startsWith('SHATTER'))).toBe(true);
    expect(pictures).toContainEqual(expect.objectContaining({
      kind: 'shatter', color: SHATTER_COLOR, aftermath: 'rime', hitCoords: [before.position], hitUnitIds: [],
    }));
    expect(sounds).toContainEqual(expect.objectContaining({ kind: 'strike', unitId: 'foe', family: 'frost' }));
  });

  it('draws nothing when the struck unit was not frozen', () => {
    setup();
    const before = unitNow('foe');
    const result = useCombatStore.getState().damageUnit('foe', 10, 'hero');
    const pictures: VfxSpec[] = [];
    applyOnHitStatuses(unitNow('hero'), before, result.hpLost, { log: () => {}, impactVfx: (spec) => pictures.push(spec) });
    expect(pictures).toEqual([]);
  });

  it('thaws visibly on the tick the Freeze runs out, and only then', () => {
    setup({}, { activeEffects: [iced(2)] });
    const thaws = () => useCombatStore.getState().tickEffectsOnUnit('foe').filter((e) => e.text === 'thaws');
    expect(thaws()).toEqual([]);
    const [last] = thaws();
    expect(last.vfx).toMatchObject({ kind: 'shatter', color: THAW_COLOR, hitCoords: [unitNow('foe').position] });
    expect(frozen('foe')).toBeUndefined();
  });
});
