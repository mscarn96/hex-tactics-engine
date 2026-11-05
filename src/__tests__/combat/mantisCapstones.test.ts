import { spyDice } from '../support/dice';
import { BALANCE } from '@/data/balanceConstants';
import { findMasteryPath } from '@/data/skills/masteryData';
import { flankShownIds } from '@/data/display/boardOverlays';
import {
  flickerCut, mantisExecution, mantisPounce, markedPrey, pinningCut, scythingStep, threefoldScythe,
} from '@/data/skills/mastery/mantis';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { MASTERY_STARTER_WEAPONS } from '@/data/items/itemTemplates';
import { useCombatStore } from '@/stores/combatStore';
import { arcHexes } from '@/systems/combat/arenaGeometry';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { chargeStage } from '@/systems/combat/chargedCast';
import { canUseSkill, skillUsability } from '@/systems/combat/cooldowns';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { hexesBehind } from '@/systems/combat/facing';
import { heldMark, markPending, markedPreyCut, scytheLocked } from '@/systems/combat/mantis';
import { CombatSink, resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { beginTurn } from '@/systems/combat/turnStart';
import { extraTurnCause } from '@/systems/combat/turnTempo';
import { playerUnitFor } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { itemFromTemplateId } from '@/systems/economy/itemFactory';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { canUnlockNode, deriveHeroSkills } from '@/systems/progression/mastery';
import {
  AfflictionType, AuraType, CombatUnit, Hero, HeroClass, HexCoord, HexDirection, Item, SkillId,
} from '@/models/types';
import { at, makeFoe, makeHero, makeStats, resetFixtureIds } from '../support/fixtures';

/**
 * The Mantis's three capstones (the private project notes, "### Mantis"): Marked
 * Prey, Threefold Scythe and Mantis Execution, as rules driven through
 * `resolveSkillUse` and the store's turn hand-over. Pinned against `BALANCE.MANTIS`,
 * not against numbers.
 */

const M = BALANCE.MANTIS;
const path = findMasteryPath('mantis')!;
const template = heroTemplates.find((t) => t.id === 'monk')!;
const state = () => useCombatStore.getState();
const unit = (id: string) => requireUnit(state().units, id);
const bleed = (id: string) => unit(id).activeEffects.find((e) => e.type === AfflictionType.Bleed);
const lost = (id: string) => unit(id).stats.maxHp - unit(id).currentHp;

const item = (templateId: string): Item => {
  const made = itemFromTemplateId(templateId);
  if (!made) throw new Error(`no template ${templateId}`);
  return made;
};

/**
 * A level-15 Mantis holding every node of its main pyramid at rank 2 — all three
 * capstones, which no build can. The side trees, which change every Bleed, are
 * `mantisSideTrees.test.ts`'s.
 */
function mantisHero(): Hero {
  const hero = makeHero({
    templateId: 'monk', heroClass: HeroClass.Monk, level: 15, masteryPath: 'mantis',
    masteryNodes: Object.fromEntries(path.nodes.filter((n) => !n.sideTree && n.tier < 4).map((n) => [n.id, 2])),
    baseStats: calculateStatsForLevel(template, 15),
  });
  return { ...hero, skills: deriveHeroSkills(hero, template.skills) };
}

/** The Mantis with its two handblades at (0,0), the one whose turn it is, and its foes. */
function field(foes: CombatUnit[]): void {
  state().reset();
  const blade = MASTERY_STARTER_WEAPONS.mantis;
  const mantis = playerUnitFor(mantisHero(), { mainHand: item(blade.mainHand), offHand: item(blade.offHand!) }, { id: 'mantis', position: at(0, 0) });
  state().initCombat([mantis], foes);
  useCombatStore.setState({ currentUnitId: 'mantis', bonusTurn: { pending: null, active: false } });
}

/** A dummy that does not dodge or answer, facing `facing` (west, toward the Mantis, by default). */
const dummy = (id: string, q: number, r: number, facing: HexDirection = 3, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: makeStats({ maxHp: 5000, defense: 0, dodgeChance: 0 }), ...over, facing });

/** Deployment turns everyone toward the foe; this points each dummy back where it was told to look. */
function face(id: string, facing: HexDirection): void {
  useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === id ? { ...u, facing } : u)) }));
}

const skillOf = (id: SkillId) => unit('mantis').skills.find((s) => s.id === id)!;
/** The button as the HUD shows it: the release or the stage while one is due. */
const button = (id: SkillId) => chargeStage(unit('mantis'), skillOf(id));
const cast = (id: SkillId, target: HexCoord, sink: CombatSink = SILENT_SINK) =>
  resolveSkillUse(unit('mantis'), skillOf(id), target, sink);

const recorder = () => {
  const floats: { at: HexCoord; text: string }[] = [];
  const sink: CombatSink = { ...SILENT_SINK, float: (where: HexCoord, text: string) => { floats.push({ at: where, text }); } };
  return { sink, floats };
};
const hitsOn = (floats: { at: HexCoord; text: string }[], where: HexCoord) =>
  floats.filter((f) => f.at.q === where.q && f.at.r === where.r && /^-\d+!?$/.test(f.text));

/** One regular turn start's worth of the Mantis's clock: its effects tick. */
const nextRegularTurn = () => state().tickEffectsOnUnit('mantis');

beforeEach(() => {
  resetFixtureIds();
  // 0.5 is never a dodge against a dummy and never a natural crit for the Mantis
  spyDice().mockReturnValue(0.5);
});

afterEach(() => jest.restoreAllMocks());

// ─── The tier ────────────────────────────────────────────────────────────────

describe('the Mantis capstones', () => {
  const capstones = path.nodes.filter((n) => n.tier === 3 && !n.sideTree);

  it('are three exclusive tier-3 nodes granting Marked Prey, Threefold Scythe and Mantis Execution', () => {
    expect(capstones.map((n) => n.grantsSkill)).toEqual(['marked_prey', 'threefold_scythe', 'mantis_execution']);
    expect(capstones.every((n) => n.exclusiveGroup === 'capstone')).toBe(true);
  });

  it('exclude each other: holding one refuses the other two', () => {
    const below = Object.fromEntries(path.nodes.filter((n) => n.tier < 3 && !n.sideTree).map((n) => [n.id, 1]));
    for (const held of capstones) {
      const hero = { ...mantisHero(), masteryNodes: { ...below, [held.id]: 1 }, masteryPoints: 5 };
      for (const other of capstones.filter((n) => n !== held)) expect(canUnlockNode(hero, other.id).ok).toBe(false);
    }
  });

  // A free capstone would collapse the chi loop: one capstone and one regular spell empty the
  // pool — a full pool pays the capstone and the cheapest spell, and any capstone and spell
  // leave less than a signature behind
  it('cost chi, more than any active, and a capstone and a spell empty the pool', () => {
    const actives = [scythingStep, flickerCut, pinningCut, mantisPounce];
    const cheapest = Math.min(...actives.map((a) => a.manaCost));
    for (const capstone of [markedPrey, threefoldScythe, mantisExecution]) {
      expect(capstone.manaCost).toBe(BALANCE.CHI.CAPSTONE);
      for (const active of actives) expect(capstone.manaCost).toBeGreaterThan(active.manaCost);
      expect(capstone.manaCost + cheapest).toBeLessThanOrEqual(BALANCE.CHI.POOL);
      for (const active of actives) {
        expect(BALANCE.CHI.POOL - capstone.manaCost - active.manaCost).toBeLessThan(BALANCE.CHI.SIGNATURE);
      }
    }
  });
});

// ─── Marked Prey ─────────────────────────────────────────────────────────────

describe('Marked Prey', () => {
  it('marks an enemy within reach, deals nothing, pays chi and starts no cooldown', () => {
    field([dummy('prey', 3, 0), dummy('far', 3, -2)]);
    state().moveUnit('mantis', at(-3, 5));
    expect(M.MARK_RANGE).toBeLessThan(7);
    const before = unit('mantis').currentMana;
    expect(cast('marked_prey', at(3, -2)).ok).toBe(false);
    state().moveUnit('mantis', at(0, 0));
    expect(cast('marked_prey', at(3, 0)).ok).toBe(true);
    expect(heldMark(unit('mantis'))?.aimAt).toBe('prey');
    expect(lost('prey')).toBe(0);
    expect(unit('mantis').currentMana).toBe(before - markedPrey.manaCost);
    expect(unit('mantis').cooldowns?.marked_prey).toBeUndefined();
  });

  it('locks nothing: moving, other skills and the Basic Attack leave the mark standing', () => {
    field([dummy('prey', 3, 0), dummy('other', 0, 1)]);
    cast('marked_prey', at(3, 0));
    nextRegularTurn();
    for (const id of [BASIC_ATTACK_ID, 'twin_reap', 'mantis_pounce'] as SkillId[]) {
      expect(skillUsability(unit('mantis'), skillOf(id))).toEqual({ ok: true });
    }
    state().moveUnit('mantis', at(-1, 0));
    expect(heldMark(unit('mantis'))?.aimAt).toBe('prey');
    state().moveUnit('mantis', at(0, 0));
    expect(cast(BASIC_ATTACK_ID as SkillId, at(0, 1)).ok).toBe(true);
    expect(heldMark(unit('mantis'))?.aimAt).toBe('prey');
  });

  it('is released on the next turn, not the turn it was laid', () => {
    field([dummy('prey', 3, 0)]);
    cast('marked_prey', at(3, 0));
    expect(button('marked_prey').mantisStage).toBe('release');
    expect(skillUsability(unit('mantis'), button('marked_prey'))).toMatchObject({ ok: false, reason: markPending() });
    expect(cast('marked_prey', at(3, 0)).ok).toBe(false);
    nextRegularTurn();
    expect(canUseSkill(unit('mantis'), button('marked_prey'))).toBe(true);
    // The release reaches the prey wherever it stands, and nobody else
    expect(getValidSkillTargetHexes(button('marked_prey'), unit('mantis'), state().units)).toEqual([at(3, 0)]);
  });

  it('is released on a bonus turn taken after the mark, which arms it without ticking it (PT-15)', () => {
    field([dummy('prey', 3, 0)]);
    cast('marked_prey', at(3, 0));
    useCombatStore.setState({ currentUnitId: 'mantis', bonusTurn: { pending: null, active: true } });
    expect(beginTurn('mantis', SILENT_SINK).kind).toBe('act');
    expect(heldMark(unit('mantis'))?.duration).toBe(M.MARK_TURNS);
    expect(canUseSkill(unit('mantis'), button('marked_prey'))).toBe(true);
    useCombatStore.setState({ bonusTurn: { pending: null, active: false } });
  });

  it('can be released on either of the next two turns, and fades unreleased at the third', () => {
    field([dummy('prey', 3, 0)]);
    cast('marked_prey', at(3, 0));
    nextRegularTurn();
    nextRegularTurn();
    expect(canUseSkill(unit('mantis'), button('marked_prey'))).toBe(true);
    nextRegularTurn();
    expect(heldMark(unit('mantis'))).toBeUndefined();
    // The button is the mark again, ready: the cooldown runs from a release (chi topped up,
    // since what is pinned is the cooldown, not whether three turns' regen repays a mark)
    expect(button('marked_prey').mantisStage).toBeUndefined();
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'mantis' ? { ...u, currentMana: u.stats.maxMana } : u)) }));
    expect(canUseSkill(unit('mantis'), button('marked_prey'))).toBe(true);
  });

  it('counts what the prey loses from any source since the mark', () => {
    field([dummy('prey', 3, 0)]);
    state().damageUnit('prey', 50);
    cast('marked_prey', at(3, 0));
    const before = lost('prey');
    state().damageUnit('prey', 120);
    state().damageUnit('prey', 30, 'mantis');
    expect(heldMark(unit('mantis'))?.stored).toBe(lost('prey') - before);
    expect(heldMark(unit('mantis'))?.stored).toBeGreaterThan(0);
  });

  it('blinks behind the prey, lands a certain critical Basic Attack, reaps a share of what it lost, and blinks back', () => {
    field([dummy('prey', 2, 0)]);
    cast('marked_prey', at(2, 0));
    state().damageUnit('prey', 200);
    const taken = lost('prey');
    nextRegularTurn();
    const [back] = hexesBehind(unit('prey'));
    const lostBefore = lost('prey');
    const { sink, floats } = recorder();
    const moves: HexCoord[] = [];
    const move = state().moveUnit;
    useCombatStore.setState({ moveUnit: (id, to, ...rest) => { if (id === 'mantis') moves.push(to); return move(id, to, ...rest); } });

    expect(resolveSkillUse(unit('mantis'), skillOf('marked_prey'), at(2, 0), sink).ok).toBe(true);
    useCombatStore.setState({ moveUnit: move });
    expect(moves).toEqual([back, at(0, 0)]);
    expect(unit('mantis').position).toEqual(at(0, 0));

    const [first, second] = hitsOn(floats, at(2, 0)).map((f) => f.text);
    expect(first.endsWith('!')).toBe(true);
    const crit = Number(first.slice(1, -1));
    const cut = Number(second.slice(1));
    expect(cut).toBe(Math.round((taken + crit) * M.MARK_SHARE));
    expect(lost('prey')).toBe(lostBefore + crit + cut);
    // Spent: the mark is gone and the cooldown runs from now
    expect(heldMark(unit('mantis'))).toBeUndefined();
    expect(unit('mantis').cooldowns?.marked_prey).toBe(markedPrey.cooldown! + 1);
  });

  it('caps the second cut at a multiple of Attack', () => {
    field([dummy('prey', 3, 0)]);
    cast('marked_prey', at(3, 0));
    state().damageUnit('prey', 4000);
    nextRegularTurn();
    const attack = getCombatEffectiveStats(unit('mantis')).attack;
    const { sink, floats } = recorder();
    cast('marked_prey', at(3, 0), sink);
    const [, second] = hitsOn(floats, at(3, 0)).map((f) => f.text);
    expect(Number(second.slice(1))).toBe(Math.round(M.MARK_CAP * attack));
    expect(markedPreyCut({ stored: 4000 }, attack)).toBe(Math.round(M.MARK_CAP * attack));
  });

  it('strikes only the prey it marked, and drops a mark whose prey has fallen', () => {
    field([dummy('prey', 3, 0), dummy('other', 1, 0)]);
    cast('marked_prey', at(3, 0));
    nextRegularTurn();
    expect(cast('marked_prey', at(1, 0)).ok).toBe(false);
    state().damageUnit('prey', 99999);
    useCombatStore.setState({ currentUnitId: 'mantis' });
    beginTurn('mantis', SILENT_SINK);
    expect(heldMark(unit('mantis'))).toBeUndefined();
  });

  it('refuses to blink in while Rooted', () => {
    field([dummy('far', 3, -1)]);
    cast('marked_prey', at(3, -1));
    nextRegularTurn();
    state().applyEffect('mantis', { type: AfflictionType.Root, magnitude: 1, duration: 5 });
    expect(cast('marked_prey', at(3, -1)).refusal).toBe('rooted');
  });
});

// ─── Threefold Scythe ────────────────────────────────────────────────────────

describe('Threefold Scythe', () => {
  // The prey east of the Mantis; a second enemy in the three-hex arc that way and a
  // third in the eight-hex arc only
  const near = arcHexes({ aoeRadius: 1 }, at(0, 0), at(1, 0)).find((h) => !(h.q === 1 && h.r === 0))!;
  const far = arcHexes({ aoeRadius: 2 }, at(0, 0), at(1, 0))
    .find((h) => !arcHexes({ aoeRadius: 1 }, at(0, 0), at(1, 0)).some((x) => x.q === h.q && x.r === h.r))!;
  const setup = () => {
    field([dummy('prey', 1, 0), dummy('near', near.q, near.r), dummy('far', far.q, far.r), dummy('later', 5, 3)]);
    useCombatStore.setState({ turnOrder: ['mantis', 'later', 'prey', 'near', 'far'] });
  };

  it('launches with a cut, pays chi once and starts the cooldown', () => {
    setup();
    const before = unit('mantis').currentMana;
    expect(cast('threefold_scythe', at(1, 0)).ok).toBe(true);
    expect(lost('prey')).toBeGreaterThan(0);
    expect(lost('near')).toBe(0);
    expect(unit('mantis').currentMana).toBe(before - threefoldScythe.manaCost);
    expect(unit('mantis').cooldowns?.threefold_scythe).toBe(threefoldScythe.cooldown! + 1);
  });

  it('plays its three stages on three consecutive turns of the Mantis, with every other button refused', () => {
    setup();
    cast('threefold_scythe', at(1, 0));
    const chi = unit('mantis').currentMana;

    // Stage two: the same unit acts again at once, locked to the three-hex arc
    state().nextTurn();
    expect(state().currentUnitId).toBe('mantis');
    expect(extraTurnCause(state())).toBe('threefoldScythe');
    expect(unit('mantis').scytheStage).toBe(2);
    for (const id of [BASIC_ATTACK_ID, 'twin_reap', 'mantis_execution'] as SkillId[]) {
      expect(skillUsability(unit('mantis'), skillOf(id))).toMatchObject({ ok: false, reason: scytheLocked() });
      expect(cast(id, at(1, 0)).ok).toBe(false);
    }
    expect(button('threefold_scythe').mantisStage).toBe(2);
    const preyBefore = lost('prey');
    expect(cast('threefold_scythe', at(1, 0)).ok).toBe(true);
    expect(lost('prey')).toBeGreaterThan(preyBefore);
    expect(lost('near')).toBeGreaterThan(0);
    expect(lost('far')).toBe(0);

    // Stage three: the eight-hex arc, leaving every enemy hit Bleeding
    state().nextTurn();
    expect(state().currentUnitId).toBe('mantis');
    expect(unit('mantis').scytheStage).toBe(3);
    expect(cast('twin_reap', at(1, 0)).ok).toBe(false);
    expect(cast('threefold_scythe', at(1, 0)).ok).toBe(true);
    expect(lost('far')).toBeGreaterThan(0);
    for (const id of ['prey', 'near', 'far']) expect(bleed(id)).toBeDefined();

    // Paid once: the stages cost nothing and wait on no cooldown
    expect(unit('mantis').currentMana).toBe(chi);

    // Then the order moves on, and the lock is gone
    state().nextTurn();
    expect(state().currentUnitId).toBe('later');
    expect(unit('mantis').scytheStage).toBeUndefined();
    expect(unit('mantis').mantisTurns).toBeUndefined();
  });

  it('keeps the stage turns its own when one is passed: the next turn is still the next stage', () => {
    setup();
    cast('threefold_scythe', at(1, 0));
    state().nextTurn();
    state().nextTurn();
    expect(state().currentUnitId).toBe('mantis');
    expect(unit('mantis').scytheStage).toBe(3);
  });

  it('regenerates nothing on its stage turns', () => {
    setup();
    cast('threefold_scythe', at(1, 0));
    const chi = unit('mantis').currentMana;
    state().nextTurn();
    beginTurn('mantis', SILENT_SINK);
    expect(unit('mantis').currentMana).toBe(chi);
  });
});

// ─── Mantis Execution ────────────────────────────────────────────────────────

describe('Mantis Execution', () => {
  it('blinks behind an enemy within reach and cuts it five times, each its own roll', () => {
    field([dummy('prey', 2, 0)]);
    const [back] = hexesBehind(unit('prey'));
    const { sink, floats } = recorder();
    expect(cast('mantis_execution', at(2, 0), sink).ok).toBe(true);
    expect(unit('mantis').position).toEqual(back);
    expect(hitsOn(floats, at(2, 0))).toHaveLength(M.EXECUTION_CUTS);
    // Each cut rolls: with the dice low enough, every one is a critical
    spyDice().mockReturnValue(0);
    field([dummy('prey', 2, 0)]);
    const crits = recorder();
    cast('mantis_execution', at(2, 0), crits.sink);
    expect(hitsOn(crits.floats, at(2, 0)).every((f) => f.text.endsWith('!'))).toBe(true);
  });

  it('refuses an enemy out of reach', () => {
    field([dummy('prey', 0, M.EXECUTION_RANGE + 1)]);
    expect(cast('mantis_execution', at(0, M.EXECUTION_RANGE + 1)).ok).toBe(false);
  });

  it('starts its cooldown when the prey survives, and queues nothing', () => {
    field([dummy('prey', 3, 0), dummy('later', 5, 3)]);
    cast('mantis_execution', at(3, 0));
    expect(unit('mantis').cooldowns?.mantis_execution).toBe(mantisExecution.cooldown! + 1);
    expect(unit('mantis').mantisTurns).toBeUndefined();
  });

  it('grants a bonus turn at once on a kill, with the cooldown reset, and chi alone bounds the chain', () => {
    const weak = (id: string, q: number, r: number) => dummy(id, q, r, 3, { stats: makeStats({ maxHp: 5, defense: 0, dodgeChance: 0 }) });
    field([weak('a', 3, 0), weak('b', 2, 2), weak('c', 2, -2), dummy('later', 5, 3)]);
    useCombatStore.setState({ turnOrder: ['mantis', 'later', 'a', 'b', 'c'] });
    const pool = unit('mantis').currentMana;

    expect(cast('mantis_execution', at(3, 0)).ok).toBe(true);
    expect(unit('a').currentHp).toBe(0);
    expect(unit('mantis').cooldowns?.mantis_execution).toBeUndefined();
    state().nextTurn();
    expect(state().currentUnitId).toBe('mantis');
    expect(extraTurnCause(state())).toBe('mantisExecution');
    beginTurn('mantis', SILENT_SINK);
    // A bonus turn regenerates nothing, so every link of the chain is paid for in full
    expect(unit('mantis').currentMana).toBe(pool - mantisExecution.manaCost);

    const links = Math.floor(pool / mantisExecution.manaCost);
    const next = [at(2, 2), at(2, -2)];
    for (let i = 1; i < links; i++) {
      expect(cast('mantis_execution', next[i - 1]).ok).toBe(true);
      state().nextTurn();
    }
    // Out of chi with a kill still to make: no cooldown stops it, the pool does
    expect(unit('mantis').cooldowns?.mantis_execution).toBeUndefined();
    expect(unit('mantis').currentMana).toBeLessThan(mantisExecution.manaCost);
    expect(canUseSkill(unit('mantis'), skillOf('mantis_execution'))).toBe(false);
  });
});

// ─── On the board ────────────────────────────────────────────────────────────

describe('the capstones on the board', () => {
  it('tint the rear of every enemy a blink in behind could reach', () => {
    field([dummy('prey', 3, 0)]);
    face('prey', 3);
    const aiming = (skill: ReturnType<typeof button>) => flankShownIds(state().units, [], {
      caster: unit('mantis'), skill, lit: [at(3, 0)],
    });
    expect(aiming(button('mantis_execution'))).toEqual(['prey']);
    cast('marked_prey', at(3, 0));
    nextRegularTurn();
    expect(aiming(button('marked_prey'))).toEqual(['prey']);
  });

  it('show the mark on the Mantis while it stands', () => {
    field([dummy('prey', 3, 0)]);
    cast('marked_prey', at(3, 0));
    expect(unit('mantis').activeEffects.some((e) => e.type === AuraType.MarkedPrey)).toBe(true);
  });
});
