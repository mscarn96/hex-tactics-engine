import { spyDice } from '../support/dice';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { requireUnit } from '@/systems/combat/unitLookup';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { echoHex, echoReturnBlock, echoReturnCost, returnToEcho } from '@/systems/combat/shadowEcho';
import { deathMarkFrom, deathMarkThreshold } from '@/systems/combat/assassination';
import { ECHO_STEALTH_MARK, shadowEchoCost, shadowEchoPerks } from '@/systems/combat/passiveFormulas';
import { critBonusAgainst } from '@/systems/combat/passives';
import { poisonDoses } from '@/systems/combat/statusEffects';
import { beginTurn } from '@/systems/combat/turnStart';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { BALANCE } from '@/data/balanceConstants';
import { assassinate, shadowstep, venomedBlades } from '@/data/skills/masterySkills';
import { findMasteryPath } from '@/data/skills/masteryData';
import { AfflictionType, AuraType, CombatUnit, HeroStats, PassiveId, PassiveRank } from '@/models/types';
import { at, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Shadowblade remaster, as rules: the tree's shape, Shadow Echo's mana-paid
 * return that spends no action (before or after acting), Venom Transfer, the
 * Poison dose count the model shows, and Assassinate's delayed automatic
 * execution. What is pinned is the shape, not the numbers.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 400, attack: 30, magic: 10, defense: 0, magicDefense: 0, maxMana: 200,
    critChance: 0, dodgeChance: 0, speed: 10, moveRange: 3, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));

const blade = (passives: PassiveId[] = [], over: Partial<CombatUnit> = {}, level = 2) =>
  makeUnit({
    id: 'sb',
    position: at(0, 0),
    stats: stats(),
    currentMana: 200,
    skills: [shadowstep, venomedBlades, assassinate],
    passives,
    passiveRanks: Object.fromEntries(passives.map((p) => [p, RANKS[level - 1]])),
    ...over,
  });

const foe = (id: string, q: number, r: number, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: stats({ maxHp: 1000 }), ...over });

const poisonOn = (id: string) => unitNow(id).activeEffects.find((e) => e.type === AfflictionType.Poison);

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
  spyDice().mockReturnValue(0.99);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── The tree ─────────────────────────────────────────────────────────────────

describe('Shadowblade tree', () => {
  const path = findMasteryPath('shadowblade')!;
  const row = (tier: number, column: number) => path.nodes.find((n) => n.tier === tier && n.column === column && !n.sideTree);

  it('puts Lethality, Evasion and the Shadow Echo Signature node across the first row', () => {
    expect(row(1, 0)?.id).toBe('shadow_lethality');
    expect(row(1, 1)?.id).toBe('shadow_evasion');
    expect(row(1, 2)?.grantsPassive).toBe('shadowEcho');
  });

  it('replaces Quick Hands and Rot, and opens the poison side tree with Venom Transfer', () => {
    const ids = path.nodes.map((n) => n.id);
    expect(ids).not.toContain('shadow_quick');
    expect(ids).not.toContain('shadow_rot');
    const transfer = path.nodes.find((n) => n.grantsPassive === 'venomTransfer')!;
    expect(transfer.sideTree).toBe('b');
    for (const child of path.nodes.filter((n) => n.sideTree === 'b' && n.id !== transfer.id)) {
      expect(child.requires).toEqual([transfer.id]);
    }
  });

  it('keeps the return price flat and adds Stealth at rank 2 and a certain crit at rank 3', () => {
    expect(shadowEchoCost()).toBeGreaterThan(0);
    expect(RANKS.map(shadowEchoPerks)).toEqual([
      { stealth: false, crit: false },
      { stealth: true, crit: false },
      { stealth: true, crit: true },
    ]);
  });
});

// ─── Shadow Echo ──────────────────────────────────────────────────────────────

describe('Shadow Echo', () => {
  it('leaves a shadow where a moving Shadowstep started, and none without the node', () => {
    useCombatStore.setState({ units: [blade(['shadowEcho']), foe('a', 6, -3)] });
    resolveSkillUse(unitNow('sb'), shadowstep, at(3, 0), SILENT_SINK);
    expect(unitNow('sb').position).toEqual(at(3, 0));
    expect(echoHex(unitNow('sb'))).toEqual(at(0, 0));

    state().reset();
    useCombatStore.setState({ units: [blade([]), foe('a', 6, -3)] });
    resolveSkillUse(unitNow('sb'), shadowstep, at(3, 0), SILENT_SINK);
    expect(echoHex(unitNow('sb'))).toBeUndefined();
  });

  it('keeps one shadow per Shadowblade: the next Shadowstep replaces it', () => {
    useCombatStore.setState({ units: [blade(['shadowEcho']), foe('a', 6, -3)] });
    resolveSkillUse(unitNow('sb'), shadowstep, at(3, 0), SILENT_SINK);
    state().beginTurnFlags('sb');
    useCombatStore.setState((s) => ({ units: s.units.map((u) => ({ ...u, cooldowns: {} })) }));
    resolveSkillUse(unitNow('sb'), shadowstep, at(3, -3), SILENT_SINK);
    expect(unitNow('sb').activeEffects.filter((e) => e.type === AuraType.ShadowEcho)).toHaveLength(1);
    expect(echoHex(unitNow('sb'))).toEqual(at(3, 0));
  });

  it('holds the turn open after the action for a return, with no Move', () => {
    useCombatStore.setState({ units: [blade(['shadowEcho']), foe('a', 4, 0)] });
    const result = resolveSkillUse(unitNow('sb'), shadowstep, at(4, 0), SILENT_SINK);
    expect(result).toEqual({ ok: true, endsTurn: false });
    expect(unitNow('sb').hasActed).toBe(true);
    expect(unitNow('sb').echoHold).toBe(true);
    expect(echoReturnBlock(unitNow('sb'), state().units)).toBeNull();
  });

  it('returns after attacking for mana, spending the shadow and nothing else', () => {
    useCombatStore.setState({ units: [blade(['shadowEcho']), foe('a', 4, 0)] });
    resolveSkillUse(unitNow('sb'), shadowstep, at(4, 0), SILENT_SINK);
    const mana = unitNow('sb').currentMana;
    const cooldowns = { ...unitNow('sb').cooldowns };
    expect(returnToEcho('sb', SILENT_SINK)).toBe(true);
    expect(unitNow('sb').position).toEqual(at(0, 0));
    expect(unitNow('sb').currentMana).toBe(mana - shadowEchoCost());
    expect(echoHex(unitNow('sb'))).toBeUndefined();
    expect(unitNow('sb').cooldowns).toEqual(cooldowns);
  });

  it.each([
    [1, undefined, 0],
    [2, 1, 0],
    [3, ECHO_STEALTH_MARK, 100],
  ])('at rank %i the return grants Stealth %p and %i crit chance on the next attack', (level, stealth, crit) => {
    useCombatStore.setState({ units: [blade(['shadowEcho'], { position: at(2, 0) }, level), foe('a', 6, -3)] });
    state().applyEffect('sb', { type: AuraType.ShadowEcho, magnitude: 1, duration: 2, sourceUnitId: 'sb', zone: [at(0, 0)] });
    expect(returnToEcho('sb', SILENT_SINK)).toBe(true);
    expect(unitNow('sb').activeEffects.find((e) => e.type === AuraType.Stealth)?.magnitude).toBe(stealth);
    expect(critBonusAgainst(unitNow('sb'), unitNow('a'))).toBe(crit);
  });

  it('returns before acting without spending the action', () => {
    useCombatStore.setState({ units: [blade(['shadowEcho']), foe('a', 6, -3)] });
    state().applyEffect('sb', { type: AuraType.ShadowEcho, magnitude: 1, duration: 2, sourceUnitId: 'sb', zone: [at(-2, 0)] });
    state().beginTurnFlags('sb');
    expect(returnToEcho('sb', SILENT_SINK)).toBe(true);
    expect(unitNow('sb').position).toEqual(at(-2, 0));
    expect(unitNow('sb').hasActed).toBe(false);
    // And the action is still there: a cast resolves as the turn's action afterwards
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'a' ? { ...u, position: at(-1, 0) } : u)) }));
    expect(resolveSkillUse(unitNow('sb'), venomedBlades, at(-1, 0), SILENT_SINK).ok).toBe(true);
  });

  it('refuses a covered shadow, Root, Stun or too little mana, and charges nothing', () => {
    const setUp = (over: Partial<CombatUnit>, blocker = false) => {
      state().reset();
      useCombatStore.setState({
        units: [blade(['shadowEcho'], { position: at(2, 0), ...over }), ...(blocker ? [foe('b', 0, 0)] : [])],
      });
      state().applyEffect('sb', { type: AuraType.ShadowEcho, magnitude: 1, duration: 2, sourceUnitId: 'sb', zone: [at(0, 0)] });
    };
    for (const [over, blocker] of [
      [{}, true],
      [{ activeEffects: [{ type: AfflictionType.Root, magnitude: 1, duration: 2 }] }, false],
      [{ activeEffects: [{ type: AfflictionType.Stun, magnitude: 1, duration: 2 }] }, false],
      [{ currentMana: 1 }, false],
    ] as [Partial<CombatUnit>, boolean][]) {
      setUp(over, blocker);
      const mana = unitNow('sb').currentMana;
      expect(echoReturnBlock(unitNow('sb'), state().units)).not.toBeNull();
      expect(returnToEcho('sb', SILENT_SINK)).toBe(false);
      expect(unitNow('sb').position).toEqual(at(2, 0));
      expect(unitNow('sb').currentMana).toBe(mana);
    }
  });

  it('lets Silence through: a return is not a spell', () => {
    useCombatStore.setState({ units: [blade(['shadowEcho'], { position: at(2, 0), activeEffects: [{ type: AfflictionType.Silence, magnitude: 1, duration: 2 }] })] });
    state().applyEffect('sb', { type: AuraType.ShadowEcho, magnitude: 1, duration: 2, sourceUnitId: 'sb', zone: [at(0, 0)] });
    expect(echoReturnBlock(unitNow('sb'), state().units)).toBeNull();
  });

  it('lasts the turn it was left and the next regular turn, then fades', () => {
    useCombatStore.setState({ units: [blade(['shadowEcho']), foe('a', 6, -3)] });
    resolveSkillUse(unitNow('sb'), shadowstep, at(3, 0), SILENT_SINK);
    beginTurn('sb', SILENT_SINK);
    expect(echoHex(unitNow('sb'))).toEqual(at(0, 0));
    beginTurn('sb', SILENT_SINK);
    expect(echoHex(unitNow('sb'))).toBeUndefined();
  });

  it('does not hold a turn open for a Shadowblade that cannot afford the return', () => {
    useCombatStore.setState({ units: [blade(['shadowEcho'], { currentMana: shadowstep.manaCost + echoReturnCost(blade(['shadowEcho'])) - 1 }), foe('a', 4, 0)] });
    expect(resolveSkillUse(unitNow('sb'), shadowstep, at(4, 0), SILENT_SINK)).toEqual({ ok: true, endsTurn: true });
  });
});

// ─── Venom Transfer ───────────────────────────────────────────────────────────

describe('Venom Transfer', () => {
  const poisoned = (id: string, q: number, r: number, source = 'sb', stacks = 2) =>
    foe(id, q, r, { activeEffects: [{ type: AfflictionType.Poison, magnitude: 20, duration: 3, stacks, sourceUnitId: source }] });

  it('passes one dose of a dead enemy’s Poison to the nearest unpoisoned enemy in range', () => {
    useCombatStore.setState({ units: [blade(['venomTransfer']), poisoned('dead', 3, 0), foe('near', 4, 0), foe('far', 3, 3)] });
    state().damageUnit('dead', 5000, 'sb');
    const dose = poisonOn('near');
    expect(dose?.stacks).toBe(1);
    expect(dose?.magnitude).toBe(10);
    expect(dose?.sourceUnitId).toBe('sb');
    expect(dose?.duration).toBe(BALANCE.POISON_TICKS);
    expect(poisonOn('far')).toBeUndefined();
  });

  it('never gives an already poisoned enemy a dose, so no free Overdose', () => {
    useCombatStore.setState({ units: [blade(['venomTransfer']), poisoned('dead', 3, 0), poisoned('full', 4, 0, 'sb', 3)] });
    state().damageUnit('dead', 5000, 'sb');
    expect(poisonOn('full')?.stacks).toBe(3);
    expect(unitNow('full').currentHp).toBe(1000);
  });

  it('belongs to whoever laid the pile’s latest dose, and to nobody without the node', () => {
    useCombatStore.setState({
      units: [blade(['venomTransfer']), blade([], { id: 'other', position: at(-1, 0) }), poisoned('dead', 3, 0, 'other'), foe('near', 4, 0)],
    });
    state().damageUnit('dead', 5000, 'sb');
    expect(poisonOn('near')).toBeUndefined();
  });

  it('passes on once between the owner’s regular turns, so a death cannot chain', () => {
    useCombatStore.setState({
      units: [blade(['venomTransfer']), poisoned('one', 3, 0), poisoned('two', 0, 3), foe('near1', 4, 0), foe('near2', 0, 4)],
    });
    state().damageUnit('one', 5000, 'sb');
    state().damageUnit('two', 5000, 'sb');
    expect(poisonOn('near1')).toBeDefined();
    expect(poisonOn('near2')).toBeUndefined();
  });

  it('reaches no further than its range', () => {
    useCombatStore.setState({ units: [blade(['venomTransfer']), poisoned('dead', 0, 3), foe('away', 0, 3 + BALANCE.VENOM_TRANSFER_RANGE + 1)] });
    state().damageUnit('dead', 5000, 'sb');
    expect(poisonOn('away')).toBeUndefined();
  });

  it('leaves ordinary Poison on its clock: nothing halts the decay any more', () => {
    useCombatStore.setState({ units: [blade(['venomTransfer']), poisoned('a', 3, 0)] });
    state().tickEffectsOnUnit('a');
    expect(poisonOn('a')?.duration).toBe(2);
  });
});

// ─── The dose count on the model ──────────────────────────────────────────────

describe('Poison doses on the model', () => {
  it('reads one, two, three doses, never a fourth, and none after an Overdose spends them', () => {
    useCombatStore.setState({ units: [blade([]), foe('a', 1, 0)] });
    expect(poisonDoses(unitNow('a'))).toBe(0);
    for (const expected of [1, 2, 3, 0, 1]) {
      state().applyEffect('a', { type: AfflictionType.Poison, magnitude: 10, duration: 3, sourceUnitId: 'sb' });
      expect(poisonDoses(unitNow('a'))).toBe(expected);
    }
    state().removeAllAfflictions('a');
    expect(poisonDoses(unitNow('a'))).toBe(0);
  });
});

// ─── Assassinate ──────────────────────────────────────────────────────────────

describe('Assassinate', () => {
  it('marks an enemy at any range and deals nothing', () => {
    useCombatStore.setState({ units: [blade([]), foe('a', 3, -5)] });
    const result = resolveSkillUse(unitNow('sb'), assassinate, at(3, -5), SILENT_SINK);
    expect(result.ok).toBe(true);
    expect(unitNow('a').currentHp).toBe(1000);
    expect(deathMarkFrom(unitNow('a'), 'sb')?.duration).toBe(BALANCE.DEATH_MARK_TURNS);
  });

  it('needs no poison and no wound any more', () => {
    expect(assassinate.requiresTarget).toBeUndefined();
    expect(assassinate.damage ?? 0).toBe(0);
  });

  it('keeps one mark per Shadowblade: a recast moves it', () => {
    useCombatStore.setState({ units: [blade([]), foe('a', 3, 0), foe('b', 0, 3)] });
    resolveSkillUse(unitNow('sb'), assassinate, at(3, 0), SILENT_SINK);
    useCombatStore.setState((s) => ({ units: s.units.map((u) => ({ ...u, cooldowns: {} })) }));
    resolveSkillUse(unitNow('sb'), assassinate, at(0, 3), SILENT_SINK);
    expect(deathMarkFrom(unitNow('a'))).toBeUndefined();
    expect(deathMarkFrom(unitNow('b'), 'sb')).toBeDefined();
  });

  it('makes the marked enemy take more direct damage from anyone', () => {
    const striker = blade([], { id: 'ally' });
    const plain = foe('a', 1, 0);
    const marked = foe('b', 1, 0, { activeEffects: [{ type: AfflictionType.DeathMark, magnitude: BALANCE.DEATH_MARK_BONUS, duration: 3, sourceUnitId: 'sb' }] });
    const hit = (target: CombatUnit) => calculateDamage(striker, target, venomedBlades);
    expect(hit(marked)).toBeGreaterThan(hit(plain));
  });

  it('blinks to an eligible victim and finishes it before the turn, keeping the action', () => {
    useCombatStore.setState({ units: [blade([]), foe('a', 2, -4), foe('b', -3, 0)] });
    resolveSkillUse(unitNow('sb'), assassinate, at(2, -4), SILENT_SINK);
    const line = deathMarkThreshold(unitNow('sb'), unitNow('a'));
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'a' ? { ...u, currentHp: line } : u)) }));
    const verdict = beginTurn('sb', SILENT_SINK);
    expect(verdict.kind).toBe('act');
    expect(unitNow('a').currentHp).toBe(0);
    expect(Math.max(Math.abs(unitNow('sb').position.q - 2), Math.abs(unitNow('sb').position.r + 4),
      Math.abs(unitNow('sb').position.q + unitNow('sb').position.r + 2))).toBe(1);
    expect(unitNow('sb').hasActed).toBe(false);
    expect(unitNow('sb').activeEffects.some((e) => e.type === AuraType.Stealth)).toBe(true);
  });

  it('counts down above the line and fades after its turns', () => {
    useCombatStore.setState({ units: [blade([]), foe('a', 2, -4)] });
    resolveSkillUse(unitNow('sb'), assassinate, at(2, -4), SILENT_SINK);
    for (let left = BALANCE.DEATH_MARK_TURNS - 1; left >= 1; left--) {
      beginTurn('sb', SILENT_SINK);
      expect(deathMarkFrom(unitNow('a'))?.duration).toBe(left);
    }
    beginTurn('sb', SILENT_SINK);
    expect(deathMarkFrom(unitNow('a'))).toBeUndefined();
    expect(unitNow('a').currentHp).toBe(1000);
  });

  it('is counted on the Shadowblade’s turns, not the victim’s', () => {
    useCombatStore.setState({ units: [blade([]), foe('a', 2, -4)] });
    resolveSkillUse(unitNow('sb'), assassinate, at(2, -4), SILENT_SINK);
    state().tickEffectsOnUnit('a');
    expect(deathMarkFrom(unitNow('a'))?.duration).toBe(BALANCE.DEATH_MARK_TURNS);
  });

  it('waits while the Shadowblade is Stunned, and when no hex beside the victim is free', () => {
    useCombatStore.setState({
      units: [blade([], { activeEffects: [{ type: AfflictionType.Stun, magnitude: 1, duration: 2 }] }), foe('a', 2, -4, { currentHp: 1 })],
    });
    state().applyEffect('a', { type: AfflictionType.DeathMark, magnitude: 0.1, duration: 3, sourceUnitId: 'sb' });
    expect(beginTurn('sb', SILENT_SINK).kind).toBe('stunned');
    expect(unitNow('a').currentHp).toBe(1);

    state().reset();
    const ring = [[3, -4], [1, -4], [2, -3], [2, -5], [3, -5], [1, -3]].map(([q, r], i) => foe(`w${i}`, q, r));
    useCombatStore.setState({ units: [blade([]), foe('a', 2, -4, { currentHp: 1 }), ...ring] });
    state().applyEffect('a', { type: AfflictionType.DeathMark, magnitude: 0.1, duration: 3, sourceUnitId: 'sb' });
    beginTurn('sb', SILENT_SINK);
    expect(unitNow('a').currentHp).toBe(1);
    expect(unitNow('sb').position).toEqual(at(0, 0));
    expect(deathMarkFrom(unitNow('a'))?.duration).toBe(2);
  });

  it('still respects Invulnerability: the mark is spent and the victim stands', () => {
    useCombatStore.setState({
      units: [blade([]), foe('a', 3, 0, { currentHp: 1, activeEffects: [{ type: AuraType.Invulnerability, magnitude: 1, duration: 3 }] })],
    });
    state().applyEffect('a', { type: AfflictionType.DeathMark, magnitude: 0.1, duration: 3, sourceUnitId: 'sb' });
    beginTurn('sb', SILENT_SINK);
    expect(unitNow('a').currentHp).toBe(1);
    expect(deathMarkFrom(unitNow('a'))).toBeUndefined();
  });

  it('goes with the Shadowblade when it falls', () => {
    useCombatStore.setState({ units: [blade([]), foe('a', 3, 0)] });
    state().applyEffect('a', { type: AfflictionType.DeathMark, magnitude: 0.1, duration: 3, sourceUnitId: 'sb' });
    state().damageUnit('sb', 5000, 'a');
    expect(deathMarkFrom(unitNow('a'))).toBeUndefined();
  });

  it('feeds Venom Transfer when the executed victim carried the Shadowblade’s Poison', () => {
    useCombatStore.setState({
      units: [blade(['venomTransfer']), foe('a', 2, -4, { currentHp: 1, activeEffects: [{ type: AfflictionType.Poison, magnitude: 20, duration: 3, stacks: 1, sourceUnitId: 'sb' }] }), foe('near', 3, -4)],
    });
    state().applyEffect('a', { type: AfflictionType.DeathMark, magnitude: 0.1, duration: 3, sourceUnitId: 'sb' });
    beginTurn('sb', SILENT_SINK);
    expect(unitNow('a').currentHp).toBe(0);
    expect(poisonOn('near')).toBeDefined();
  });
});
