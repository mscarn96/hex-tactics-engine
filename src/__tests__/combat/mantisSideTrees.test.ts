import { nodeDescription } from '@/__tests__/support/masteryNodeText';
import { spyDice } from '../support/dice';
import { BALANCE } from '@/data/balanceConstants';
import { findMasteryPath } from '@/data/skills/masteryData';
import { flickerCut, mantisExecution, mantisPounce, markedPrey, pinningCut, scythingStep, threefoldScythe, twinReap } from '@/data/skills/mastery/mantis';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { MASTERY_STARTER_WEAPONS } from '@/data/items/itemTemplates';
import { nodeSimpleText, skillSimpleText } from '@/data/display/simpleText';
import { useCombatStore } from '@/stores/combatStore';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { applyOnMove } from '@/systems/combat/combatEvents';
import { masteryTargetMultiplier } from '@/systems/combat/damageCalc';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { CombatSink, resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { playerUnitFor } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { itemFromTemplateId } from '@/systems/economy/itemFactory';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { canUnlockNode, deriveHeroSkills, maxLevelOf, pointsEarnedByLevel } from '@/systems/progression/mastery';
import {
  AfflictionType, AuraType, CombatUnit, Hero, HeroClass, HexCoord, HexDirection, Item, SkillId,
} from '@/models/types';
import { at, makeFoe, makeHero, makeStats, resetFixtureIds } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * The Mantis's two side trees (the private project notes, "### Mantis"): Bleed
 * Harvest with Fresh Kill and Evasive Weave, Deep Cuts with Haemorrhage and Scent
 * of Blood — as rules, each held against a twin without the node in a fight driven
 * through `resolveSkillUse`. Then the whole tree's economy, walked as a build, and
 * its copy. Pinned against `BALANCE.MANTIS`, not against numbers.
 */

const path = findMasteryPath('mantis')!;
const template = heroTemplates.find((t) => t.id === 'monk')!;
const state = () => useCombatStore.getState();
const unit = (id: string) => requireUnit(state().units, id);
const bleed = (id: string) => unit(id).activeEffects.find((e) => e.type === AfflictionType.Bleed);

/** The main pyramid at rank 2 (all three capstones, which no build can), plus `side`. */
const MAIN = Object.fromEntries(path.nodes.filter((n) => !n.sideTree && n.tier < 4).map((n) => [n.id, 2]));

function mantisHero(side: Record<string, number> = {}, main: Record<string, number> = MAIN): Hero {
  const hero = makeHero({
    templateId: 'monk', heroClass: HeroClass.Monk, level: 15, masteryPath: 'mantis',
    masteryNodes: { ...main, ...side },
    baseStats: calculateStatsForLevel(template, 15),
  });
  return { ...hero, skills: deriveHeroSkills(hero, template.skills) };
}

const item = (templateId: string): Item => {
  const made = itemFromTemplateId(templateId);
  if (!made) throw new Error(`no template ${templateId}`);
  return made;
};

function field(foes: CombatUnit[], hero: Hero, position: HexCoord = at(0, 0)): void {
  state().reset();
  const blade = MASTERY_STARTER_WEAPONS.mantis;
  const mantis = playerUnitFor(hero, { mainHand: item(blade.mainHand), offHand: item(blade.offHand!) }, { id: 'mantis', position });
  state().initCombat([mantis], foes);
}

const dummy = (id: string, q: number, r: number, facing: HexDirection = 3, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: makeStats({ maxHp: 5000, defense: 0, dodgeChance: 0 }), ...over, facing });

const skillOf = (id: SkillId) => unit('mantis').skills.find((s) => s.id === id)!;
const cast = (id: SkillId, target: HexCoord, sink: CombatSink = SILENT_SINK) =>
  resolveSkillUse(unit('mantis'), skillOf(id), target, sink);
const basic = (target: HexCoord) => cast(BASIC_ATTACK_ID as SkillId, target);

beforeEach(() => {
  resetFixtureIds();
  // 0.5 is never a dodge against a dummy and never a natural crit for the Mantis
  spyDice().mockReturnValue(0.5);
});

afterEach(() => jest.restoreAllMocks());

// ─── The shape ───────────────────────────────────────────────────────────────

describe('the Mantis side trees', () => {
  const starters = path.nodes.filter((n) => n.exclusiveGroup === 'side');
  const childrenOf = (id: string) => path.nodes.filter((n) => (n.requires ?? []).includes(id));

  it('open with Bleed Harvest and Deep Cuts, one rank each, on any capstone point', () => {
    expect(starters.map((n) => n.id)).toEqual(['mantis_bleed_harvest', 'mantis_deep_cuts']);
    const capstones = path.nodes.filter((n) => n.exclusiveGroup === 'capstone').map((n) => n.id);
    for (const starter of starters) {
      expect(maxLevelOf(starter)).toBe(1);
      expect(starter.requires).toEqual(capstones);
      expect(starter.requiresCount).toBe(1);
    }
    expect(childrenOf('mantis_bleed_harvest').map((n) => n.id)).toEqual(['mantis_fresh_kill', 'mantis_evasive_weave']);
    expect(childrenOf('mantis_deep_cuts').map((n) => n.id)).toEqual(['mantis_haemorrhage', 'mantis_scent_of_blood']);
  });
});

// ─── The economy, walked ─────────────────────────────────────────────────────

describe('a full Mantis build', () => {
  /** Buy `levels` of `id`, one point at a time, each refused or allowed as the rules say. */
  const buy = (hero: Hero, id: string, levels: number): Hero => {
    let next = hero;
    for (let i = 0; i < levels; i++) {
      expect({ id, check: canUnlockNode(next, id) }).toEqual({ id, check: { ok: true } });
      next = {
        ...next,
        masteryPoints: next.masteryPoints - 1,
        masteryNodes: { ...next.masteryNodes, [id]: (next.masteryNodes[id] ?? 0) + 1 },
      };
    }
    return next;
  };

  it('reaches a capstone on six points, and spends exactly fifteen on a capstone, its ranks and a side tree', () => {
    const budget = pointsEarnedByLevel(BALANCE.MAX_LEVEL, 'mantis');
    expect(budget).toBe(15);
    let hero: Hero = { ...mantisHero({}, {}), masteryPoints: budget };
    // Mantis Execution sits over Pinning Cut and Pounce, and they over the last three feeders
    for (const id of ['mantis_reaping_momentum', 'mantis_predators_breath', 'mantis_light_frame']) hero = buy(hero, id, 1);
    for (const id of ['mantis_pinning_cut', 'mantis_pounce']) hero = buy(hero, id, 1);
    hero = buy(hero, 'mantis_execution', 1);
    expect(budget - hero.masteryPoints).toBe(6);
    hero = buy(hero, 'mantis_execution', 2);
    hero = buy(hero, 'mantis_bleed_harvest', 1);
    hero = buy(hero, 'mantis_fresh_kill', 3);
    hero = buy(hero, 'mantis_evasive_weave', 3);
    expect(hero.masteryPoints).toBe(0);
    // One side tree, never both
    expect(canUnlockNode({ ...hero, masteryPoints: 1 }, 'mantis_deep_cuts').ok).toBe(false);
  });
});

// ─── Side A: Bleed Harvest ───────────────────────────────────────────────────

describe('Bleed Harvest', () => {
  /** HP the foe loses to a Twin Reap on the Bleed a Basic Attack laid, and the Bleed reaped. */
  const reap = (hero: Hero) => {
    field([dummy('foe', 1, 0)], hero);
    basic(at(1, 0));
    const wound = bleed('foe')!;
    const before = unit('foe').currentHp;
    cast('twin_reap', at(1, 0));
    return { lost: before - unit('foe').currentHp, wound };
  };

  it('makes the reaped Bleed deal everything it had left, at once, as the reap closes it', () => {
    const plain = reap(mantisHero());
    const harvest = reap(mantisHero({ mantis_execution: 1, mantis_bleed_harvest: 1 }));
    expect(bleed('foe')).toBeUndefined();
    expect(harvest.wound.duration).toBe(BALANCE.MANTIS.BLEED_TURNS);
    expect(harvest.lost - plain.lost).toBe(harvest.wound.magnitude * harvest.wound.duration);
  });

  it('pays nothing on a Twin Reap with no Bleed to reap', () => {
    const lost = (hero: Hero) => {
      field([dummy('foe', 1, 0)], hero);
      const before = unit('foe').currentHp;
      cast('twin_reap', at(1, 0));
      return before - unit('foe').currentHp;
    };
    expect(lost(mantisHero({ mantis_execution: 1, mantis_bleed_harvest: 1 }))).toBe(lost(mantisHero()));
  });
});

describe('Fresh Kill', () => {
  /** Chi left after a Flicker Cut that kills its prey, from a half-empty pool. */
  const chiAfterKill = (hero: Hero) => {
    field([dummy('foe', 1, 0, 3, { stats: makeStats({ maxHp: 1, defense: 0, dodgeChance: 0 }) })], hero);
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'mantis' ? { ...u, currentMana: 30 } : u)) }));
    cast('flicker_cut', at(1, 0));
    expect(unit('foe').currentHp).toBe(0);
    return unit('mantis').currentMana;
  };

  it('restores chi on a kill, by rank', () => {
    const side = (rank: number) => ({ mantis_execution: 1, mantis_bleed_harvest: 1, mantis_fresh_kill: rank });
    const plain = chiAfterKill(mantisHero());
    expect(chiAfterKill(mantisHero(side(2))) - plain).toBe(BALANCE.MANTIS.FRESH_KILL_CHI);
    expect(chiAfterKill(mantisHero(side(1))) - plain).toBeLessThan(BALANCE.MANTIS.FRESH_KILL_CHI);
    expect(chiAfterKill(mantisHero(side(3))) - plain).toBeGreaterThan(BALANCE.MANTIS.FRESH_KILL_CHI);
  });

  it('restores nothing on a blow that does not kill', () => {
    const left = (hero: Hero) => {
      field([dummy('foe', 1, 0)], hero);
      useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'mantis' ? { ...u, currentMana: 30 } : u)) }));
      cast('flicker_cut', at(1, 0));
      return unit('mantis').currentMana;
    };
    expect(left(mantisHero({ mantis_execution: 1, mantis_bleed_harvest: 1, mantis_fresh_kill: 2 }))).toBe(left(mantisHero()));
  });
});

describe('Evasive Weave', () => {
  const weaver = () => mantisHero({ mantis_execution: 1, mantis_bleed_harvest: 1, mantis_evasive_weave: 2 });

  it('adds Dodge after a move, held through the enemies’ turns and gone at the Mantis’s next', () => {
    field([dummy('foe', 4, 0)], weaver());
    const still = getCombatEffectiveStats(unit('mantis')).dodgeChance ?? BALANCE.BASE_DODGE;
    state().moveUnit('mantis', at(1, 0), 'walk', true);
    applyOnMove(unit('mantis'));
    expect(getCombatEffectiveStats(unit('mantis')).dodgeChance).toBe(still + BALANCE.MANTIS.EVASIVE_WEAVE_DODGE);
    // The Mantis's next turn begins: the weave is spent until it moves again
    state().tickEffectsOnUnit('mantis');
    expect(getCombatEffectiveStats(unit('mantis')).dodgeChance ?? BALANCE.BASE_DODGE).toBe(still);
  });

  it('adds nothing without the node, and nothing to a Mantis that stood still', () => {
    field([dummy('foe', 4, 0)], mantisHero());
    const still = getCombatEffectiveStats(unit('mantis')).dodgeChance;
    applyOnMove(unit('mantis'));
    expect(getCombatEffectiveStats(unit('mantis')).dodgeChance).toBe(still);
    field([dummy('foe', 4, 0)], weaver());
    expect(unit('mantis').activeEffects.some((e) => e.type === AuraType.Evasive)).toBe(false);
  });
});

// ─── Side B: Deep Cuts ───────────────────────────────────────────────────────

describe('Deep Cuts', () => {
  const deep = () => mantisHero({ mantis_execution: 1, mantis_deep_cuts: 1 });

  it('makes every Bleed the Mantis lays last longer — the Basic Attack’s and a skill’s', () => {
    field([dummy('foe', 1, 0), dummy('far', 0, 2)], deep());
    basic(at(1, 0));
    expect(bleed('foe')?.duration).toBe(BALANCE.MANTIS.BLEED_TURNS + BALANCE.MANTIS.DEEP_CUTS_TURNS);
    cast('scything_step', at(0, 2));
    const authored = skillOf('scything_step');
    const laid = (Array.isArray(authored.appliesEffect) ? authored.appliesEffect : [authored.appliesEffect])
      .find((e) => e?.type === AfflictionType.Bleed)!;
    expect(bleed('far')?.duration).toBe(laid.duration + BALANCE.MANTIS.DEEP_CUTS_TURNS);
  });

  it('leaves Bleeds without the node, and anyone else’s Bleed, as they were', () => {
    field([dummy('foe', 1, 0)], mantisHero());
    basic(at(1, 0));
    expect(bleed('foe')?.duration).toBe(BALANCE.MANTIS.BLEED_TURNS);
    field([dummy('foe', 1, 0)], deep());
    state().applyEffect('foe', { type: AfflictionType.Bleed, magnitude: 3, duration: 2, sourceUnitId: 'someone' });
    expect(bleed('foe')?.duration).toBe(2);
  });
});

describe('Haemorrhage', () => {
  it('makes the Mantis’s Bleeds tick harder, by rank', () => {
    const tick = (rank: number) => {
      const side: Record<string, number> = rank ? { mantis_execution: 1, mantis_deep_cuts: 1, mantis_haemorrhage: rank } : {};
      field([dummy('foe', 1, 0)], mantisHero(side));
      basic(at(1, 0));
      return bleed('foe')!.magnitude;
    };
    const plain = tick(0);
    expect(tick(2)).toBe(Math.round(plain * (1 + BALANCE.MANTIS.HAEMORRHAGE)));
    expect(tick(1)).toBeLessThan(tick(2));
    expect(tick(3)).toBeGreaterThan(tick(2));
  });
});

describe('Scent of Blood', () => {
  const scent = () => mantisHero({ mantis_execution: 1, mantis_deep_cuts: 1, mantis_scent_of_blood: 2 });

  it('adds damage against a Bleeding enemy and nothing against a clean one', () => {
    field([dummy('foe', 1, 0)], scent());
    expect(masteryTargetMultiplier(unit('mantis'), unit('foe'))).toBe(1);
    basic(at(1, 0));
    expect(masteryTargetMultiplier(unit('mantis'), unit('foe'))).toBeCloseTo(1 + BALANCE.MANTIS.SCENT_OF_BLOOD);
  });

  it('reaches a cut in a fight: Pinning Cut hits a Bleeding enemy harder than its twin without the node', () => {
    const cutOnBleeding = (hero: Hero) => {
      field([dummy('foe', 1, 0)], hero);
      state().applyEffect('foe', { type: AfflictionType.Bleed, magnitude: 1, duration: 3, sourceUnitId: 'someone' });
      const before = unit('foe').currentHp;
      cast('pinning_cut', at(1, 0));
      return before - unit('foe').currentHp;
    };
    expect(cutOnBleeding(scent())).toBeGreaterThan(cutOnBleeding(mantisHero()));
  });
});

// ─── Copy ────────────────────────────────────────────────────────────────────

describe('Mantis copy', () => {
  const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/).length;

  it('gives every node a Simple line of at most two sentences, at every rank it holds', () => {
    for (const node of path.nodes) {
      for (let rank = 1; rank <= maxLevelOf(node); rank++) {
        const text = nodeSimpleText(node, rank);
        expect({ id: node.id, text }).toEqual({ id: node.id, text: expect.any(String) });
        // A melee skill's flank clause is a clause, not a third sentence
        expect({ id: node.id, n: sentences(text!) <= 3 }).toEqual({ id: node.id, n: true });
      }
    }
  });

  it('gives every Mantis skill a Simple line, and every node a detailed description', () => {
    for (const skill of [twinReap, scythingStep, flickerCut, pinningCut, mantisPounce, markedPrey, threefoldScythe, mantisExecution]) expect({ id: skill.id, text: skillSimpleText(skill) }).toEqual({ id: skill.id, text: expect.any(String) });
    for (const node of path.nodes) expect(masteryNodeDescription(node).length).toBeGreaterThan(10);
  });

  it('tells a Bleed Harvest holder what Twin Reap’s reap pays, and no one else', () => {
    field([dummy('foe', 1, 0)], mantisHero({ mantis_execution: 1, mantis_bleed_harvest: 1 }));
    expect(skillSimpleText(twinReap, unit('mantis'))).toMatch(/remaining damage at once/);
    field([dummy('foe', 1, 0)], mantisHero());
    expect(skillSimpleText(twinReap, unit('mantis'))).not.toMatch(/remaining damage/);
  });

  it('states the side trees’ figures at the rank shown', () => {
    const node = (id: string) => path.nodes.find((n) => n.id === id)!;
    expect(nodeSimpleText(node('mantis_fresh_kill'), 2)).toContain(`${BALANCE.MANTIS.FRESH_KILL_CHI} chi`);
    expect(nodeSimpleText(node('mantis_evasive_weave'), 2)).toContain(`+${BALANCE.MANTIS.EVASIVE_WEAVE_DODGE}%`);
    expect(nodeSimpleText(node('mantis_deep_cuts'), 1)).toMatch(/last \+1 turn/);
    expect(nodeSimpleText(node('mantis_haemorrhage'), 2)).toContain(`${Math.round(BALANCE.MANTIS.HAEMORRHAGE * 100)}%`);
    expect(nodeSimpleText(node('mantis_scent_of_blood'), 2)).toContain(`${Math.round(BALANCE.MANTIS.SCENT_OF_BLOOD * 100)}%`);
  });
});
