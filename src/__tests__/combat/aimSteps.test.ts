import { AfflictionType, AuraType, SkillTargetType } from '@/models/types';
import {
  AimBoard, AimEffect, aimFootprint, aimsAtCasterOnly, aimStep, castsOnPress, footprintSides, IDLE_AIM, targetHexSides, tauntBars, tauntRefusal,
} from '@/systems/combat/aimSteps';
import { shadowstep } from '@/data/skills/masterySkills';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { hexKey } from '@/utils/hexUtils';
import { at, makeFoe, makeSkill, makeUnit } from '../support/fixtures';

const keys = (hexes: { q: number; r: number }[]) => hexes.map(hexKey).sort();

describe('skills cast by their button (0 taps)', () => {
  const me = makeUnit({ id: 'me', position: at(0, 0) });
  const foe = makeFoe({ id: 'foe', position: at(1, 0) });

  it('a Self skill casts on press', () => {
    const ward = makeSkill({ targetType: SkillTargetType.Self, range: 0, appliesEffect: [{ type: AuraType.Barrier, magnitude: 5, duration: 2 }] });
    expect(aimsAtCasterOnly(ward)).toBe(true);
    expect(castsOnPress(ward, me, getValidSkillTargetHexes(ward, me, [me, foe]))).toBe(true);
  });

  it('a self-centred ring casts on press while it reaches an enemy, and offers nothing otherwise', () => {
    const whirl = makeSkill({ targetType: SkillTargetType.Ring, range: 0, aoeRadius: 1, damage: 1 });
    expect(castsOnPress(whirl, me, getValidSkillTargetHexes(whirl, me, [me, foe]))).toBe(true);
    const far = makeFoe({ id: 'far', position: at(3, 0) });
    expect(getValidSkillTargetHexes(whirl, me, [me, far])).toEqual([]);
    expect(castsOnPress(whirl, me, [])).toBe(false);
  });

  it('an arena-wide skill casts on press', () => {
    const quake = makeSkill({ targetType: SkillTargetType.Ring, range: 9, arenaWide: true, damage: 1 });
    expect(castsOnPress(quake, me, getValidSkillTargetHexes(quake, me, [me, foe]))).toBe(true);
  });

  it('a heal a lone hero can only aim at itself still waits for the tap', () => {
    const heal = makeSkill({ targetType: SkillTargetType.Single, range: 3, healing: 1 });
    expect(castsOnPress(heal, me, [me.position])).toBe(false);
  });
});

describe('areas aimed at a hex (2 taps)', () => {
  const me = makeUnit({ id: 'me', position: at(0, 0) });
  const foe = makeFoe({ id: 'foe', position: at(2, 0) });

  it('a ring aimed away from the caster previews its whole radius', () => {
    const fireball = makeSkill({ targetType: SkillTargetType.Ring, range: 3, aoeRadius: 1, damage: 1 });
    expect(aimFootprint(fireball, me, at(2, 0), [me, foe])).toHaveLength(7);
  });

  it('a line and a wedge preview more than the aimed hex', () => {
    const line = makeSkill({ targetType: SkillTargetType.Line, range: 3, damage: 1 });
    expect(aimFootprint(line, me, at(3, 0), [me])!.length).toBeGreaterThan(1);
    const arc = makeSkill({ targetType: SkillTargetType.Arc, range: 1, aoeRadius: 2, damage: 1 });
    expect(aimFootprint(arc, me, at(1, 0), [me])).toHaveLength(8);
  });

  it('single targets, self skills and random strikes take one tap', () => {
    expect(aimFootprint(makeSkill({ damage: 1 }), me, at(1, 0), [me, foe])).toBeNull();
    // Lay on Hands covers the caster too, but it is still aimed at one ally
    expect(aimFootprint(makeSkill({ healing: 1, healsCaster: true, range: 3 }), me, at(1, 0), [me])).toBeNull();
    expect(aimFootprint(makeSkill({ targetType: SkillTargetType.Self, aoeRadius: 1 }), me, at(0, 0), [me])).toBeNull();
    expect(aimFootprint(makeSkill({ targetType: SkillTargetType.Ring, range: 9, randomEnemies: 3, damage: 1 }), me, at(2, 0), [me, foe])).toBeNull();
  });

  it('a one-hex footprint is a single target and casts on the first tap', () => {
    const point = makeSkill({ targetType: SkillTargetType.Ring, range: 3, aoeRadius: 0, damage: 1 });
    expect(aimFootprint(point, me, at(2, 0), [me, foe])).toBeNull();
  });
});

describe('footprint colours', () => {
  const me = makeUnit({ id: 'me', position: at(0, 0) });
  const ally = makeUnit({ id: 'ally', position: at(2, 0) });
  const foe = makeFoe({ id: 'foe', position: at(3, 0) });
  const units = [me, ally, foe];
  const area = [at(2, 0), at(3, 0), at(2, 1)];

  it('an attack paints enemies red and passes over allies', () => {
    const blast = makeSkill({ targetType: SkillTargetType.Ring, range: 3, aoeRadius: 1, damage: 1 });
    const sides = footprintSides(blast, me, area, units);
    expect(keys(sides.attack)).toEqual(keys([at(3, 0)]));
    expect(sides.support).toEqual([]);
    expect(keys(sides.area)).toEqual(keys([at(2, 0), at(2, 1)]));
  });

  it('a blessing paints allies green and passes over enemies', () => {
    const bless = makeSkill({ targetType: SkillTargetType.Ring, range: 3, aoeRadius: 1, healing: 1 });
    const sides = footprintSides(bless, me, area, units);
    expect(keys(sides.support)).toEqual(keys([at(2, 0)]));
    expect(sides.attack).toEqual([]);
    expect(keys(sides.area)).toEqual(keys([at(3, 0), at(2, 1)]));
  });

  it('a mixed spell paints each side its own colour', () => {
    const thorn = makeSkill({
      targetType: SkillTargetType.Ring, range: 3, aoeRadius: 1,
      appliesEffect: [{ type: AuraType.HealOverTime, magnitude: 2, duration: 2 }, { type: AfflictionType.Root, magnitude: 1, duration: 2 }],
    });
    const sides = footprintSides(thorn, me, area, units);
    expect(keys(sides.attack)).toEqual(keys([at(3, 0)]));
    expect(keys(sides.support)).toEqual(keys([at(2, 0)]));
    expect(keys(sides.area)).toEqual(keys([at(2, 1)]));
  });
});

// ─── aimStep: the sequence, with no React ─────────────────────────────────────

describe('aimStep', () => {
  const me = makeUnit({ id: 'me', position: at(0, 0) });
  const foe = makeFoe({ id: 'foe', position: at(2, 0) });
  const other = makeFoe({ id: 'other', position: at(0, 2) });
  const single = makeSkill({ id: 'bolt' as never, targetType: SkillTargetType.Single, range: 3, damage: 5 });
  const area = makeSkill({ id: 'burst' as never, targetType: SkillTargetType.Ring, range: 4, aoeRadius: 1, damage: 5 });

  const board = (over: Partial<AimBoard> = {}): AimBoard => ({
    current: me, units: [me, foe, other], hazards: [], highlights: [], skill: null, ...over,
  });
  const lit = (skill: typeof single, units = [me, foe, other]) => getValidSkillTargetHexes(skill, me, units);
  const kinds = (effects: AimEffect[]) => effects.map((e) => e.kind);
  const toasts = (effects: AimEffect[]) => effects.flatMap((e) => (e.kind === 'toast' ? [e.text] : []));

  describe('pressing a skill', () => {
    it('lights the targets and moves to targeting', () => {
      const { effects, state } = aimStep(IDLE_AIM, { type: 'press', skill: single }, board());
      expect(kinds(effects)).toEqual(['select', 'highlight', 'phase']);
      expect(state).toEqual(IDLE_AIM);
    });

    it('casts at once a skill that can only be aimed at its caster', () => {
      const ward = makeSkill({ targetType: SkillTargetType.Self, range: 0, appliesEffect: [{ type: AuraType.Barrier, magnitude: 5, duration: 2 }] });
      const { effects } = aimStep(IDLE_AIM, { type: 'press', skill: ward }, board());
      expect(effects).toEqual([
        { kind: 'select', skill: ward, mode: undefined },
        { kind: 'cast', skill: ward, at: me.position, pressed: true },
      ]);
    });

    it('fires an Aimed Shot release at its one named target on the press (PT-14)', () => {
      const aimer = makeUnit({ id: 'me', position: at(0, 0), activeEffects: [{ type: AuraType.Aiming, magnitude: 1, duration: 1, aimAt: 'foe' }] });
      const release = makeSkill({
        id: 'aimed_shot' as never, targetType: SkillTargetType.Single, range: 4, damage: 9, releasing: true,
        charge: { aimed: true, release: { damage: 9 } } as never,
      });
      const { effects } = aimStep(IDLE_AIM, { type: 'press', skill: release }, board({ current: aimer, units: [aimer, foe, other] }));
      expect(effects).toEqual([
        { kind: 'select', skill: release, mode: undefined },
        { kind: 'cast', skill: release, at: foe.position, pressed: true },
      ]);
    });

    it("fires Marked Prey's release at the marked prey on the press (PT-14)", () => {
      const marker = makeUnit({ id: 'me', position: at(0, 0), activeEffects: [{ type: AuraType.MarkedPrey, magnitude: 0, duration: 1, aimAt: 'other' }] });
      const release = makeSkill({ id: 'marked_prey' as never, targetType: SkillTargetType.Single, range: 4, damage: 5, mantisStage: 'release' });
      const { effects } = aimStep(IDLE_AIM, { type: 'press', skill: release }, board({ current: marker, units: [marker, foe, other] }));
      expect(effects[effects.length - 1]).toEqual({ kind: 'cast', skill: release, at: other.position, pressed: true });
    });

    it('says why, drops the selection and blinks the reach when nothing is in range', () => {
      const { effects } = aimStep(IDLE_AIM, { type: 'press', skill: single }, board({ units: [me] }));
      expect(toasts(effects)).toHaveLength(1);
      expect(effects[effects.length - 1]).toEqual({ kind: 'select', skill: null });
    });
  });

  describe('a Taunt', () => {
    const taunted = makeUnit({
      id: 'me', position: at(0, 0),
      activeEffects: [{ type: AfflictionType.Taunt, magnitude: 1, duration: 2, sourceUnitId: 'foe' }],
    });
    const tb = (over: Partial<AimBoard> = {}) => board({ current: taunted, units: [taunted, foe, other], ...over });

    it('refuses an area skill at the press, naming the taunter', () => {
      const { effects } = aimStep(IDLE_AIM, { type: 'press', skill: area }, tb());
      expect(toasts(effects)).toEqual([tauntRefusal('area', taunted, foe).text]);
      expect(effects.some((e) => e.kind === 'log' && e.tone === 'taunt')).toBe(true);
      expect(effects[effects.length - 1]).toEqual({ kind: 'select', skill: null });
    });

    it('lights only the taunter for a single-target press, and refuses one that is out of reach', () => {
      const reach = aimStep(IDLE_AIM, { type: 'press', skill: single }, tb());
      expect(reach.effects).toContainEqual({ kind: 'highlight', hexes: [foe.position] });
      const far = makeFoe({ id: 'foe', position: at(6, 0) });
      const miss = aimStep(IDLE_AIM, { type: 'press', skill: single }, tb({ units: [taunted, far] }));
      expect(toasts(miss.effects)).toEqual([tauntRefusal('out-of-reach', taunted, far).text]);
    });

    it('refuses a tap on anybody but the taunter, with the one message the press shares', () => {
      const { effects } = aimStep(IDLE_AIM, { type: 'tap', coord: other.position }, tb({ skill: single, highlights: lit(single) }));
      expect(toasts(effects)).toEqual([tauntRefusal('wrong-target', taunted, foe).text]);
      expect(effects.some((e) => e.kind === 'log' && e.tone === 'taunt')).toBe(true);
      const ok = aimStep(IDLE_AIM, { type: 'tap', coord: foe.position }, tb({ skill: single, highlights: [foe.position] }));
      expect(kinds(ok.effects)).toEqual(['cast']);
    });

    // PT-02: the skill bar dims what the press would refuse, from the same rule
    it('bars a self-buff and an attack out of reach, allows one in reach, and nothing once the taunter falls', () => {
      const ward = makeSkill({ targetType: SkillTargetType.Self, range: 0, appliesEffect: [{ type: AuraType.Barrier, magnitude: 5, duration: 2 }] });
      expect(tauntBars(ward, taunted, [taunted, foe, other], [])).toEqual({ why: 'out-of-reach', taunter: foe });
      expect(tauntBars(area, taunted, [taunted, foe, other], [])).toEqual({ why: 'area', taunter: foe });
      expect(tauntBars(single, taunted, [taunted, foe, other], [])).toBeNull();
      const far = makeFoe({ id: 'foe', position: at(6, 0) });
      expect(tauntBars(single, taunted, [taunted, far], [])).toEqual({ why: 'out-of-reach', taunter: far });
      const dead = makeFoe({ id: 'foe', position: at(6, 0), currentHp: 0 });
      expect(tauntBars(single, taunted, [taunted, dead], [])).toBeNull();
      expect(tauntBars(area, taunted, [taunted, dead], [])).toBeNull();
    });

    it('says the hero is taunted when it refuses a skill out of reach', () => {
      expect(tauntRefusal('out-of-reach', taunted, foe).text).toMatch(/taunt/i);
    });

    it('drops a taunt whose taunter has fallen, on the press and on the tap', () => {
      const dead = makeFoe({ id: 'foe', position: at(2, 0), currentHp: 0 });
      const press = aimStep(IDLE_AIM, { type: 'press', skill: single }, tb({ units: [taunted, dead, other] }));
      expect(press.effects).toContainEqual({ kind: 'removeTaunt', unitId: 'me' });
      const tapped = aimStep(IDLE_AIM, { type: 'tap', coord: other.position }, tb({ units: [taunted, dead, other], skill: single, highlights: [other.position] }));
      expect(tapped.effects).toContainEqual({ kind: 'removeTaunt', unitId: 'me' });
    });
  });

  describe('an area (two taps)', () => {
    const b = () => board({ skill: area, highlights: lit(area) });

    it('shows the footprint on the first tap, moves the aim on another hex, and casts on the same hex again', () => {
      const first = aimStep(IDLE_AIM, { type: 'tap', coord: foe.position }, b());
      expect(first.state.aimCentre).toEqual(foe.position);
      expect(first.effects).toEqual([]);

      const moved = aimStep(first.state, { type: 'tap', coord: other.position }, b());
      expect(moved.state.aimCentre).toEqual(other.position);
      expect(moved.effects).toEqual([]);

      const cast = aimStep(moved.state, { type: 'tap', coord: other.position }, b());
      expect(cast.effects).toEqual([{ kind: 'cast', skill: area, at: other.position }]);
      expect(cast.state).toEqual(IDLE_AIM);
    });

    it('calls a tap on an unlit hex an invalid target', () => {
      const { effects } = aimStep(IDLE_AIM, { type: 'tap', coord: at(-3, 3) }, b());
      expect(toasts(effects)).toEqual(['Invalid target']);
    });
  });

  describe('the rampart (three taps)', () => {
    const rampart = makeSkill({ id: 'rampart' as never, targetType: SkillTargetType.Single, range: 4, places: { kind: 'rampart' } } as never);
    const rb = () => board({ skill: rampart, units: [me], highlights: getValidSkillTargetHexes(rampart, me, [me]) });

    it('takes an anchor, then the rock beside it, then the same rock again to raise the pair', () => {
      const anchor = at(2, 0);
      const neighbor = at(2, 1);
      const one = aimStep(IDLE_AIM, { type: 'tap', coord: anchor }, rb());
      expect(one.state.rampart).toEqual({ anchor, neighbor: null });
      expect(kinds(one.effects)).toEqual(['highlight', 'toast']);

      const two = aimStep(one.state, { type: 'tap', coord: neighbor }, rb());
      expect(two.state.rampart).toEqual({ anchor, neighbor });
      expect(kinds(two.effects)).toEqual(['toast']);

      const three = aimStep(two.state, { type: 'tap', coord: neighbor }, rb());
      expect(three.effects).toEqual([{ kind: 'cast', skill: rampart, at: anchor, neighbor }]);
    });

    it('clears the anchor when the second tap is not beside it', () => {
      const one = aimStep(IDLE_AIM, { type: 'tap', coord: at(2, 0) }, rb());
      const far = aimStep(one.state, { type: 'tap', coord: at(-2, 0) }, rb());
      expect(far.state.rampart).toEqual({ anchor: null, neighbor: null });
      expect(toasts(far.effects)).toEqual(['Anchor cleared. Choose a new anchor']);
    });

    it('will not take an anchor on an unlit hex', () => {
      const { effects, state } = aimStep(IDLE_AIM, { type: 'tap', coord: at(-4, 0) }, rb());
      expect(state.rampart.anchor).toBeNull();
      expect(toasts(effects)).toEqual(['Choose a free anchor with room for its neighbor']);
    });
  });

  it('backs out of aiming from anywhere, clearing the aim', () => {
    const { state, effects } = aimStep(
      { aimCentre: at(1, 1), rampart: { anchor: at(2, 0), neighbor: null } }, { type: 'cancel' }, board(),
    );
    expect(state).toEqual(IDLE_AIM);
    expect(effects).toEqual([{ kind: 'highlight', hexes: [] }, { kind: 'select', skill: null }, { kind: 'phase', phase: 'select' }]);
  });
});

describe('target hexes split by colour', () => {
  const me = makeUnit({ id: 'me', position: at(0, 0) });
  const friend = makeUnit({ id: 'friend', position: at(0, 2) });
  const foe = makeFoe({ id: 'foe', position: at(3, 0) });
  const units = [me, friend, foe];

  it('paints the enemies Shadowstep would stab red and its open ground green (PT-09)', () => {
    const lit = getValidSkillTargetHexes(shadowstep, me, units);
    expect(keys(lit)).toContain(hexKey(foe.position));
    const sides = targetHexSides(shadowstep, me, lit, units);
    expect(keys(sides.attack)).toEqual([hexKey(foe.position)]);
    expect(keys(sides.support)).toEqual(keys(lit.filter((h) => hexKey(h) !== hexKey(foe.position))));
  });

  it('keeps a plain strike red, a heal green and a mixed spell split by side', () => {
    const hexes = [friend.position, foe.position, at(2, 0)];
    const strike = makeSkill({ targetType: SkillTargetType.Single, range: 4, damage: 1 });
    expect(targetHexSides(strike, me, hexes, units).support).toEqual([]);
    const heal = makeSkill({ targetType: SkillTargetType.Single, range: 4, healing: 1 });
    expect(targetHexSides(heal, me, hexes, units).attack).toEqual([]);
    const thorn = makeSkill({
      targetType: SkillTargetType.Ring, range: 4, aoeRadius: 1,
      appliesEffect: [{ type: AuraType.HealOverTime, magnitude: 2, duration: 2 }, { type: AfflictionType.Root, magnitude: 1, duration: 2 }],
    });
    const sides = targetHexSides(thorn, me, hexes, units);
    expect(keys(sides.support)).toEqual([hexKey(friend.position)]);
    expect(keys(sides.attack)).toEqual(keys([foe.position, at(2, 0)]));
  });
});
