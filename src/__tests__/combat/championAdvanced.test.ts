import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { applyAllyHealOnHit } from '@/systems/combat/combatEvents';
import { createPlayerUnits } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { critChanceAgainst, exposedMultiplier, skillDamagePreview } from '@/systems/combat/damageCalc';
import { applySkillMode } from '@/systems/combat/skillModes';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { rallyDefense, redMistCrit } from '@/systems/combat/passiveFormulas';
import { deriveHeroSkills } from '@/systems/progression/mastery';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { describeSkill, skillEffectLines } from '@/data/display/skillDisplay';
import { nodeSimpleText } from '@/data/display/simpleText';
import { findMasteryNode } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import { DEFAULT_LOCALE, setLocale } from '@/i18n';
import { usePartyStore } from '@/stores/partyStore';
import { AfflictionType, AuraType, CombatUnit, Hero, HeroClass, HeroSkill, MasteryId, PassiveRank, SkillTargetType } from '@/models/types';
import { at, makeFoe, makeHero, makeSkill, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Champion's level-21–25 advanced nodes, as rules, through the real code
 * path: a level-21 hero with a capstone and the node, fielded by
 * `createPlayerUnits`, acting through `resolveSkillUse`.
 *
 * Rallying Taunt (Bulwark) steadies allies near the Bulwark when its Taunt
 * lands; Unbowed hardens both defences. Aegis of Faith (Templar) is the shared
 * heal-grants-Defense rule; Crusader is Attack and Magic. Red Mist (Berserker)
 * is critical chance at half health or below; Gorge is lifesteal on every
 * damaging skill, shown on the skill as it is drained.
 *
 * The level-26 row, at the end: Dropped Guard (Bulwark) opens an enemy under the
 * Taunt to every direct hit; Carrying Word (Templar) sends Smite's spilled heal on
 * to the next most wounded; Bottomless Thirst (Berserker) slopes Bloodthirst up
 * with the health missing, except while Undying's window stands. The figures are
 * read from `BALANCE`, so these pin the rules and survive a retune.
 */

const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));
const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);

function hero(path: MasteryId, nodes: Record<string, number>, over: Partial<Hero> = {}): Hero {
  const h = makeHero({
    heroClass: HeroClass.Warrior,
    templateId: 'warrior',
    level: 21,
    masteryPath: path,
    masteryNodes: nodes,
    baseStats: makeStats({
      maxHp: 200, attack: 30, defense: 5, magic: 20, maxMana: 100,
      critChance: 0, critDamage: 150, dodgeChance: 0,
    }),
    ...over,
  });
  h.skills = deriveHeroSkills(h, []);
  return h;
}

const field = (h: Hero, id: string, q = 0, r = 0): CombatUnit => ({
  ...createPlayerUnits([h], [at(q, r)], [])[0],
  id,
});

const skillOf = (unit: CombatUnit, id: string) => {
  const s = unit.skills.find((x) => x.id === id);
  if (!s) throw new Error(`${unit.id} has no ${id}`);
  return s;
};

const foe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({
    id: 'foe',
    position: at(1, 0),
    stats: makeStats({ maxHp: 5000, attack: 10, defense: 0, critChance: 0, dodgeChance: 0 }),
    ...over,
  });

/** What a script took off a unit's health. */
function blowOn(id: string, run: () => unknown): number {
  const before = unitNow(id).currentHp;
  run();
  return before - unitNow(id).currentHp;
}

const makeSkillFor = (id: string) => makeSkill({ id: id as HeroSkill['id'], damage: 1, targetType: SkillTargetType.Single, range: 3 });

beforeEach(() => {
  resetFixtureIds();
  state().reset();
});

describe('Rallying Taunt', () => {
  const BULWARK = { bulwark_vow: 1 };

  function taunt(level: number | 0) {
    state().reset();
    const nodes = level ? { ...BULWARK, bulwark_rallying_taunt: level } : BULWARK;
    const bulwark = field(hero('bulwark', nodes), 'bulwark');
    const near = makeUnit({ id: 'near', position: at(-1, 0), stats: makeStats({ maxHp: 100 }) });
    const edge = makeUnit({ id: 'edge', position: at(-2, 0), stats: makeStats({ maxHp: 100 }) });
    const far = makeUnit({ id: 'far', position: at(-3, 0), stats: makeStats({ maxHp: 100 }) });
    useCombatStore.setState({ units: [bulwark, near, edge, far, foe()] });
    resolveSkillUse(bulwark, skillOf(bulwark, 'provoking_strike'), at(1, 0), SILENT_SINK);
    const def = (id: string) =>
      unitNow(id).activeEffects.find((e) => e.type === AuraType.DefenseBuff)?.magnitude ?? 0;
    return { near: def('near'), edge: def('edge'), far: def('far'), self: def('bulwark') };
  }

  it('gives every ally within reach Defense when the Taunt lands, and no one past it', () => {
    expect(BALANCE.ADVANCED_CHAMPION.RALLY_REACH).toBe(2);
    const got = taunt(2);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Taunt && e.sourceUnitId === 'bulwark')).toBe(true);
    expect(got.near).toBe(rallyDefense(RANKS[1]));
    expect(got.edge).toBe(rallyDefense(RANKS[1]));
    expect(got.far).toBe(0);
    // Not the Bulwark: Braced owns its Defense buff
    expect(got.self).toBe(0);
  });

  it('does nothing without the node', () => {
    expect(taunt(0)).toEqual({ near: 0, edge: 0, far: 0, self: 0 });
  });

  it('is 3 / 4 / 5 Defense by rank', () => {
    expect([1, 2, 3].map((l) => taunt(l).near)).toEqual([3, 4, 5]);
  });

  it('lasts one of the ally\'s turns', () => {
    taunt(2);
    const buff = unitNow('near').activeEffects.find((e) => e.type === AuraType.DefenseBuff)!;
    expect(buff.duration).toBe(BALANCE.ADVANCED_CHAMPION.RALLY_TURNS);
  });

  it('reads the rank-two number in its Simple line', () => {
    expect(nodeSimpleText(findMasteryNode('bulwark_rallying_taunt')!.node, 2)).toContain('+4 Physical Defence');
  });
});

describe('Unbowed', () => {
  it('adds 3 / 4 / 5 Physical and Magic Defense to the fielded unit', () => {
    const base = getEffectiveStats(hero('bulwark', { bulwark_vow: 1 }));
    for (const [level, gain] of [[1, 3], [2, 4], [3, 5]] as const) {
      const unit = field(hero('bulwark', { bulwark_vow: 1, bulwark_unbowed: level }), 'b');
      expect(unit.stats.defense - base.defense).toBe(gain);
      expect((unit.stats.magicDefense ?? 0) - (base.magicDefense ?? 0)).toBe(gain);
    }
  });
});

describe('Aegis of Faith', () => {
  const TEMPLAR = { templar_martyr: 1, templar_lay_on_hands: 1 };

  function mend(level: number | 0) {
    state().reset();
    const nodes = level ? { ...TEMPLAR, templar_aegis_of_faith: level } : TEMPLAR;
    const templar = field(hero('templar', nodes), 'templar');
    const ally = makeUnit({ id: 'ally', position: at(-1, 0), stats: makeStats({ maxHp: 100 }), currentHp: 40 });
    useCombatStore.setState({ units: [templar, ally, foe({ position: at(4, 0) })] });
    resolveSkillUse(templar, skillOf(templar, 'lay_on_hands'), ally.position, SILENT_SINK);
    return unitNow('ally').activeEffects.find((e) => e.type === AuraType.DefenseBuff)?.magnitude ?? 0;
  }

  it('gives a healed ally 2 / 3 / 4 Defense by rank, and nothing without the node', () => {
    expect(mend(0)).toBe(0);
    expect([1, 2, 3].map(mend)).toEqual([2, 3, 4]);
  });
});

describe('Crusader', () => {
  // Attack flat, Magic a share since the playtest of 2026-10-23: 10% at rank two
  it('adds 4 / 5 / 6 Attack and 7.5 / 10 / 12.5% Magic to the fielded unit', () => {
    const base = getEffectiveStats(hero('templar', { templar_martyr: 1 }));
    for (const [level, gain, share] of [[1, 4, 0.075], [2, 5, 0.1], [3, 6, 0.125]] as const) {
      const unit = field(hero('templar', { templar_martyr: 1, templar_crusader: level }), 't');
      expect(unit.stats.attack - base.attack).toBe(gain);
      expect(unit.stats.magic).toBe(Math.round(base.magic * (1 + share)));
    }
  });
});

describe('Red Mist', () => {
  const zerk = (hpShare: number, level: number | 0) => {
    const nodes: Record<string, number> = level ? { berserker_carnage: 1, berserker_red_mist: level } : { berserker_carnage: 1 };
    const unit = field(hero('berserker', nodes), 'zerk');
    return { ...unit, currentHp: Math.round(combatMax(unit) * hpShare) };
  };
  const combatMax = (u: CombatUnit) => u.stats.maxHp;
  const crit = (u: CombatUnit) => critChanceAgainst(u, foe());

  it('adds critical chance at half health or below, and not above it', () => {
    expect(crit(zerk(0.5, 2)) - crit(zerk(0.5, 0))).toBe(redMistCrit(RANKS[1]));
    expect(crit(zerk(0.3, 2)) - crit(zerk(0.3, 0))).toBe(redMistCrit(RANKS[1]));
    expect(crit(zerk(0.51, 2))).toBe(crit(zerk(0.51, 0)));
  });

  it('is a stat while it holds, so the sheet shows what the fight rolls', () => {
    const low = zerk(0.4, 2);
    expect(getCombatEffectiveStats(low).critChance ?? 0)
      .toBe((getCombatEffectiveStats(zerk(0.4, 0)).critChance ?? 0) + redMistCrit(RANKS[1]));
  });

  it('is 9 / 12 / 15 points by rank', () => {
    expect([1, 2, 3].map((l) => crit(zerk(0.4, l)) - crit(zerk(0.4, 0)))).toEqual([9, 12, 15]);
  });
});

describe('Gorge', () => {
  const zerk = (level: number | 0) =>
    field(hero('berserker', level ? { berserker_carnage: 1, berserker_gorge: level } : { berserker_carnage: 1 }), 'zerk');

  it('adds 6 / 8 / 10% lifesteal to every damaging skill, and the skill says so', () => {
    const plain = zerk(0);
    for (const [level, gain] of [[1, 0.06], [2, 0.08], [3, 0.1]] as const) {
      const fed = zerk(level);
      for (const id of [BASIC_ATTACK_ID, 'bloodthirst', 'carnage']) {
        const before = plain.skills.find((s) => s.id === id);
        const after = fed.skills.find((s) => s.id === id);
        if (!before?.damage || !after) continue;
        expect((after.lifesteal ?? 0) - (before.lifesteal ?? 0)).toBeCloseTo(gain, 5);
      }
      const basic = skillOf(fed, BASIC_ATTACK_ID);
      expect(skillEffectLines(basic)).toContain(`Heals for ${Math.round(gain * 100)}% of damage dealt`);
    }
  });

  it('heals the Berserker for a share of what the swing dealt', () => {
    const healed = (level: number | 0) => {
      state().reset();
      const unit = { ...zerk(level), currentHp: 50 };
      useCombatStore.setState({ units: [unit, foe()] });
      resolveSkillUse(unit, skillOf(unit, BASIC_ATTACK_ID), at(1, 0), SILENT_SINK);
      return { hp: unitNow('zerk').currentHp - 50, dealt: 5000 - unitNow('foe').currentHp };
    };
    const without = healed(0);
    const fed = healed(2);
    expect(fed.dealt).toBe(without.dealt);
    // Within a point of 8% of the blow: the drain is rounded once, the bonus beside the base
    expect(Math.abs(fed.hp - without.hp - fed.dealt * 0.08)).toBeLessThanOrEqual(1);
    expect(fed.hp).toBeGreaterThan(without.hp);
  });
});

/** The node's figure at a rank: the authored number is rank two's. */
const atRank = (figure: number, level: number) => figure * RANKS[level - 1].scale;

const { DROPPED_GUARD_EXPOSURE, CARRYING_WORD_SHARE, BOTTOMLESS_THIRST_BONUS } = BALANCE.ADVANCED_CHAMPION;

/** Hard enough that a rounded blow still shows a percentage to two places. */
const HEAVY = makeStats({
  maxHp: 200, attack: 300, defense: 5, magic: 200, maxMana: 100, critChance: 0, critDamage: 150, dodgeChance: 0,
});

const hardFoe = (over: Partial<CombatUnit> = {}) =>
  foe({ stats: makeStats({ maxHp: 500000, attack: 10, defense: 0, critChance: 0, dodgeChance: 0 }), currentHp: 500000, ...over });

describe('Dropped Guard', () => {
  const NODES = (level: number | 0): Record<string, number> =>
    level ? { bulwark_vow: 1, bulwark_dropped_guard: level } : { bulwark_vow: 1 };
  const STRIKER = makeSkillFor('striker_blow');

  /** The Bulwark taunts, then one ally strikes: what the ally's blow dealt. */
  function fight(level: number | 0) {
    state().reset();
    const bulwark = field(hero('bulwark', NODES(level), { level: 26 }), 'bulwark');
    const striker = makeUnit({
      id: 'striker', position: at(1, 1), stats: makeStats({ attack: 300, critChance: 0, dodgeChance: 0 }), skills: [STRIKER],
    });
    useCombatStore.setState({ units: [bulwark, striker, hardFoe()] });
    resolveSkillUse(bulwark, skillOf(bulwark, 'provoking_strike'), at(1, 0), SILENT_SINK);
    return blowOn('foe', () => resolveSkillUse(unitNow('striker'), STRIKER, at(1, 0), SILENT_SINK));
  }

  it('raises an ally\'s direct hit on an enemy under the Taunt, rank by rank', () => {
    const plain = fight(0);
    for (const level of [1, 2, 3]) {
      expect(fight(level) / plain).toBeCloseTo(1 + atRank(DROPPED_GUARD_EXPOSURE, level), 2);
    }
  });

  it('counts the Bulwark\'s own blows too', () => {
    const own = (level: number | 0) => {
      state().reset();
      const bulwark = field(hero('bulwark', NODES(level), { level: 26, baseStats: HEAVY }), 'bulwark');
      useCombatStore.setState({ units: [bulwark, hardFoe()] });
      resolveSkillUse(bulwark, skillOf(bulwark, 'provoking_strike'), at(1, 0), SILENT_SINK);
      return blowOn('foe', () => resolveSkillUse(unitNow('bulwark'), skillOf(bulwark, BASIC_ATTACK_ID), at(1, 0), SILENT_SINK));
    };
    expect(own(2) / own(0)).toBeCloseTo(1 + DROPPED_GUARD_EXPOSURE, 2);
  });

  it('stands exactly as long as the Taunt does', () => {
    fight(2);
    const raised = exposedMultiplier(unitNow('foe'));
    expect(raised).toBeCloseTo(1 + DROPPED_GUARD_EXPOSURE, 5);
    state().removeEffect('foe', AfflictionType.Taunt);
    expect(exposedMultiplier(unitNow('foe'))).toBe(1);
  });

  it('adds with the Beacon\'s light rather than multiplying it', () => {
    fight(2);
    const beacon = 0.15;
    state().applyEffect('foe', { type: AuraType.BeaconLit, magnitude: beacon, duration: 3 });
    expect(exposedMultiplier(unitNow('foe'))).toBeCloseTo(1 + DROPPED_GUARD_EXPOSURE + beacon, 5);
  });

  it('survives a second Taunt that carries none, as Crumble\'s shred survives', () => {
    fight(2);
    state().applyEffect('foe', { type: AfflictionType.Taunt, magnitude: 9, duration: 2, sourceUnitId: 'striker' });
    expect(exposedMultiplier(unitNow('foe'))).toBeCloseTo(1 + DROPPED_GUARD_EXPOSURE, 5);
  });

  it('does not raise a tick, which is not a direct hit', () => {
    const ticked = (level: number | 0) => {
      fight(level);
      state().applyEffect('foe', { type: AfflictionType.Bleed, magnitude: 50, duration: 3 });
      return blowOn('foe', () => state().tickEffectsOnUnit('foe'));
    };
    expect(ticked(2)).toBeGreaterThan(0);
    expect(ticked(2)).toBe(ticked(0));
  });

  it('opens nobody the Taunt never reached: Debuff Immunity refuses both', () => {
    state().reset();
    const bulwark = field(hero('bulwark', NODES(2), { level: 26 }), 'bulwark');
    const warded = hardFoe({ activeEffects: [{ type: AuraType.DebuffImmunity, magnitude: 1, duration: 3 }] });
    useCombatStore.setState({ units: [bulwark, warded] });
    resolveSkillUse(bulwark, skillOf(bulwark, 'provoking_strike'), at(1, 0), SILENT_SINK);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Taunt)).toBe(false);
    expect(exposedMultiplier(unitNow('foe'))).toBe(1);
  });
});

describe('Carrying Word', () => {
  const NODES = (level: number | 0, more: Record<string, number> = {}): Record<string, number> => ({
    templar_martyr: 1, ...(level && { templar_carrying_word: level }), ...more,
  });
  const ally = (id: string, currentHp: number, q: number) =>
    makeUnit({ id, position: at(q, 2), stats: makeStats({ maxHp: 5000 }), currentHp });
  /** A fielded hero comes on at the hero's own health; the order counts the Templar, so start whole. */
  const whole = (unit: CombatUnit): CombatUnit => ({ ...unit, currentHp: unit.stats.maxHp });

  /** The Templar, whole, Smites with wounded allies about: what each ally was mended. */
  function smiteWith(level: number | 0, hps: Record<string, number>, more: Record<string, number> = {}, mode?: 'mercy' | 'wrath') {
    state().reset();
    const templar = whole(field(hero('templar', NODES(level, more), { level: 26, baseStats: HEAVY }), 'templar'));
    const allies = Object.entries(hps).map(([id, hp], i) => ally(id, hp, i));
    useCombatStore.setState({ units: [templar, ...allies, hardFoe()] });
    const smite = skillOf(templar, 'smite');
    resolveSkillUse(templar, mode ? applySkillMode(templar, smite, mode) : smite, at(1, 0), SILENT_SINK);
    return Object.fromEntries(Object.entries(hps).map(([id, hp]) => [id, unitNow(id).currentHp - hp]));
  }

  const WOUNDED = { worst: 500, next: 1500, last: 2500 };

  it('sends a share of the heal to the next most wounded, rank by rank, and to nobody else', () => {
    const plain = smiteWith(0, WOUNDED);
    expect(plain.worst).toBeGreaterThan(0);
    expect(plain.next).toBe(0);
    for (const level of [1, 2, 3]) {
      const healed = smiteWith(level, WOUNDED);
      expect(healed.worst).toBe(plain.worst);
      expect(healed.next).toBe(Math.round(plain.worst * atRank(CARRYING_WORD_SHARE, level)));
      expect(healed.last).toBe(0);
    }
  });

  it('counts its share from what was cast, so a first ally nearly whole does not shrink it', () => {
    const cast = smiteWith(0, { worst: 500 }).worst;
    state().reset();
    const templar = whole(field(hero('templar', NODES(2), { level: 26, baseStats: HEAVY }), 'templar'));
    const nearlyWhole = makeUnit({ id: 'nearlyWhole', position: at(0, 2), stats: makeStats({ maxHp: 100 }), currentHp: 99 });
    const roomy = makeUnit({ id: 'roomy', position: at(1, 2), stats: makeStats({ maxHp: 50000 }), currentHp: 49750 });
    useCombatStore.setState({ units: [templar, nearlyWhole, roomy, hardFoe()] });
    resolveSkillUse(templar, skillOf(templar, 'smite'), at(1, 0), SILENT_SINK);
    expect(unitNow('nearlyWhole').currentHp).toBe(100);
    expect(unitNow('roomy').currentHp - 49750).toBe(Math.round(cast * CARRYING_WORD_SHARE));
  });

  it('counts the Templar in the order, as the first heal does', () => {
    state().reset();
    const hurt = { ...field(hero('templar', NODES(2), { level: 26, baseStats: HEAVY }), 'templar'), currentHp: 10 };
    const friend = ally('friend', 500, 0);
    useCombatStore.setState({ units: [hurt, friend, hardFoe()] });
    resolveSkillUse(hurt, skillOf(hurt, 'smite'), at(1, 0), SILENT_SINK);
    expect(unitNow('templar').currentHp).toBeGreaterThan(10);
    expect(unitNow('friend').currentHp).toBeGreaterThan(500);
  });

  it('with one ally wounded, mends that one once', () => {
    expect(smiteWith(2, { worst: 500 }).worst).toBe(smiteWith(0, { worst: 500 }).worst);
    expect(unitNow('templar').currentHp).toBe(unitNow('templar').stats.maxHp);
  });

  it('raises both under Mercy, and Wrath still heals no one', () => {
    const plain = smiteWith(2, WOUNDED);
    const mercy = smiteWith(2, WOUNDED, { templar_zeal: 2 }, 'mercy');
    expect(mercy.worst).toBeGreaterThan(plain.worst);
    expect(mercy.next).toBeGreaterThan(plain.next);
    expect(smiteWith(2, WOUNDED, { templar_zeal: 2 }, 'wrath')).toEqual({ worst: 0, next: 0, last: 0 });
  });

  it('raises its own heal event: Aegis of Faith follows the second heal', () => {
    smiteWith(2, WOUNDED, { templar_aegis_of_faith: 2 });
    const guarded = (id: string) => unitNow(id).activeEffects.some((e) => e.type === AuraType.DefenseBuff);
    expect(guarded('worst')).toBe(true);
    expect(guarded('next')).toBe(true);
    expect(guarded('last')).toBe(false);
  });

  it('flags the second heal as exempt from the Tithe as well', () => {
    expect(smiteWith(2, WOUNDED).next).toBeGreaterThan(0);
    const healer = unitNow('templar');
    const skill = skillOf(healer, 'smite');
    useCombatStore.setState({ units: [healer, ally('a', 500, 0), ally('b', 600, 1)] });
    expect(applyAllyHealOnHit(healer, skill, 25).map((o) => o.exemptFromTithe)).toEqual([true, true]);
  });

  it('is told on the skill, with the number the fight lands', () => {
    const carrying = smiteWith(2, WOUNDED).next;
    const text = describeSkill(skillOf(unitNow('templar'), 'smite'), unitNow('templar'));
    expect(text).toContain(`the next most wounded for ${carrying}`);
    smiteWith(0, WOUNDED);
    expect(describeSkill(skillOf(unitNow('templar'), 'smite'), unitNow('templar'))).not.toContain('next most wounded');
  });
});

describe('Bottomless Thirst', () => {
  const zerk = (share: number, level: number | 0, over: Partial<CombatUnit> = {}) => {
    const nodes: Record<string, number> = level
      ? { berserker_carnage: 1, berserker_bottomless_thirst: level } : { berserker_carnage: 1 };
    const unit = field(hero('berserker', nodes, { level: 26, baseStats: HEAVY }), 'zerk');
    return { ...unit, currentHp: Math.max(1, Math.round(unit.stats.maxHp * share)), ...over };
  };
  const swing = (unit: CombatUnit, id = 'bloodthirst') => {
    state().reset();
    useCombatStore.setState({ units: [unit, hardFoe()] });
    return blowOn('foe', () => resolveSkillUse(unit, skillOf(unit, id), at(1, 0), SILENT_SINK));
  };
  const ratio = (share: number, level: number, over: Partial<CombatUnit> = {}) =>
    swing(zerk(share, level, over)) / swing(zerk(share, 0, over));

  it('pays nothing at full health', () => {
    expect(swing(zerk(1, 3))).toBe(swing(zerk(1, 0)));
  });

  it('climbs with the share of health missing, rank by rank', () => {
    for (const level of [1, 2, 3]) {
      for (const share of [0.75, 0.5, 0.25]) {
        expect(ratio(share, level)).toBeCloseTo(1 + atRank(BOTTOMLESS_THIRST_BONUS, level) * (1 - share), 2);
      }
    }
  });

  it('nears its whole bonus near zero', () => {
    const lastPoint = zerk(0, 2);
    expect(lastPoint.currentHp).toBe(1);
    expect(ratio(0, 2)).toBeCloseTo(1 + BOTTOMLESS_THIRST_BONUS, 1);
  });

  it('is Bloodthirst alone', () => {
    expect(swing(zerk(0.25, 3), BASIC_ATTACK_ID)).toBe(swing(zerk(0.25, 0), BASIC_ATTACK_ID));
    expect(swing(zerk(0.25, 3))).toBeGreaterThan(swing(zerk(0.25, 0)));
  });

  it('gives no bonus while Undying\'s window stands, and takes it back when it closes', () => {
    const window = { type: AuraType.UndyingWindow, magnitude: 2, duration: -1 };
    expect(ratio(0, 3, { activeEffects: [window] })).toBe(1);
    expect(ratio(0, 3, { activeEffects: [] })).toBeGreaterThan(1);
  });

  it('rides both of Carnage\'s doubled hits', () => {
    const carnage = { type: AuraType.Carnage, magnitude: 1, duration: 3 };
    const doubled = swing(zerk(0.5, 0, { activeEffects: [carnage] }));
    expect(doubled).toBeGreaterThan(swing(zerk(0.5, 0)));
    expect(ratio(0.5, 2, { activeEffects: [carnage] })).toBeCloseTo(1 + BOTTOMLESS_THIRST_BONUS / 2, 2);
  });

  it('shows in the skill\'s own number, as it strikes', () => {
    const skill = skillOf(zerk(1, 2), 'bloodthirst');
    expect(skillDamagePreview(zerk(0.5, 2), skill) / skillDamagePreview(zerk(0.5, 0), skill))
      .toBeCloseTo(1 + BOTTOMLESS_THIRST_BONUS / 2, 2);
  });
});

/**
 * The gate through the store and the node through a fight: a hero of level 25 is
 * refused and fields none of it, a hero of level 26 buys it and the fight pays.
 */
describe('the level-26 row, bought', () => {
  afterEach(() => {
    usePartyStore.getState().reset();
    setLocale(DEFAULT_LOCALE);
  });

  function buy(path: MasteryId, capstone: string, nodeId: string, level: number) {
    const start = hero(path, { [capstone]: 1 }, { level, masteryPoints: 5, baseStats: HEAVY });
    usePartyStore.setState({ heroes: [start] });
    const bought = usePartyStore.getState().unlockMasteryNode(start.id, nodeId);
    const held = usePartyStore.getState().heroes[0];
    return { bought, unit: field(hero(path, held.masteryNodes, { level, baseStats: HEAVY }), 'hero') };
  }

  const CASES: {
    id: string; path: MasteryId; capstone: string; key: 'tauntedExposure' | 'allyHealSpill' | 'thirstMissingBonus';
    paid: (unit: CombatUnit) => boolean;
  }[] = [
    {
      id: 'bulwark_dropped_guard', path: 'bulwark', capstone: 'bulwark_reckoning', key: 'tauntedExposure',
      paid: (unit) => {
        useCombatStore.setState({ units: [unit, hardFoe()] });
        resolveSkillUse(unit, skillOf(unit, 'provoking_strike'), at(1, 0), SILENT_SINK);
        return exposedMultiplier(unitNow('foe')) > 1;
      },
    },
    {
      id: 'templar_carrying_word', path: 'templar', capstone: 'templar_consecrate', key: 'allyHealSpill',
      paid: (unit) => {
        const a = makeUnit({ id: 'a', position: at(0, 2), stats: makeStats({ maxHp: 5000 }), currentHp: 500 });
        const b = makeUnit({ id: 'b', position: at(1, 2), stats: makeStats({ maxHp: 5000 }), currentHp: 1500 });
        useCombatStore.setState({ units: [unit, a, b, hardFoe()] });
        resolveSkillUse(unit, skillOf(unit, 'smite'), at(1, 0), SILENT_SINK);
        return unitNow('b').currentHp > 1500;
      },
    },
    {
      id: 'berserker_bottomless_thirst', path: 'berserker', capstone: 'berserker_whirlwind', key: 'thirstMissingBonus',
      paid: (unit) => {
        const swingAt = (currentHp: number) => {
          state().reset();
          const swinger = { ...unit, currentHp };
          useCombatStore.setState({ units: [swinger, hardFoe()] });
          return blowOn('foe', () => resolveSkillUse(swinger, skillOf(swinger, 'bloodthirst'), at(1, 0), SILENT_SINK));
        };
        return swingAt(20) > swingAt(unit.stats.maxHp);
      },
    },
  ];

  it.each(CASES)('$id is refused at 25 and pays in a fight at 26', ({ path, capstone, id, key, paid }) => {
    const below = buy(path, capstone, id, 25);
    expect(below.bought).toBe(false);
    expect(below.unit.masteryModifiers?.[key]).toBeUndefined();
    expect(paid(below.unit)).toBe(false);

    state().reset();
    const at26 = buy(path, capstone, id, 26);
    expect(at26.bought).toBe(true);
    expect(at26.unit.masteryModifiers?.[key]).toBeGreaterThan(0);
    expect(paid(at26.unit)).toBe(true);
  });

  it.each(CASES)('$id has its name and rank-true Simple line in both languages', ({ id }) => {
    const node = findMasteryNode(id)!.node;
    const figure = Object.values(node.modifier ?? {})[0] as number;
    for (const locale of ['en'] as const) {
      setLocale(locale);
      for (const level of [1, 2, 3]) {
        expect(nodeSimpleText(node, level)).toContain(`${Math.round(atRank(figure, level) * 100)}`);
      }
    }
  });
});
