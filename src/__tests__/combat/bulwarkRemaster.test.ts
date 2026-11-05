import { spyDice } from '../support/dice';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { arcAimHex, arcHexes } from '@/systems/combat/arenaGeometry';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { requireUnit } from '@/systems/combat/unitLookup';
import { applyOnHitStatuses } from '@/systems/combat/combatEvents';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { reckoningBurst } from '@/systems/combat/statusEffects';
import { lastStandReduction, shieldedChallengeShare } from '@/systems/combat/passiveFormulas';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { provokingStrike, reckoning, shieldAvalanche } from '@/data/skills/masterySkills';
import { findMasteryNode, findMasteryPath } from '@/data/skills/masteryData';
import { nodeSkillAt } from '@/systems/progression/mastery';
import { skillEffectLines } from '@/data/display/skillDisplay';
import { hexDistance, hexKey, hexToPixel } from '@/utils/hexUtils';
import { AfflictionType, AuraType, CombatUnit, HeroStats, HexCoord, PassiveRank, VfxSpec } from '@/models/types';
import { at, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Bulwark remaster, as rules: the relocated tree, Shielded Challenge, Last
 * Stand's total damage reduction, Shield Avalanche and Reckoning. Numbers come
 * from the definitions; what is pinned is the shape.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 200, attack: 20, magic: 0, defense: 0, magicDefense: 0, maxMana: 200,
    critChance: 0, dodgeChance: 0, speed: 10, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const effectOn = (id: string, type: AuraType | AfflictionType) =>
  unitNow(id).activeEffects.find((e) => e.type === type);
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));

const bulwark = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'tank', position: at(0, 0), stats: stats(), currentMana: 200, ...over });
const foe = (id: string, position = at(1, 0), over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position, stats: stats({ maxHp: 1000 }), ...over });
const bossTemplate = enemyTemplates.find((t) => t.tier === 'boss')!;

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
});

afterEach(() => jest.restoreAllMocks());

// ─── The tree ─────────────────────────────────────────────────────────────────

describe('the remastered Bulwark tree', () => {
  const path = findMasteryPath('bulwark')!;
  const node = (id: string) => path.nodes.find((n) => n.id === id);

  it('puts the Signature node in the centre of the first row and Spite at its old edge', () => {
    expect(node('bulwark_shielded_challenge')).toMatchObject({ tier: 1, column: 2, grantsPassive: 'shieldedChallenge' });
    expect(node('bulwark_spite')).toMatchObject({ tier: 1, column: 0, grantsPassive: 'intimidating' });
  });

  it('offers Unbreakable Vow, Shield Avalanche and Reckoning as the ultimates', () => {
    const capstones = path.nodes.filter((n) => n.exclusiveGroup === 'capstone').map((n) => n.grantsSkill);
    expect(capstones.sort()).toEqual(['reckoning', 'shield_avalanche', 'unbreakable_vow']);
  });

  it('opens the side trees on Last Stand and Vengeance, both with three ranks, and moves Loud under Last Stand', () => {
    expect(node('bulwark_last_stand')).toMatchObject({ tier: 1, column: 7, sideTree: 'a', exclusiveGroup: 'side' });
    expect(node('bulwark_vengeance')).toMatchObject({ tier: 1, column: 10, sideTree: 'b', exclusiveGroup: 'side' });
    expect(node('bulwark_last_stand')!.maxLevel).toBeUndefined();
    expect(node('bulwark_vengeance')!.maxLevel).toBeUndefined();
    expect(node('bulwark_loud')).toMatchObject({ sideTree: 'a', requires: ['bulwark_last_stand'], maxLevel: 1 });
  });

  it('removes Iron Frame, Immovable and Set Stance', () => {
    for (const id of ['bulwark_iron_frame', 'bulwark_immovable', 'bulwark_set_stance']) {
      expect(findMasteryNode(id)).toBeUndefined();
    }
  });
});

// ─── Shielded Challenge ───────────────────────────────────────────────────────

describe('Shielded Challenge', () => {
  const challenger = (level = 2, over: Partial<CombatUnit> = {}) =>
    bulwark({
      skills: [provokingStrike],
      passives: ['shieldedChallenge'],
      passiveRanks: { shieldedChallenge: RANKS[level - 1] },
      ...over,
    });

  it('gives a Barrier of 20 / 30 / 40% of Attack on a landed Provoking Strike', () => {
    const barriers = [1, 2, 3].map((level) => {
      state().reset();
      const me = challenger(level);
      useCombatStore.setState({ units: [me, foe('foe')] });
      resolveSkillUse(me, provokingStrike, at(1, 0), SILENT_SINK);
      return effectOn('tank', AuraType.Barrier);
    });
    expect(barriers.map((b) => b?.magnitude)).toEqual(
      BALANCE.SHIELDED_CHALLENGE_BARRIER.map((share) => Math.round(20 * share)),
    );
    expect(barriers.every((b) => b?.duration === BALANCE.SHIELDED_CHALLENGE_DURATION)).toBe(true);
    expect(shieldedChallengeShare(RANKS[0])).toBeLessThan(shieldedChallengeShare(RANKS[2]));
  });

  it('refreshes rather than stacks on a second strike', () => {
    const me = challenger();
    useCombatStore.setState({ units: [me, foe('foe')] });
    resolveSkillUse(me, provokingStrike, at(1, 0), SILENT_SINK);
    const first = effectOn('tank', AuraType.Barrier)!.magnitude;
    resolveSkillUse(unitNow('tank'), provokingStrike, at(1, 0), SILENT_SINK);
    expect(effectOn('tank', AuraType.Barrier)!.magnitude).toBe(first);
  });

  it('pays out against an enemy that shrugs off the Taunt', () => {
    const me = challenger();
    const immune = foe('foe', at(1, 0), { activeEffects: [{ type: AuraType.DebuffImmunity, magnitude: 1, duration: -1 }] });
    useCombatStore.setState({ units: [me, immune] });
    resolveSkillUse(me, provokingStrike, at(1, 0), SILENT_SINK);
    expect(effectOn('foe', AfflictionType.Taunt)).toBeUndefined();
    expect(effectOn('tank', AuraType.Barrier)).toBeDefined();
  });

  it('gives nothing for a dodged strike, or for any other skill', () => {
    // Every roll succeeds, so the dodge does
    spyDice().mockReturnValue(0);
    const me = challenger();
    useCombatStore.setState({ units: [me, foe('foe', at(1, 0), { stats: stats({ maxHp: 1000, dodgeChance: 100 }) })] });
    resolveSkillUse(me, provokingStrike, at(1, 0), SILENT_SINK);
    expect(effectOn('tank', AuraType.Barrier)).toBeUndefined();

    state().reset();
    useCombatStore.setState({ units: [challenger(), foe('foe')] });
    applyOnHitStatuses(unitNow('tank'), unitNow('foe'), 5, SILENT_SINK, 1000, false, { ...provokingStrike, id: 'slash' });
    expect(effectOn('tank', AuraType.Barrier)).toBeUndefined();
  });

  it("is amplified by the Bulwark's shield bonuses", () => {
    const me = challenger(2, { stats: stats({ shieldPower: 50 }) });
    useCombatStore.setState({ units: [me, foe('foe')] });
    resolveSkillUse(me, provokingStrike, at(1, 0), SILENT_SINK);
    expect(effectOn('tank', AuraType.Barrier)!.magnitude).toBe(Math.round(Math.round(20 * 0.3) * 1.5));
  });
});

// ─── Last Stand ───────────────────────────────────────────────────────────────

describe('Last Stand', () => {
  const standing = (level = 2, hp = 50) =>
    bulwark({ passives: ['lastStand'], passiveRanks: { lastStand: RANKS[level - 1] }, currentHp: hp });

  it('takes 20 / 30 / 40% off a blow at or below 30% health', () => {
    const lost = [1, 2, 3].map((level) => {
      state().reset();
      useCombatStore.setState({ units: [standing(level), foe('foe')] });
      return state().damageUnit('tank', 20, 'foe').hpLost;
    });
    expect(lost).toEqual([1, 2, 3].map((level) => Math.round(20 * (1 - lastStandReduction(RANKS[level - 1])))));
    expect(BALANCE.LAST_STAND_REDUCTION).toEqual([0.2, 0.3, 0.4]);
  });

  it('does nothing above the threshold', () => {
    useCombatStore.setState({ units: [standing(2, 200), foe('foe')] });
    expect(state().damageUnit('tank', 20, 'foe').hpLost).toBe(20);
  });

  it('reduces damage nobody authored (a reflection) and damage over time alike', () => {
    useCombatStore.setState({ units: [standing(), foe('foe')] });
    // A Thorns reflection or a hazard arrives through damageUnit with no attacker
    expect(state().damageUnit('tank', 20).hpLost).toBe(14);

    state().reset();
    useCombatStore.setState({
      units: [
        { ...standing(), activeEffects: [{ type: AfflictionType.Bleed, magnitude: 20, duration: 3, sourceUnitId: 'foe' }] },
        foe('foe'),
      ],
    });
    state().tickEffectsOnUnit('tank');
    expect(unitNow('tank').currentHp).toBe(50 - 14);
  });

  it('adds no defence stat: the reduction is to damage, not to armour', () => {
    useCombatStore.setState({ units: [standing(), foe('foe')] });
    expect(unitNow('tank').stats.defense).toBe(0);
  });
});

// ─── Shield Avalanche ─────────────────────────────────────────────────────────

describe('Shield Avalanche', () => {
  const charger = (over: Partial<CombatUnit> = {}) => bulwark({ skills: [shieldAvalanche], ...over });
  const target = at(0, 4);
  // The dash lands beside the aimed hex, nearest the Bulwark
  const landing = at(0, 3);
  const cone = arcHexes(shieldAvalanche, landing, target);
  const second = cone.find((h) => hexKey(h) !== hexKey(target))!;

  it('charges to a free hex beside the aim and strikes everything in the cone in front of it', () => {
    useCombatStore.setState({ units: [charger(), foe('a', target), foe('b', second), foe('far', at(-3, 0))] });
    const result = resolveSkillUse(unitNow('tank'), shieldAvalanche, target, SILENT_SINK);
    expect(result.ok).toBe(true);
    expect(unitNow('tank').position).toEqual(landing);
    expect(hexDistance(at(0, 0), landing)).toBeLessThanOrEqual(shieldAvalanche.selfMove!.range);
    for (const id of ['a', 'b']) {
      expect(unitNow(id).currentHp).toBeLessThan(1000);
      expect(effectOn(id, AfflictionType.Stun)?.duration).toBe(1);
    }
    expect(unitNow('far').currentHp).toBe(1000);
  });

  // Playtest 2026-10-13: the wedge opened on the empty start hex and the
  // Bulwark landed with his back to the enemies he had just slammed
  it('draws the cone from the landing and leaves the Bulwark facing down it', () => {
    useCombatStore.setState({ units: [charger(), foe('a', target)] });
    const specs: VfxSpec[] = [];
    resolveSkillUse(unitNow('tank'), shieldAvalanche, target, { ...SILENT_SINK, vfx: (v) => specs.push(v) });
    expect(specs.find((v) => v.kind === 'shieldwave')?.casterPos).toEqual(landing);
    // The store's facing convention: atan2 of the pixel step, x over z
    const facing = (to: HexCoord) => {
      const a = hexToPixel(landing);
      const b = hexToPixel(to);
      return Math.atan2(b.x - a.x, b.y - a.y);
    };
    expect(unitNow('tank').facingAngle).toBeCloseTo(facing(arcAimHex(landing, target)));
    expect(unitNow('tank').facingAngle).not.toBeCloseTo(facing(at(0, 0)));
  });

  it('offers the far enemy as a target, reading the cone from the landing', () => {
    useCombatStore.setState({ units: [charger(), foe('a', target)] });
    const valid = getValidSkillTargetHexes(shieldAvalanche, unitNow('tank'), state().units);
    expect(valid.map(hexKey)).toContain(hexKey(target));
  });

  it('damages a boss without Stunning it', () => {
    useCombatStore.setState({ units: [charger(), foe('boss', target, { templateId: bossTemplate.id })] });
    resolveSkillUse(unitNow('tank'), shieldAvalanche, target, SILENT_SINK);
    expect(unitNow('boss').currentHp).toBeLessThan(1000);
    expect(effectOn('boss', AfflictionType.Stun)).toBeUndefined();
  });

  it('slams from where it stands when the aim is already beside it', () => {
    useCombatStore.setState({ units: [charger(), foe('a', at(0, 1))] });
    expect(resolveSkillUse(unitNow('tank'), shieldAvalanche, at(0, 1), SILENT_SINK).ok).toBe(true);
    expect(unitNow('tank').position).toEqual(at(0, 0));
    expect(unitNow('a').currentHp).toBeLessThan(1000);
  });

  it('is refused while Rooted, like any other charge', () => {
    useCombatStore.setState({
      units: [charger({ activeEffects: [{ type: AfflictionType.Root, magnitude: 1, duration: 2 }] }), foe('a', target)],
    });
    expect(resolveSkillUse(unitNow('tank'), shieldAvalanche, target, SILENT_SINK).ok).toBe(false);
    expect(unitNow('a').currentHp).toBe(1000);
  });

  it('scales its damage with the node rank', () => {
    const n = findMasteryNode('bulwark_shield_avalanche')!.node;
    const damage = [1, 2, 3].map((level) => nodeSkillAt(n, level)!.damage!);
    expect(damage[0]).toBeLessThan(damage[1]);
    expect(damage[1]).toBeLessThan(damage[2]);
  });
});

// ─── Reckoning ────────────────────────────────────────────────────────────────

describe('Reckoning', () => {
  const holder = (over: Partial<CombatUnit> = {}) => bulwark({ skills: [reckoning], ...over });
  const shield = () => effectOn('tank', AuraType.Reckoning);

  it('raises a large Barrier of its own for two turns', () => {
    useCombatStore.setState({ units: [holder(), foe('near')] });
    expect(resolveSkillUse(unitNow('tank'), reckoning, at(0, 0), SILENT_SINK).ok).toBe(true);
    expect(shield()).toMatchObject({ magnitude: 40, duration: 2 });
  });

  it('soaks before an ordinary Barrier and stores only what it soaks, once per hit', () => {
    useCombatStore.setState({
      units: [
        holder({ activeEffects: [
          { type: AuraType.Reckoning, magnitude: 30, duration: 2, sourceUnitId: 'tank' },
          { type: AuraType.Barrier, magnitude: 50, duration: 2 },
        ] }),
        foe('near'),
      ],
    });
    state().damageUnit('tank', 10, 'near');
    expect(shield()).toMatchObject({ magnitude: 20, stored: 10 });
    expect(effectOn('tank', AuraType.Barrier)!.magnitude).toBe(50);
    state().damageUnit('tank', 12, 'near');
    expect(shield()).toMatchObject({ magnitude: 8, stored: 22 });
  });

  it('breaks into a shockwave on every enemy within two hexes, once, from what it stored', () => {
    useCombatStore.setState({
      units: [
        holder({ activeEffects: [
          { type: AuraType.Reckoning, magnitude: 30, duration: 2, stored: 0, sourceUnitId: 'tank' },
          { type: AuraType.Barrier, magnitude: 50, duration: 2 },
        ] }),
        foe('near', at(1, 0)),
        foe('ring', at(0, 2)),
        foe('far', at(0, 4)),
      ],
    });
    // 30 to break it (all stored), the other 20 eaten by the ordinary Barrier: not stored
    const hit = state().damageUnit('tank', 50, 'near');
    const burst = reckoningBurst(20, 30);
    expect(shield()).toBeUndefined();
    expect(hit.deathEvents?.some((e) => e.vfx?.kind === 'nova')).toBe(true);
    expect(unitNow('near').currentHp).toBe(1000 - burst);
    expect(unitNow('ring').currentHp).toBe(1000 - burst);
    expect(unitNow('far').currentHp).toBe(1000);
    // The Barrier took the rest; HP is untouched
    expect(effectOn('tank', AuraType.Barrier)!.magnitude).toBe(30);
    expect(unitNow('tank').currentHp).toBe(200);

    // Gone, so a later hit cannot set it off again
    state().damageUnit('tank', 10, 'near');
    expect(unitNow('near').currentHp).toBe(1000 - burst);
  });

  it('caps the stored part of the shockwave', () => {
    expect(reckoningBurst(20, 0)).toBe(Math.round(20 * BALANCE.RECKONING_BASE));
    expect(reckoningBurst(20, 10_000)).toBe(Math.round(20 * (BALANCE.RECKONING_BASE + BALANCE.RECKONING_CAP)));
  });

  it('releases when it runs out, and soaks a damage-over-time tick on the way', () => {
    useCombatStore.setState({
      units: [
        holder({ activeEffects: [
          { type: AuraType.Reckoning, magnitude: 30, duration: 1, stored: 5, sourceUnitId: 'tank' },
          { type: AfflictionType.Bleed, magnitude: 6, duration: 3, sourceUnitId: 'near' },
        ] }),
        foe('near', at(1, 0)),
      ],
    });
    const events = state().tickEffectsOnUnit('tank');
    expect(shield()).toBeUndefined();
    expect(unitNow('tank').currentHp).toBe(200);
    expect(events.some((e) => e.vfx?.kind === 'nova')).toBe(true);
    expect(unitNow('near').currentHp).toBe(1000 - reckoningBurst(20, 11));
  });

  it('scales its Barrier with the node rank', () => {
    const n = findMasteryNode('bulwark_reckoning')!.node;
    const sizes = [1, 2, 3].map((level) => {
      const effect = nodeSkillAt(n, level)!.appliesEffect;
      return (Array.isArray(effect) ? effect[0] : effect)!.magnitude;
    });
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[1]).toBeLessThan(sizes[2]);
  });
});

// ─── Detailed text ────────────────────────────────────────────────────────────

describe('the Detailed view', () => {
  it('states the shockwave rule and the charge rule', () => {
    const reck = skillEffectLines(reckoning).join(' ');
    expect(reck).toMatch(/Shockwave/);
    expect(reck).toContain(`within ${BALANCE.RECKONING_RADIUS} hexes`);
    expect(reck).toContain(`capped at ${BALANCE.RECKONING_CAP}× ATK`);
    const charge = skillEffectLines(shieldAvalanche).join(' ');
    expect(charge).toMatch(/Stunned/);
    expect(charge).toMatch(/bosses among them, still take the damage/);
  });
});
