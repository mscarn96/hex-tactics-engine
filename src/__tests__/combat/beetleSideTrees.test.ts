import { nodeDescription } from '@/__tests__/support/masteryNodeText';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { flushReactions } from '@/systems/combat/reactionResolve';
import { requireUnit } from '@/systems/combat/unitLookup';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { skillDamagePreview } from '@/systems/combat/damageCalc';
import { reactionLimit } from '@/systems/combat/beetle';
import { basicAttackWith } from '@/systems/combat/basicAttack';
import { applyMasteryModifiers, canUnlockNode, masteryModifiers, nodeSkillAt } from '@/systems/progression/mastery';
import { findMasteryPath } from '@/data/skills/masteryData';
import {
  carapaceBastion, carapaceLeap, gripAndThrow, hornSweep, shellWall, vengefulShell,
} from '@/data/skills/masterySkills';
import { nodeSimpleText, skillSimpleText } from '@/data/display/simpleText';
import { PASSIVE_DEFS } from '@/systems/combat/passives';
import { BALANCE } from '@/data/balanceConstants';
import {
  AfflictionType, AuraType, CombatUnit, HeroClass, HeroSkill, HeroStats, PassiveId, PassiveRank,
} from '@/models/types';
import { at, makeFoe, makeHero, makeSkill, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { passiveDescription } from '@/systems/combat/passives';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * The Beetle's side trees (the private project notes, "Beetle", Side A and Side
 * B), and the copy that finishes the tree. Pinned as rules: Second Watch is the
 * only way to stand two Reactions; Retribution answers exactly the blows a
 * Beetle took or split; a numbed enemy hits and casts weaker for a turn; Heavy
 * Hands moves the two skills it names and nothing else; Planted Guard holds from
 * a still turn until a step of the Beetle's own. Numbers come from
 * `BALANCE.BEETLE`.
 */

const B = BALANCE.BEETLE;
const RANK2: PassiveRank = { level: 2, scale: 1 };

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 300, attack: 20, magic: 0, defense: 10, magicDefense: 6, maxMana: 200,
    critChance: 0, dodgeChance: 0, speed: 10, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const effectOn = (id: string, type: AuraType | AfflictionType) =>
  unitNow(id).activeEffects.find((e) => e.type === type);
const hpOf = () => Object.fromEntries(state().units.map((u) => [u.id, u.currentHp]));
const hpLost = (id: string, before: Record<string, number>) => before[id] - unitNow(id).currentHp;

const beetle = (passives: PassiveId[] = [], over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'beetle', position: at(0, 0), stats: stats(), currentMana: 200, resource: 'chi',
    skills: [carapaceLeap, vengefulShell, carapaceBastion, hornSweep, gripAndThrow, shellWall],
    passives, passiveRanks: Object.fromEntries(passives.map((p) => [p, RANK2])),
    ...over,
  });
const ally = (id: string, q: number, r: number) =>
  makeUnit({ id, position: at(q, r), stats: stats({ defense: 0, magicDefense: 0 }) });
const foe = (id: string, q: number, r: number, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: stats({ maxHp: 2000, defense: 0, magicDefense: 0, magic: 20 }), ...over });

const cast = (skill: HeroSkill, q: number, r: number) =>
  resolveSkillUse(unitNow('beetle'), skill, at(q, r), SILENT_SINK);
/** A fresh turn for the Beetle: its cooldowns spent and its turn unspent, so a second Reaction can be tried. */
const freshTurn = () =>
  useCombatStore.setState((s) => ({
    units: s.units.map((u) => (u.id === 'beetle' ? { ...u, cooldowns: {}, hasActed: false, hasMoved: false } : u)),
  }));
const jab = makeSkill({ id: 'slash', name: 'Jab', damage: 1, range: 6 });
const strike = (foeId: string, skill: HeroSkill, q: number, r: number) =>
  resolveSkillUse(unitNow(foeId), skill, at(q, r), SILENT_SINK);

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
});

// ─── The tree ─────────────────────────────────────────────────────────────────

describe('the Beetle side trees', () => {
  const path = findMasteryPath('beetle')!;
  const capstones = path.nodes.filter((n) => n.exclusiveGroup === 'capstone').map((n) => n.id);
  const node = (id: string) => path.nodes.find((n) => n.id === id)!;

  it('hangs Second Watch and Numbing Staff off the capstones, each over two children', () => {
    const starters = path.nodes.filter((n) => n.exclusiveGroup === 'side');
    expect(starters.map((n) => [n.id, n.grantsPassive, n.maxLevel])).toEqual([
      ['beetle_second_watch', 'secondWatch', 1],
      ['beetle_numbing_staff', 'numbingStaff', 1],
    ]);
    for (const s of starters) expect([...(s.requires ?? [])].sort()).toEqual([...capstones].sort());
    const under = (id: string) => path.nodes.filter((n) => n.requires?.includes(id)).map((n) => n.id);
    expect(under('beetle_second_watch')).toEqual(['beetle_lasting_shell', 'beetle_retribution']);
    expect(under('beetle_numbing_staff')).toEqual(['beetle_heavy_hands', 'beetle_planted_guard']);
  });

  it('opens a starter with any one capstone, and lets a Beetle take one side tree, not both', () => {
    const below = Object.fromEntries(path.nodes.filter((n) => n.tier < 3 && !n.sideTree).map((n) => [n.id, 1]));
    const hero = (nodes: Record<string, number>) => makeHero({
      templateId: 'monk', heroClass: HeroClass.Monk, level: 20,
      masteryPath: 'beetle', masteryPoints: 15, masteryNodes: nodes,
    });
    expect(canUnlockNode(hero(below), 'beetle_second_watch').ok).toBe(false);
    for (const cap of capstones) {
      const withCap = { ...below, [cap]: 1 };
      expect(canUnlockNode(hero(withCap), 'beetle_second_watch').ok).toBe(true);
      expect(canUnlockNode(hero(withCap), 'beetle_numbing_staff').ok).toBe(true);
      expect(canUnlockNode(hero({ ...withCap, beetle_second_watch: 1 }), 'beetle_numbing_staff').ok).toBe(false);
      expect(canUnlockNode(hero({ ...withCap, beetle_second_watch: 1 }), 'beetle_retribution').ok).toBe(true);
    }
  });

  it('carries Simple copy on every node at every rank, and on every skill', () => {
    for (const n of path.nodes) {
      for (const level of [1, 2, 3]) {
        expect({ id: n.id, text: nodeSimpleText(n, level) }).toEqual({ id: n.id, text: expect.any(String) });
      }
      // and the detailed view: the node's own line, and a passive's description and figures
      expect(masteryNodeDescription(n).length).toBeGreaterThan(10);
      if (n.grantsPassive) {
        expect(passiveDescription(n.grantsPassive).length).toBeGreaterThan(10);
        expect(PASSIVE_DEFS[n.grantsPassive].figures?.(RANK2).length).toBeGreaterThan(0);
      }
    }
    const skills = path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!);
    for (const s of skills) expect({ id: s.id, text: skillSimpleText(s) }).toEqual({ id: s.id, text: expect.any(String) });
  });

  it('resolves the side-tree figures to the rank shown', () => {
    expect(nodeSimpleText(node('beetle_heavy_hands'), 1)).toContain('15%');
    expect(nodeSimpleText(node('beetle_heavy_hands'), 3)).toContain('25%');
    expect(nodeSimpleText(node('beetle_planted_guard'), 2)).toContain(`+${B.PLANTED_GUARD_DEFENSE}`);
    expect(nodeSimpleText(node('beetle_lasting_shell'), 2)).toContain('+30%');
    expect(nodeSimpleText(node('beetle_retribution'), 2)).toContain(B.RETRIBUTION_STRIKE.toFixed(2));
  });
});

// ─── Side A ───────────────────────────────────────────────────────────────────

describe('Second Watch', () => {
  const setup = (passives: PassiveId[]) =>
    useCombatStore.setState({ units: [beetle(passives), ally('ward', 0, 2), ally('other', 2, 0), foe('f', 0, 3)] });

  it('lets a Beetle holding it stand two Reactions, and refuses a third', () => {
    setup(['secondWatch']);
    expect(reactionLimit(unitNow('beetle'))).toBe(B.SECOND_WATCH_REACTIONS);
    expect(cast(carapaceLeap, 0, 2).ok).toBe(true);
    freshTurn();
    expect(cast(vengefulShell, 0, 0).ok).toBe(true);
    expect(state().reactions.map((r) => r.skill.id)).toEqual(['carapace_leap', 'vengeful_shell']);
    freshTurn();
    expect(cast(carapaceLeap, 2, 0).ok).toBe(false);
    expect(state().reactions).toHaveLength(2);
  });

  it('holds everybody else to one', () => {
    setup([]);
    expect(reactionLimit(unitNow('beetle'))).toBe(1);
    expect(cast(carapaceLeap, 0, 2).ok).toBe(true);
    freshTurn();
    expect(cast(vengefulShell, 0, 0).ok).toBe(false);
    expect(state().reactions).toHaveLength(1);
  });

  it('keeps both watching: a Leap and a Vengeful Shell each answer their own moment', () => {
    setup(['secondWatch']);
    cast(carapaceLeap, 2, 0);
    freshTurn();
    cast(vengefulShell, 0, 0);
    // The Vengeful Shell takes the jab at its ward
    const before = hpOf();
    strike('f', jab, 0, 2);
    expect(hpLost('ward', before)).toBe(0);
    flushReactions(SILENT_SINK);
    // and the Leap still stands for its own ally
    expect(state().reactions.some((r) => r.skill.id === 'carapace_leap')).toBe(true);
  });
});

describe('Lasting Shell', () => {
  it('makes every Barrier the Beetle grants 30% larger, the defence-scaled ones included', () => {
    const mods = masteryModifiers({ masteryPath: 'beetle', masteryNodes: { beetle_lasting_shell: 2 } });
    expect(mods.shieldPowerBonus).toBeCloseTo(0.3);
    const plain = () => {
      state().reset();
      useCombatStore.setState({ units: [beetle(), ally('near', 1, 0)] });
      cast(shellWall, 0, 0);
      return effectOn('near', AuraType.Barrier)!.magnitude;
    };
    const base = plain();
    state().reset();
    useCombatStore.setState({ units: [beetle([], { masteryModifiers: mods }), ally('near', 1, 0)] });
    cast(shellWall, 0, 0);
    expect(effectOn('near', AuraType.Barrier)!.magnitude).toBe(Math.round(base * 1.3));
  });
});

describe('Retribution', () => {
  it('strikes back the attacker of a blow a Vengeful Shell took, on top of the answer', () => {
    const run = (passives: PassiveId[]) => {
      state().reset();
      useCombatStore.setState({ units: [beetle(passives), ally('ward', 0, 2), foe('f', 0, 3)] });
      cast(vengefulShell, 0, 0);
      const before = hpOf();
      strike('f', jab, 0, 2);
      const struckAtOnce = hpLost('f', before);
      flushReactions(SILENT_SINK);
      return { struckAtOnce, total: hpLost('f', before) };
    };
    const plain = run([]);
    const avenged = run(['retribution']);
    expect(plain.struckAtOnce).toBe(0);
    // The strike back lands as the blow does, before the answer, which comes as before
    const strikeBack = Math.round(unitNow('beetle').stats.attack * B.RETRIBUTION_STRIKE);
    expect(avenged.struckAtOnce).toBe(strikeBack);
    expect(avenged.total).toBe(plain.total + strikeBack);
  });

  it('strikes back the attacker of a blow a Carapace Bastion split, and not one it did not touch', () => {
    useCombatStore.setState({
      units: [beetle(['retribution']), ally('inside', 1, 0), ally('outside', 4, 0), foe('f', 2, 0), foe('g', 5, 0)],
    });
    cast(carapaceBastion, 0, 0);
    let before = hpOf();
    strike('f', jab, 1, 0);
    expect(hpLost('beetle', before)).toBeGreaterThan(0);
    expect(hpLost('f', before)).toBe(Math.round(unitNow('beetle').stats.attack * B.RETRIBUTION_STRIKE));
    before = hpOf();
    strike('g', jab, 4, 0);
    expect(hpLost('g', before)).toBe(0);
  });

  it('does nothing for a Beetle without it', () => {
    useCombatStore.setState({ units: [beetle(), ally('inside', 1, 0), foe('f', 2, 0)] });
    cast(carapaceBastion, 0, 0);
    const before = hpOf();
    strike('f', jab, 1, 0);
    expect(hpLost('f', before)).toBe(0);
  });
});

// ─── Side B ───────────────────────────────────────────────────────────────────

describe('Numbing Staff', () => {
  const staff = basicAttackWith(undefined);

  it('leaves the enemy a Basic Attack strikes hitting and casting weaker for its next turn', () => {
    useCombatStore.setState({ units: [beetle(['numbingStaff']), foe('f', 1, 0)] });
    const before = getCombatEffectiveStats(unitNow('f'));
    cast(staff, 1, 0);
    expect(effectOn('f', AfflictionType.AttackDown)).toMatchObject({ magnitude: B.NUMBING_ATTACK_DOWN, duration: B.NUMBING_TURNS });
    expect(effectOn('f', AfflictionType.MagicDown)).toMatchObject({ magnitude: B.NUMBING_MAGIC_DOWN, duration: B.NUMBING_TURNS });
    const after = getCombatEffectiveStats(unitNow('f'));
    expect(after.attack).toBe(before.attack - B.NUMBING_ATTACK_DOWN);
    expect(after.magic).toBe(before.magic - B.NUMBING_MAGIC_DOWN);
    // so its blows and its spells are both worth less
    const spell = makeSkill({ id: 'slash', name: 'Bolt', damage: 1, range: 6, scaling: 'magic' });
    const numbed = unitNow('f');
    const clear = { ...numbed, activeEffects: [] };
    expect(skillDamagePreview(numbed, jab)).toBeLessThan(skillDamagePreview(clear, jab));
    expect(skillDamagePreview(numbed, spell)).toBeLessThan(skillDamagePreview(clear, spell));
    // and it lasts the enemy's next turn: two ticks, one at the start of each of its turns
    state().tickEffectsOnUnit('f');
    expect(effectOn('f', AfflictionType.MagicDown)).toBeDefined();
    state().tickEffectsOnUnit('f');
    expect(effectOn('f', AfflictionType.MagicDown)).toBeUndefined();
  });

  it('numbs only with the Basic Attack, and only for a Beetle holding it', () => {
    useCombatStore.setState({ units: [beetle(['numbingStaff']), foe('f', 1, 0)] });
    cast(gripAndThrow, 1, 0);
    expect(effectOn('f', AfflictionType.MagicDown)).toBeUndefined();
    state().reset();
    useCombatStore.setState({ units: [beetle(), foe('f', 1, 0)] });
    cast(staff, 1, 0);
    expect(effectOn('f', AfflictionType.MagicDown)).toBeUndefined();
  });
});

describe('Heavy Hands', () => {
  it('raises Horn Sweep and Grip and Throw, the boss blow included, and nothing else', () => {
    const plain = beetle();
    const heavy = beetle(['heavyHands']);
    const ratio = (s: HeroSkill) => skillDamagePreview(heavy, s) / skillDamagePreview(plain, s);
    expect(ratio(hornSweep)).toBeCloseTo(1 + B.HEAVY_HANDS, 1);
    expect(ratio(gripAndThrow)).toBeCloseTo(1 + B.HEAVY_HANDS, 1);
    expect(ratio({ ...gripAndThrow, ...gripAndThrow.immovableVariant })).toBeCloseTo(1 + B.HEAVY_HANDS, 1);
    expect(skillDamagePreview(heavy, basicAttackWith(undefined))).toBe(skillDamagePreview(plain, basicAttackWith(undefined)));
    // A mastery modifier cannot reach a named skill this way, so the rule is the passive's
    expect(applyMasteryModifiers(hornSweep, {})).toBe(hornSweep);
  });
});

describe('Planted Guard', () => {
  const sheet = () => {
    const s = getCombatEffectiveStats(unitNow('beetle'));
    return [s.defense, s.magicDefense ?? 0] as const;
  };

  it('hardens both defences from a turn ended without moving until the Beetle next steps', () => {
    useCombatStore.setState({ units: [beetle(['plantedGuard'])] });
    const [pd, md] = sheet();
    // Not on the first turn of a fight: nothing has been held yet
    useCombatStore.setState((s) => ({ units: s.units.map((u) => ({ ...u, previousTurnStationary: true })) }));
    expect(sheet()).toEqual([pd + B.PLANTED_GUARD_DEFENSE, md + B.PLANTED_GUARD_DEFENSE]);
    // A step of its own breaks the stance; a shove does not
    state().moveUnit('beetle', at(1, 0), 'walk', false);
    expect(sheet()).toEqual([pd + B.PLANTED_GUARD_DEFENSE, md + B.PLANTED_GUARD_DEFENSE]);
    state().moveUnit('beetle', at(2, 0), 'walk', true);
    expect(sheet()).toEqual([pd, md]);
  });

  it('gives nothing after a turn that moved, and nothing to a Beetle without it', () => {
    useCombatStore.setState({ units: [beetle(['plantedGuard'], { previousTurnStationary: false })] });
    const moved = sheet();
    useCombatStore.setState({ units: [beetle(['plantedGuard'], { previousTurnStationary: true })] });
    expect(sheet()[0]).toBe(moved[0] + B.PLANTED_GUARD_DEFENSE);
    useCombatStore.setState({ units: [beetle([], { previousTurnStationary: true })] });
    expect(sheet()).toEqual(moved);
  });
});
