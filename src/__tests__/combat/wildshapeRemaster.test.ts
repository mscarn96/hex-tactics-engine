import { skillDescription } from '@/data/gameText';
import { spyDice } from '../support/dice';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK, shapeSkillIds } from '@/systems/combat/skillResolution';
import { arcHexes } from '@/systems/combat/arenaGeometry';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { requireUnit } from '@/systems/combat/unitLookup';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { skillBlockedReason } from '@/systems/combat/skillAvailability';
import { skillsForForm } from '@/systems/combat/wildshape';
import { setTempoRandom, extraTurnCause } from '@/systems/combat/turnTempo';
import { beginTurn } from '@/systems/combat/turnStart';
import { findMasteryPath } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import { WILD_FORMS } from '@/data/templates/wildForms';
import {
  ancestralHunt, antlerCharge, apexForm, bloodHowl, crownedPrey, crushingLeap, cyclone, dive, hawkShear,
  huntersMark, primalSurge, primalWrath, rendingCircle, slipTheNet, talons, wolfForm, rip,
} from '@/data/skills/masterySkills';
import { AfflictionType, AuraType, CombatUnit, HeroSkill, HeroStats, WildFormId } from '@/models/types';
import { nodeSimpleText, skillSimpleText } from '@/data/display/simpleText';
import { findSkill } from '@/systems/progression/mastery';
import { at, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { hexDistance } from '@/utils/hexUtils';
import { resolveVfxKind } from '@/systems/combat/vfxResolve';

/**
 * The Wildshape remaster, as rules: the replaced nodes, Hunter's Mark, the Dive's
 * flight, Wind Shear's cone, Crushing Leap, Blood Howl's bounded crit turns, Slip
 * the Net, Rending Circle, the form-usable capstones and the three-turn Apex.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 200, attack: 30, magic: 10, defense: 0, magicDefense: 0, maxMana: 500,
    critChance: 0, dodgeChance: 0, speed: 10, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const effect = (id: string, type: AuraType | AfflictionType) => unitNow(id).activeEffects.find((e) => e.type === type);

const KIT: HeroSkill[] = [wolfForm, apexForm, bloodHowl, slipTheNet, rendingCircle, huntersMark, crushingLeap, primalSurge, ancestralHunt];

const druid = (form: WildFormId | null = null, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'druid', position: at(0, 0), stats: stats(), wildForm: form,
    humanSkills: KIT, skills: skillsForForm(form, KIT, undefined), ...over,
  });
const foe = (id: string, q: number, r: number, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: stats({ maxHp: 5000 }), ...over });
const cast = (skill: HeroSkill, q: number, r: number, caster = 'druid') =>
  resolveSkillUse(unitNow(caster), skill, at(q, r), SILENT_SINK);
const lost = (id: string) => unitNow(id).stats.maxHp - unitNow(id).currentHp;

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
  spyDice().mockReturnValue(0.5);
});
afterEach(() => jest.restoreAllMocks());

// ─── The tree ─────────────────────────────────────────────────────────────────

describe('the Wildshape tree', () => {
  const path = findMasteryPath('wildshape')!;
  const ids = path.nodes.map((n) => n.id);

  it('replaces the six retired nodes with the selected ones', () => {
    for (const gone of ['wild_bear_grapple', 'wild_wolf_hamstring', 'wild_wolf_takedown', 'wild_hawk_skyward', 'wild_feral_heart', 'wild_primal_bond']) {
      expect(ids).not.toContain(gone);
    }
    const grants = Object.fromEntries(path.nodes.map((n) => [n.id, n.grantsSkill]));
    expect(grants).toMatchObject({
      wild_bear_leap: 'crushing_leap', wild_wolf_slip: 'slip_the_net', wild_wolf_rending: 'rending_circle',
      wild_hawk_mark: 'hunters_mark', wild_primal_surge: 'primal_surge', wild_ancestral_hunt: 'ancestral_hunt',
    });
  });

  it('keeps the three capstones mutually exclusive', () => {
    const capstones = path.nodes.filter((n) => n.exclusiveGroup === 'capstone').map((n) => n.id).sort();
    expect(capstones).toEqual(['wild_ancestral_hunt', 'wild_apex', 'wild_primal_surge']);
  });

  it('gives Apex Crowned Prey in place of Antler Strike', () => {
    expect(WILD_FORMS.apex.skills).toEqual(['crowned_prey', 'antler_charge', 'primal_wrath']);
  });
});

// ─── Hawk ─────────────────────────────────────────────────────────────────────

describe("Hunter's Mark", () => {
  const hawk = () => druid('hawk', { skills: [talons, huntersMark, dive] });

  it('marks on a landed hit with two charges, and only the marking Hawk\'s Hawk attacks spend them', () => {
    useCombatStore.setState({ units: [hawk(), foe('a', 2, 0), foe('b', 0, 2)] });
    cast(huntersMark, 2, 0);
    expect(effect('a', AfflictionType.HuntersMark)).toMatchObject({ stacks: 2, sourceUnitId: 'druid' });

    // The same Talons, marked and unmarked: the marked one is 40% stronger
    const beforeA = lost('a');
    cast(talons, 2, 0);
    cast(talons, 0, 2);
    expect(lost('a') - beforeA).toBeCloseTo(lost('b') * 1.4, -1);
    expect(effect('a', AfflictionType.HuntersMark)?.stacks).toBe(1);
    cast(talons, 2, 0);
    expect(effect('a', AfflictionType.HuntersMark)).toBeUndefined();
  });

  it('is not spent by another unit or by a dodge', () => {
    const ally = makeUnit({ id: 'ally', position: at(1, 0), stats: stats(), skills: [rip] });
    useCombatStore.setState({ units: [hawk(), ally, foe('a', 2, 0)] });
    cast(huntersMark, 2, 0);
    cast(rip, 2, 0, 'ally');
    expect(effect('a', AfflictionType.HuntersMark)?.stacks).toBe(2);
    useCombatStore.setState({ units: state().units.map((u) => u.id === 'a' ? { ...u, stats: { ...u.stats, dodgeChance: 100 } } : u) });
    cast(talons, 2, 0);
    expect(effect('a', AfflictionType.HuntersMark)?.stacks).toBe(2);
  });
});

describe('the Hawk kit', () => {
  it('draws Dive as one flight over its victim to the retreat hex', () => {
    useCombatStore.setState({ units: [druid('hawk', { skills: [dive] }), foe('a', 3, 0)] });
    cast(dive, 3, 0);
    const hawk = unitNow('druid');
    expect(hawk.movement).toMatchObject({ mode: 'swoop', from: at(0, 0), via: at(3, 0) });
    expect(hawk.position).not.toEqual(at(0, 0));
  });

  it('lands Dive two hexes from its victim, on the near side (playtest 2026-10-14)', () => {
    useCombatStore.setState({ units: [druid('hawk', { skills: [dive] }), foe('a', 4, 0)] });
    cast(dive, 4, 0);
    const hawk = unitNow('druid');
    expect(hexDistance(hawk.position, at(4, 0))).toBe(2);
    expect(hexDistance(hawk.position, at(0, 0))).toBe(2);
  });

  it('stays put when Dive is made from Talons range already', () => {
    useCombatStore.setState({ units: [druid('hawk', { skills: [dive] }), foe('a', 2, 0)] });
    cast(dive, 2, 0);
    expect(unitNow('druid').position).toEqual(at(0, 0));
  });

  it('draws Talons as claw rakes on the victim, not a flying bolt (playtest 2026-10-14)', () => {
    expect(resolveVfxKind(talons)).toBe('slash');
  });

  it('gives Cyclone no Root', () => {
    expect([cyclone.appliesEffect].flat().filter(Boolean)).toEqual([]);
  });

  it('hits and pushes Wind Shear\'s whole depth-3 cone, away from the Hawk', () => {
    expect(arcHexes(hawkShear, at(0, 0), at(1, 0))).toHaveLength(15);
    useCombatStore.setState({ units: [druid('hawk', { skills: [hawkShear] }), foe('near', 1, 0), foe('far', 3, 0)] });
    cast(hawkShear, 1, 0);
    expect(lost('near')).toBeGreaterThan(0);
    expect(lost('far')).toBeGreaterThan(0);
    expect(unitNow('near').position).toEqual(at(2, 0));
  });
});

// ─── Bear and Wolf ────────────────────────────────────────────────────────────

describe('Crushing Leap', () => {
  it('leaps up to two hexes, as a jump, then strikes and Stuns', () => {
    useCombatStore.setState({ units: [druid('bear', { skills: [crushingLeap] }), foe('a', 2, 0)] });
    cast(crushingLeap, 2, 0);
    expect(unitNow('druid').position).toEqual(at(1, 0));
    expect(unitNow('druid').movement?.mode).toBe('jump');
    expect(effect('a', AfflictionType.Stun)).toBeDefined();
  });
});

describe('Blood Howl', () => {
  const wolfUnits = (n: number, over: Partial<CombatUnit> = {}) => {
    const spots = [[1, 0], [0, 1], [-1, 1], [-1, 0]].slice(0, n);
    useCombatStore.setState({
      units: [druid('wolf', { stats: stats({ critChance: 100 }), ...over }), ...spots.map(([q, r], i) => foe(`f${i}`, q, r))],
      turnOrder: ['druid', ...spots.map((_, i) => `f${i}`)],
      currentUnitId: 'druid',
    });
  };

  it('raises Attack and Critical Chance only while the Druid is a Wolf', () => {
    useCombatStore.setState({ units: [druid('wolf')] });
    const before = getCombatEffectiveStats(unitNow('druid'));
    cast(bloodHowl, 0, 0);
    const after = getCombatEffectiveStats(unitNow('druid'));
    expect(after.attack).toBeGreaterThan(before.attack);
    expect(after.critChance).toBe((before.critChance ?? 0) + BALANCE.BLOOD_HOWL_CRIT);
    state().setWildForm('druid', null);
    expect(effect('druid', AuraType.BloodHowl)).toBeUndefined();
  });

  it('queues one turn per critical hit, never more than the cap between regular turns', () => {
    wolfUnits(4);
    cast(bloodHowl, 0, 0);
    cast(rendingCircle, 0, 0);
    // Four critical hits, three turns
    expect(unitNow('druid').howlQueued).toBe(BALANCE.BLOOD_HOWL_TURN_CAP);

    for (let i = 1; i <= BALANCE.BLOOD_HOWL_TURN_CAP; i++) {
      state().nextTurn();
      expect(state().currentUnitId).toBe('druid');
      expect(extraTurnCause(state())).toBe('bloodHowl');
      expect(unitNow('druid').howlGranted).toBe(i);
      // A critical hit on a granted turn cannot refill the allowance
      useCombatStore.setState({ units: state().units.map((u) => u.id === 'druid' ? { ...u, cooldowns: {} } : u) });
      cast(rip, 1, 0);
      expect((unitNow('druid').howlQueued ?? 0) + (unitNow('druid').howlGranted ?? 0)).toBe(BALANCE.BLOOD_HOWL_TURN_CAP);
    }
    state().nextTurn();
    expect(state().currentUnitId).not.toBe('druid');
  });

  it('grants one extra turn at most: a critical hit on the granted turn earns nothing (playtest 2026-10-14)', () => {
    expect(BALANCE.BLOOD_HOWL_TURN_CAP).toBe(1);
    wolfUnits(1);
    cast(bloodHowl, 0, 0);
    cast(rip, 1, 0);
    expect(unitNow('druid').howlQueued).toBe(1);
    state().nextTurn();
    expect(state().currentUnitId).toBe('druid');
    useCombatStore.setState({ units: state().units.map((u) => u.id === 'druid' ? { ...u, cooldowns: {} } : u) });
    cast(rip, 1, 0);
    expect(unitNow('druid').howlQueued ?? 0).toBe(0);
    expect(unitNow('druid').howlGranted).toBe(1);
    state().nextTurn();
    expect(state().currentUnitId).not.toBe('druid');
  });

  it('refills only on the next regular Wolf turn', () => {
    wolfUnits(1);
    useCombatStore.setState({ units: state().units.map((u) => u.id === 'druid' ? { ...u, howlGranted: 3 } : u) });
    state().nextTurn();
    state().nextTurn();
    expect(state().currentUnitId).toBe('druid');
    expect(unitNow('druid').howlGranted).toBe(0);
  });

  it('throws queued turns away when the Druid leaves Wolf form', () => {
    wolfUnits(2);
    cast(bloodHowl, 0, 0);
    cast(rendingCircle, 0, 0);
    state().setWildForm('druid', null);
    state().nextTurn();
    expect(state().currentUnitId).toBe('f0');
  });
});

describe('Slip the Net', () => {
  it('is the one move a Rooted Wolf can make: Root and Chill come off, then the move and the Dodge', () => {
    const bound = [
      { type: AfflictionType.Root, magnitude: 1, duration: 2, sourceUnitId: 'x' },
      { type: AfflictionType.Chill, magnitude: 2, duration: 2, sourceUnitId: 'x' },
    ];
    useCombatStore.setState({ units: [druid('wolf', { activeEffects: bound })] });
    expect(skillBlockedReason(slipTheNet, unitNow('druid'))).toBeNull();
    const result = cast(slipTheNet, 2, 0);
    expect(result.ok).toBe(true);
    expect(unitNow('druid').position).toEqual(at(2, 0));
    expect(effect('druid', AfflictionType.Root)).toBeUndefined();
    expect(effect('druid', AfflictionType.Chill)).toBeUndefined();
    expect(getCombatEffectiveStats(unitNow('druid')).dodgeChance).toBe(30);
  });
});

describe('Rending Circle', () => {
  it('hits every adjacent enemy without moving them, harder below half health', () => {
    useCombatStore.setState({ units: [druid('wolf'), foe('full', 1, 0), foe('hurt', -1, 0, { currentHp: 2000 })] });
    cast(rendingCircle, 0, 0);
    expect(unitNow('full').position).toEqual(at(1, 0));
    expect(2000 - unitNow('hurt').currentHp).toBeCloseTo(lost('full') * 1.5, -1);
  });
});

// ─── The form-usable capstones ────────────────────────────────────────────────

describe('Primal Surge and Ancestral Hunt', () => {
  it('reach the bar in every shape, and only they of the upright kit', () => {
    for (const form of [null, 'bear', 'wolf', 'hawk'] as const) {
      const ids = skillsForForm(form, KIT, undefined).map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining(['primal_surge', 'ancestral_hunt']));
    }
  });

  it('Primal Surge cleanses, brings only the shapes\' skills forward, and does not spend the turn', () => {
    useCombatStore.setState({
      units: [druid('wolf', {
        activeEffects: [{ type: AfflictionType.Root, magnitude: 1, duration: 2, sourceUnitId: 'x' }],
        cooldowns: { rending_circle: 4, wolf_form: 3, ancestral_hunt: 5 },
      })],
    });
    const result = cast(primalSurge, 0, 0);
    expect(result.endsTurn).toBe(false);
    expect(effect('druid', AfflictionType.Root)).toBeUndefined();
    const cds = unitNow('druid').cooldowns!;
    expect(cds.rending_circle).toBe(2);
    expect(cds.wolf_form).toBe(3);
    expect(cds.ancestral_hunt).toBe(5);
    expect(cds.primal_surge).toBe(primalSurge.cooldown! + 1);
    expect(shapeSkillIds(unitNow('druid'))).not.toContain('wolf_form');
  });

  it('Ancestral Hunt strikes three times, weakens, heals and splashes', () => {
    useCombatStore.setState({
      units: [druid(null, { currentHp: 100 }), foe('prey', 2, 0), foe('beside', 3, 0), foe('away', -2, 0)],
    });
    const result = cast(ancestralHunt, 2, 0);
    expect(result.ok).toBe(true);
    expect(effect('prey', AfflictionType.AttackDown)).toBeDefined();
    expect(unitNow('druid').currentHp).toBeGreaterThan(100);
    expect(lost('beside')).toBeGreaterThan(0);
    expect(lost('away')).toBe(0);
    // Three strikes on the victim against one half strike beside it
    expect(lost('prey')).toBeGreaterThan(lost('beside') * 4);
  });
});

// ─── Apex ─────────────────────────────────────────────────────────────────────

describe('the Apex shape', () => {
  const units = () => {
    useCombatStore.setState({
      units: [druid('wolf'), foe('a', 1, 0), foe('b', 3, 3)],
      turnOrder: ['druid', 'b'],
      currentUnitId: 'druid',
    });
  };
  const round = () => {
    state().nextTurn();
    beginTurn(state().currentUnitId!, SILENT_SINK);
  };

  it('is entered without spending the turn, even from Wolf form, and starts no cooldown yet', () => {
    units();
    const result = cast(apexForm, 0, 0);
    expect(result.endsTurn).toBe(false);
    expect(unitNow('druid').wildForm).toBe('apex');
    expect(effect('druid', AuraType.Apex)?.duration).toBe(BALANCE.APEX_TURNS);
    expect(unitNow('druid').cooldowns?.apex_form).toBeUndefined();
  });

  it('allows each of its three spells once', () => {
    units();
    cast(apexForm, 0, 0);
    expect(canUseSkill(unitNow('druid'), crownedPrey)).toBe(true);
    cast(crownedPrey, 1, 0);
    expect(canUseSkill(unitNow('druid'), crownedPrey)).toBe(false);
    expect(skillBlockedReason(crownedPrey, unitNow('druid'))).toMatch(/Already used/);
    expect(canUseSkill(unitNow('druid'), antlerCharge)).toBe(true);
  });

  it('reverts at the end of its third regular turn and only then starts its long cooldown', () => {
    units();
    cast(apexForm, 0, 0);
    round(); // b
    round(); // druid, second turn
    expect(unitNow('druid').wildForm).toBe('apex');
    round(); // b
    round(); // druid, third turn
    expect(unitNow('druid').wildForm).toBe('apex');
    state().nextTurn();
    expect(unitNow('druid').wildForm).toBeNull();
    expect(unitNow('druid').cooldowns?.apex_form).toBe(BALANCE.APEX_COOLDOWN + 1);
  });

  it('reverts at the end of the turn its third spell is used', () => {
    units();
    cast(apexForm, 0, 0);
    useCombatStore.setState({ units: state().units.map((u) => u.id === 'druid' ? { ...u, apexSpent: ['crowned_prey', 'antler_charge'] } : u) });
    cast(primalWrath, 0, 0);
    state().nextTurn();
    expect(unitNow('druid').wildForm).toBeNull();
  });

  it('Crowned Prey leaves a crown the next two allied hits spend for extra magic damage', () => {
    const ally = makeUnit({ id: 'ally', position: at(2, -1), stats: stats(), skills: [rip] });
    useCombatStore.setState({ units: [druid('apex'), ally, foe('a', 1, 0), foe('twin', 2, 0)] });
    cast(crownedPrey, 1, 0);
    const crown = effect('a', AfflictionType.CrownedPrey)!;
    expect(crown.stacks).toBe(2);
    expect(crown.magnitude).toBe(Math.round(0.5 * getCombatEffectiveStats(unitNow('druid')).attack));
    const before = lost('a');
    cast(rip, 1, 0, 'ally');
    const crowned = lost('a') - before;
    cast(rip, 2, 0, 'ally');
    expect(crowned).toBeGreaterThan(lost('twin'));
    expect(effect('a', AfflictionType.CrownedPrey)?.stacks).toBe(1);
  });

  it('lands Primal Wrath on an area, not on every enemy (playtest 2026-10-14)', () => {
    expect(primalWrath.arenaWide).toBeUndefined();
    expect(primalWrath.aoeRadius).toBe(2);
    useCombatStore.setState({ units: [druid('apex'), foe('near', 3, 0), foe('edge', 3, 2), foe('far', -3, 3)] });
    cast(primalWrath, 3, 0);
    expect(lost('near')).toBeGreaterThan(0);
    expect(lost('edge')).toBeGreaterThan(0);
    expect(lost('far')).toBe(0);
  });
});

// ─── Simple copy ──────────────────────────────────────────────────────────────

describe('Wildshape Simple descriptions', () => {
  const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/).length;

  it('cover every node and every shape skill in one or two sentences', () => {
    for (const n of findMasteryPath('wildshape')!.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
    const innate = (['bear', 'wolf', 'hawk', 'apex'] as const).flatMap((f) => WILD_FORMS[f].skills);
    for (const id of innate) expect({ id, text: skillSimpleText(findSkill(id)!) }).toEqual({ id, text: expect.any(String) });
  });

  it('never claims Cyclone Roots, and scopes Blood Howl to the Wolf', () => {
    expect(skillSimpleText(cyclone)).not.toMatch(/root/i);
    expect(skillDescription(cyclone)).not.toMatch(/root/i);
    expect(skillSimpleText(bloodHowl)).toMatch(/Wolf form/);
    expect(skillSimpleText(bloodHowl)).toMatch(/extra turns/);
  });
});
