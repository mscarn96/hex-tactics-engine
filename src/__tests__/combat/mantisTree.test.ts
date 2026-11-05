import { spyDice } from '../support/dice';
import { BALANCE } from '@/data/balanceConstants';
import { findMasteryPath, masteriesForClass } from '@/data/skills/masteryData';
import { flickerCut, mantisPounce, pinningCut, scythingStep, twinReap } from '@/data/skills/mastery/mantis';
import { meditate } from '@/data/skills/skillData';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { MASTERY_STARTER_WEAPONS } from '@/data/items/itemTemplates';
import { useCombatStore } from '@/stores/combatStore';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { hexesBehind } from '@/systems/combat/facing';
import { momentumScale, reapStacks } from '@/systems/combat/mantis';
import { CombatSink, resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { cutOpenMultiplier } from '@/systems/combat/damageCalc';
import { playerUnitFor } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { itemFromTemplateId } from '@/systems/economy/itemFactory';
import { hexDistance } from '@/utils/hexUtils';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { canUnlockNode, deriveHeroSkills, masteryStatBonus } from '@/systems/progression/mastery';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import {
  AfflictionType, AuraType, CombatUnit, Hero, HeroClass, HexCoord, HexDirection, Item, SkillId,
} from '@/models/types';
import { at, makeFoe, makeHero, makeStats, resetFixtureIds } from '../support/fixtures';

/**
 * The Mantis's signature, feeders and actives (the private project notes,
 * "### Mantis"), as rules: every node buyable in tree order, and each one doing
 * what it says in a fight driven through `resolveSkillUse`. Pinned against
 * `BALANCE.MANTIS`, not against numbers.
 */

const path = findMasteryPath('mantis')!;
const template = heroTemplates.find((t) => t.id === 'monk')!;
const state = () => useCombatStore.getState();
const unit = (id: string) => requireUnit(state().units, id);
const bleed = (id: string) => unit(id).activeEffects.find((e) => e.type === AfflictionType.Bleed);

const item = (templateId: string): Item => {
  const made = itemFromTemplateId(templateId);
  if (!made) throw new Error(`no template ${templateId}`);
  return made;
};

/**
 * A level-15 Mantis holding every node of its main pyramid at rank 2 — all three
 * capstones too, which no build can. The side trees are left out: each changes the
 * Bleed these rules are pinned on (`mantisSideTrees.test.ts` holds them).
 */
function mantisHero(nodes: Record<string, number> = Object.fromEntries(path.nodes.filter((n) => !n.sideTree && n.tier < 4).map((n) => [n.id, 2]))): Hero {
  const hero = makeHero({
    templateId: 'monk',
    heroClass: HeroClass.Monk,
    level: 15,
    masteryPath: 'mantis',
    masteryNodes: nodes,
    baseStats: calculateStatsForLevel(template, 15),
  });
  return { ...hero, skills: deriveHeroSkills(hero, template.skills) };
}

/** The hero fielded with its two iron handblades, and its foes. */
function field(foes: CombatUnit[], hero = mantisHero(), position: HexCoord = at(0, 0)): void {
  state().reset();
  const blade = MASTERY_STARTER_WEAPONS.mantis;
  const mantis = playerUnitFor(hero, { mainHand: item(blade.mainHand), offHand: item(blade.offHand!) }, { id: 'mantis', position });
  state().initCombat([mantis], foes);
}

/** A dummy that does not die, dodge or answer, facing `facing`. */
const dummy = (id: string, q: number, r: number, facing: HexDirection = 3, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: makeStats({ maxHp: 5000, defense: 0, dodgeChance: 0 }), ...over, facing });

/** Points the dummy back where it was told to look: deployment turns everyone toward the foe. */
function face(id: string, facing: HexDirection): void {
  useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === id ? { ...u, facing } : u)) }));
}

const skillOf = (id: SkillId) => unit('mantis').skills.find((s) => s.id === id)!;
const cast = (id: SkillId, target: HexCoord, sink: CombatSink = SILENT_SINK) =>
  resolveSkillUse(unit('mantis'), skillOf(id), target, sink);

const recorder = () => {
  const floats: { at: HexCoord; text: string }[] = [];
  const sink: CombatSink = { ...SILENT_SINK, float: (where: HexCoord, text: string) => { floats.push({ at: where, text }); } };
  return { sink, floats };
};
const hitsOn = (floats: { at: HexCoord; text: string }[], where: HexCoord) =>
  floats.filter((f) => f.at.q === where.q && f.at.r === where.r && /^-\d+!?$/.test(f.text));

beforeEach(() => {
  resetFixtureIds();
  // 0.5 is never a dodge against a dummy and never a natural crit for the Mantis
  spyDice().mockReturnValue(0.5);
});

afterEach(() => jest.restoreAllMocks());

// ─── The tree ────────────────────────────────────────────────────────────────

describe('the Mantis tree', () => {
  it('is a Monk path, the blade dancer, opening with Twin Reap', () => {
    expect(masteriesForClass(HeroClass.Monk).map((p) => p.id)).toContain('mantis');
    expect(path.heroClass).toBe(HeroClass.Monk);
    expect(path.roles).toContain('damage');
    expect(path.signatureSkill).toBe('twin_reap');
  });

  // A free signature would always beat the swing that refills chi
  it('prices the signature and every active in chi, the signature cheapest', () => {
    const actives = [scythingStep, flickerCut, pinningCut, mantisPounce];
    expect(twinReap.manaCost).toBeGreaterThan(0);
    for (const skill of actives) expect(skill.manaCost).toBeGreaterThan(twinReap.manaCost);
    // One swing buys the next signature
    expect(BALANCE.CHI.BASIC_ATTACK_REFILL).toBeGreaterThanOrEqual(twinReap.manaCost);
  });

  it('has five feeders and four actives, the signature upgrade in the centre', () => {
    const row = (tier: number) => path.nodes.filter((n) => n.tier === tier && !n.sideTree)
      .sort((a, b) => a.column - b.column);
    expect(row(1).map((n) => n.column)).toEqual([0, 1, 2, 3, 4]);
    expect(row(2).map((n) => n.column)).toEqual([0, 1, 2, 3]);
    expect(row(1).every((n) => !n.grantsSkill)).toBe(true);
    expect(row(2).every((n) => !!n.grantsSkill)).toBe(true);
    expect(row(1)[2].grantsPassive).toBe('reapingMomentum');
  });

  it('names its stat nodes in defences and chi, never flat HP', () => {
    for (const node of path.nodes) expect(node.statBonus?.maxHp).toBeUndefined();
    expect(path.nodes.some((n) => (n.statBonus?.maxMana ?? 0) > 0)).toBe(true);
  });

  it('lets every node be bought, in tree order, with the points the levels earn', () => {
    let hero = mantisHero({});
    hero = { ...hero, masteryPoints: path.nodes.length };
    // The capstones lock each other out: the first of them stands for all three
    const order = [...path.nodes].filter((n) => !n.sideTree)
      .sort((a, b) => a.tier - b.tier || a.column - b.column)
      .filter((n) => n.tier < 3 || (n.tier === 3 && n.column === 0));
    for (const node of order) {
      expect(canUnlockNode(hero, node.id)).toEqual({ ok: true });
      hero = {
        ...hero,
        masteryPoints: hero.masteryPoints - node.cost,
        masteryNodes: { ...hero.masteryNodes, [node.id]: 1 },
      };
    }
  });

  it('refuses an active until both feeders above it are held', () => {
    const hero = { ...mantisHero({ mantis_chitin_grace: 1 }), masteryPoints: 5 };
    expect(canUnlockNode(hero, 'mantis_scything_step').ok).toBe(false);
  });

  it('grants the four actives and the signature to a hero who holds them', () => {
    const ids = mantisHero().skills.map((s) => s.id);
    for (const id of ['twin_reap', 'scything_step', 'flicker_cut', 'pinning_cut', 'mantis_pounce'] as SkillId[]) {
      expect(ids).toContain(id);
    }
  });
});

// ─── The feeders ─────────────────────────────────────────────────────────────

describe('Chitin Grace and Light Frame', () => {
  it('raise Attack and Physical Defense, and Speed and the chi pool', () => {
    const bare = getEffectiveStats(mantisHero({}));
    const fed = getEffectiveStats(mantisHero({ mantis_chitin_grace: 2, mantis_light_frame: 2 }));
    expect(fed.attack).toBeGreaterThan(bare.attack);
    expect(fed.defense).toBeGreaterThan(bare.defense);
    expect(fed.speed).toBeGreaterThan(bare.speed);
    expect(fed.maxMana).toBeGreaterThan(bare.maxMana);
    expect(masteryStatBonus(mantisHero({ mantis_light_frame: 2 })).maxMana).toBe(8);
  });

  it('starts a fight with the larger chi pool full', () => {
    field([dummy('foe', 3, 0)], mantisHero({ mantis_light_frame: 2 }));
    expect(unit('mantis').currentMana).toBe(BALANCE.CHI.POOL + 8);
  });
});

describe('Bleeding Blades', () => {
  it('makes the Basic Attack leave a Bleed, and nothing else lay one', () => {
    field([dummy('foe', 1, 0)]);
    cast(BASIC_ATTACK_ID as SkillId, at(1, 0));
    expect(bleed('foe')?.duration).toBe(BALANCE.MANTIS.BLEED_TURNS);
    expect(bleed('foe')?.magnitude).toBeGreaterThan(0);
  });

  it('lays no Bleed without the node', () => {
    const hero = mantisHero({ mantis_chitin_grace: 2 });
    field([dummy('foe', 1, 0)], hero);
    cast(BASIC_ATTACK_ID as SkillId, at(1, 0));
    expect(bleed('foe')).toBeUndefined();
  });
});

describe("Predator's Breath", () => {
  it('adds critical chance to the turn Meditate pays out', () => {
    field([dummy('foe', 4, 0)], { ...mantisHero(), skills: [...mantisHero().skills, meditate] });
    resolveSkillUse(unit('mantis'), meditate, unit('mantis').position, SILENT_SINK);
    state().tickEffectsOnUnit('mantis');
    const crit = unit('mantis').activeEffects.find((e) => e.type === AuraType.CritBuff);
    expect(crit?.magnitude).toBe(BALANCE.MANTIS.PREDATORS_BREATH_CRIT);
  });

  it('adds nothing without the node', () => {
    const hero = mantisHero({ mantis_chitin_grace: 2 });
    field([dummy('foe', 4, 0)], { ...hero, skills: [...hero.skills, meditate] });
    resolveSkillUse(unit('mantis'), meditate, unit('mantis').position, SILENT_SINK);
    state().tickEffectsOnUnit('mantis');
    expect(unit('mantis').activeEffects.some((e) => e.type === AuraType.CritBuff)).toBe(false);
  });
});

// ─── Twin Reap ───────────────────────────────────────────────────────────────

describe('Twin Reap', () => {
  it('cuts twice and spends chi', () => {
    field([dummy('foe', 1, 0)]);
    const { sink, floats } = recorder();
    const before = unit('mantis').currentMana;
    expect(cast('twin_reap', at(1, 0), sink).ok).toBe(true);
    expect(hitsOn(floats, at(1, 0))).toHaveLength(2);
    expect(unit('mantis').currentMana).toBe(before - twinReap.manaCost);
  });

  it('crits with the second cut on a Bleeding enemy, and reaps the Bleed', () => {
    field([dummy('foe', 1, 0)]);
    cast(BASIC_ATTACK_ID as SkillId, at(1, 0));
    expect(bleed('foe')).toBeDefined();
    const { sink, floats } = recorder();
    cast('twin_reap', at(1, 0), sink);
    const cuts = hitsOn(floats, at(1, 0)).map((f) => f.text);
    expect(cuts).toHaveLength(2);
    expect(cuts[0].endsWith('!')).toBe(false);
    expect(cuts[1].endsWith('!')).toBe(true);
    expect(bleed('foe')).toBeUndefined();
  });

  it('rolls no certain critical on an enemy that is not Bleeding', () => {
    field([dummy('foe', 1, 0)]);
    const { sink, floats } = recorder();
    cast('twin_reap', at(1, 0), sink);
    expect(hitsOn(floats, at(1, 0)).some((f) => f.text.endsWith('!'))).toBe(false);
  });

  it('reaps nothing when the second cut is dodged: the Bleed waits for the next', () => {
    field([dummy('foe', 1, 0, 3, { stats: makeStats({ maxHp: 5000, dodgeChance: 100 }) })]);
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'foe'
        ? { ...u, activeEffects: [{ type: AfflictionType.Bleed, magnitude: 4, duration: 3, sourceUnitId: 'mantis' }] }
        : u)),
    }));
    cast('twin_reap', at(1, 0));
    expect(bleed('foe')).toBeDefined();
  });
});

// ─── Reaping Momentum ────────────────────────────────────────────────────────

describe('Reaping Momentum', () => {
  it('stacks on the same prey up to the cap, by rung', () => {
    field([dummy('a', 1, 0)]);
    // Topped up before each reap: the stacks are the rule here, not whether the pool pays five
    for (let i = 0; i < BALANCE.MANTIS.MOMENTUM_MAX_STACKS + 2; i++) {
      useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'mantis' ? { ...u, currentMana: u.stats.maxMana } : u)) }));
      cast('twin_reap', at(1, 0));
    }
    expect(unit('mantis').reapPrey).toEqual({ targetId: 'a', stacks: BALANCE.MANTIS.MOMENTUM_MAX_STACKS });
    const top = 1 + BALANCE.MANTIS.MOMENTUM_MAX_STACKS * BALANCE.MANTIS.MOMENTUM_STEP;
    expect(momentumScale(unit('mantis'), BALANCE.MANTIS.MOMENTUM_MAX_STACKS)).toBeCloseTo(top);
  });

  it('cuts harder on the second reap of the same prey', () => {
    field([dummy('a', 1, 0)]);
    const first = recorder();
    cast('twin_reap', at(1, 0), first.sink);
    const second = recorder();
    cast('twin_reap', at(1, 0), second.sink);
    const total = (floats: { at: HexCoord; text: string }[]) =>
      hitsOn(floats, at(1, 0)).reduce((n, f) => n + Number(f.text.replace(/[-!]/g, '')), 0);
    expect(total(second.floats)).toBeGreaterThan(total(first.floats));
  });

  it('keeps the count through a Pounce in between', () => {
    field([dummy('a', 1, 0), dummy('b', 1, 1)]);
    cast('twin_reap', at(1, 0));
    cast('twin_reap', at(1, 0));
    expect(unit('mantis').reapPrey).toEqual({ targetId: 'a', stacks: 1 });
    // Another skill on another enemy writes nothing
    state().tickCooldowns('mantis');
    expect(cast('mantis_pounce', at(1, 1)).ok).toBe(true);
    expect(unit('mantis').reapPrey).toEqual({ targetId: 'a', stacks: 1 });
    expect(reapStacks(unit('mantis'), 'a')).toBe(2);
  });

  it('starts over on another enemy', () => {
    field([dummy('a', 1, 0), dummy('b', 0, 1)]);
    cast('twin_reap', at(1, 0));
    cast('twin_reap', at(1, 0));
    cast('twin_reap', at(0, 1));
    expect(unit('mantis').reapPrey).toEqual({ targetId: 'b', stacks: 0 });
    expect(reapStacks(unit('mantis'), 'a')).toBe(0);
  });

  it('carries nothing without the node', () => {
    const hero = mantisHero({ mantis_chitin_grace: 2 });
    field([dummy('a', 1, 0)], hero);
    cast('twin_reap', at(1, 0));
    expect(reapStacks(unit('mantis'), 'a')).toBe(0);
  });
});

// ─── The actives ─────────────────────────────────────────────────────────────

describe('Scything Step', () => {
  it('steps one hex in, cuts with both blades and leaves a Bleed', () => {
    field([dummy('foe', 2, 0)]);
    const { sink, floats } = recorder();
    expect(cast('scything_step', at(2, 0), sink).ok).toBe(true);
    expect(hexDistance(at(0, 0), unit('mantis').position)).toBe(1);
    expect(hexDistance(unit('mantis').position, at(2, 0))).toBe(1);
    expect(hitsOn(floats, at(2, 0))).toHaveLength(2);
    expect(bleed('foe')).toBeDefined();
  });
});

describe('Flicker Cut', () => {
  // The dummy at (1,0) looks west (3), toward the Mantis at (0,0): its back hex
  // is east of it, its rear sides north-east and south-east
  it('lands on the back hex when it is free, facing its prey', () => {
    field([dummy('foe', 1, 0)]);
    face('foe', 3);
    const [back] = hexesBehind(unit('foe'));
    expect(cast('flicker_cut', at(1, 0)).ok).toBe(true);
    expect(unit('mantis').position).toEqual(back);
    // The cut from there is the backstab
    expect(unit('mantis').facing).toBe(3);
  });

  // Playtest 2026-10-21, PT-17: the blink comes first, so the cut is the backstab
  it('blinks in before the cut, so the cut itself is a backstab', () => {
    const lostFromBehind = () => {
      field([dummy('foe', 1, 0)]);
      face('foe', 3);
      cast('flicker_cut', at(1, 0));
      return unit('foe').stats.maxHp - unit('foe').currentHp;
    };
    const lostFromFront = () => {
      field([dummy('foe', 1, 0), ...[0, 1, 2].map((i) => dummy(`w${i}`, -2, i))]);
      face('foe', 3);
      const behind = hexesBehind(unit('foe'));
      useCombatStore.setState((s) => ({
        units: s.units.map((u) => {
          const slot = ['w0', 'w1', 'w2'].indexOf(u.id);
          return slot >= 0 ? { ...u, position: behind[slot] } : u;
        }),
      }));
      cast('flicker_cut', at(1, 0));
      expect(unit('mantis').position).toEqual(at(0, 0));
      return unit('foe').stats.maxHp - unit('foe').currentHp;
    };
    const front = lostFromFront();
    expect(front).toBeGreaterThan(0);
    expect(lostFromBehind() / front).toBeCloseTo(BALANCE.BACKSTAB_MULTIPLIER, 1);
  });

  it('lands on a rear-side hex when the back hex is taken', () => {
    field([dummy('foe', 1, 0), dummy('wall', 2, 0)]);
    face('foe', 3);
    const [, ...sides] = hexesBehind(unit('foe'));
    cast('flicker_cut', at(1, 0));
    expect(sides).toContainEqual(unit('mantis').position);
  });

  it('stays where it struck from when nothing behind is free', () => {
    field([dummy('foe', 1, 0), ...[0, 1, 2].map((i) => dummy(`w${i}`, 0, 0))]);
    face('foe', 3);
    const behind = hexesBehind(unit('foe'));
    // Fill every hex behind the prey
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => {
        const slot = ['w0', 'w1', 'w2'].indexOf(u.id);
        return slot >= 0 ? { ...u, position: behind[slot] } : u;
      }),
    }));
    cast('flicker_cut', at(1, 0));
    expect(unit('mantis').position).toEqual(at(0, 0));
  });

  it('does not move a Rooted Mantis', () => {
    field([dummy('foe', 1, 0)]);
    face('foe', 3);
    state().applyEffect('mantis', { type: AfflictionType.Root, magnitude: 1, duration: 2 });
    cast('flicker_cut', at(1, 0));
    expect(unit('mantis').position).toEqual(at(0, 0));
  });
});

// Playtest 2026-10-17, PT-22: the Root became Exposed, which a boss carries too
describe('Pinning Cut', () => {
  const M = BALANCE.MANTIS;
  const cutOpen = (id: string) => unit(id).activeEffects.find((e) => e.type === AfflictionType.CutOpen);

  it('cuts and leaves the prey Exposed to this Mantis, and no Root', () => {
    field([dummy('foe', 1, 0)]);
    expect(cast('pinning_cut', at(1, 0)).ok).toBe(true);
    expect(unit('foe').currentHp).toBeLessThan(5000);
    expect(unit('foe').activeEffects.some((e) => e.type === AfflictionType.Root)).toBe(false);
    // The Mantis's next EXPOSE_TURNS turns: one tick more on the carrier's clock
    expect(cutOpen('foe')).toMatchObject({ magnitude: M.EXPOSE, duration: M.EXPOSE_TURNS + 1, sourceUnitId: 'mantis' });
  });

  it('makes the Mantis’s blows land EXPOSE harder, and nobody else’s', () => {
    const swing = (exposed: boolean) => {
      field([dummy('a', 1, 0), dummy('b', 0, 2)]);
      if (exposed) state().applyEffect('a', { type: AfflictionType.CutOpen, magnitude: M.EXPOSE, duration: 3, sourceUnitId: 'mantis' });
      cast(BASIC_ATTACK_ID as SkillId, at(1, 0));
      return 5000 - unit('a').currentHp;
    };
    const plain = swing(false);
    const opened = swing(true);
    expect(opened / plain).toBeCloseTo(1 + M.EXPOSE, 1);
    expect(cutOpenMultiplier(unit('mantis'), unit('a'))).toBeCloseTo(1 + M.EXPOSE);
    expect(cutOpenMultiplier(unit('b'), unit('a'))).toBe(1);
  });

  it('exposes a boss as well', () => {
    const boss = enemyTemplates.find((t) => t.tier === 'boss')!;
    field([dummy('boss', 1, 0, 3, { templateId: boss.id })]);
    cast('pinning_cut', at(1, 0));
    expect(cutOpen('boss')).toBeDefined();
    expect(unit('boss').currentHp).toBeLessThan(5000);
  });
});

describe('Pounce', () => {
  it('dashes up to four hexes to an enemy and cuts it, leaving no Bleed (PT-21)', () => {
    field([dummy('foe', 4, 0)]);
    expect(cast('mantis_pounce', at(4, 0)).ok).toBe(true);
    expect(unit('mantis').position).toEqual(at(3, 0));
    expect(unit('foe').currentHp).toBeLessThan(5000);
    expect(bleed('foe')).toBeUndefined();
    expect(mantisPounce.appliesEffect).toBeUndefined();
  });

  it('is not the Wolf\'s Pounce', () => {
    expect(mantisPounce.id).not.toBe('pounce');
  });
});
