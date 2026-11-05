import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { flushReactions } from '@/systems/combat/reactionResolve';
import { requireUnit } from '@/systems/combat/unitLookup';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { skillDamagePreview } from '@/systems/combat/damageCalc';
import { carapaceCharges, immovableTarget } from '@/systems/combat/beetle';
import { withHardenedShell } from '@/systems/combat/passives';
import { playerUnitFor } from '@/systems/combat/unitFactory';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { canUnlockNode, deriveHeroSkills, nodeSkillAt } from '@/systems/progression/mastery';
import { findMasteryPath, masteriesForClass } from '@/data/skills/masteryData';
import { MASTERY_GROWTH } from '@/data/skills/masteryGrowth';
import {
  carapaceBastion, carapaceLeap, gripAndThrow, hornSweep, ironCarapace, shellSwap, shellWall, vengefulShell,
} from '@/data/skills/masterySkills';
import { meditate } from '@/data/skills/skillData';
import { interceptHexes, shoulderHexes } from '@/data/display/boardOverlays';
import { passiveSimpleText, statSimpleText } from '@/data/display/simpleText';
import { skillStatLine } from '@/data/display/skillDisplay';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { LEVEL_SCALE } from '@/models/mastery';
import { skillEffects } from '@/systems/combat/statusEffects';
import { hexDistance } from '@/utils/hexUtils';
import {
  AfflictionType, AuraType, CombatUnit, HeroClass, HeroSkill, HeroStats, PassiveId, PassiveRank, SkillTargetType,
} from '@/models/types';
import { at, makeFoe, makeHero, makeSkill, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Beetle's first task (the private project notes, "Beetle"): Iron Carapace,
 * the five feeders and the four actives, as rules played out on a board. What is
 * pinned is the shape — a full carapace soaks exactly one blow, every Barrier is
 * its factor of the Beetle's two defences, the Leap fires once and waits out a
 * Root, the throw stops at what is in the way and a boss takes the heavier blow
 * and nothing else. Numbers come from `BALANCE.BEETLE`.
 */

const B = BALANCE.BEETLE;
const RANK2: PassiveRank = { level: 2, scale: 1 };

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 300, attack: 20, magic: 0, defense: 10, magicDefense: 6, maxMana: 60,
    critChance: 0, dodgeChance: 0, speed: 10, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const effectOn = (id: string, type: AuraType | AfflictionType) =>
  unitNow(id).activeEffects.find((e) => e.type === type);
const shell = (u: CombatUnit) => {
  const s = getCombatEffectiveStats(u);
  return s.defense + (s.magicDefense ?? 0);
};

const beetle = (passives: PassiveId[] = [], over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'beetle', position: at(0, 0), stats: stats(), resource: 'chi',
    skills: [ironCarapace, hornSweep, carapaceLeap, gripAndThrow, shellWall, meditate],
    passives, passiveRanks: Object.fromEntries(passives.map((p) => [p, RANK2])),
    ...over,
  });
const ally = (id: string, q: number, r: number) =>
  makeUnit({ id, position: at(q, r), stats: stats({ defense: 0, magicDefense: 0 }) });
const foe = (id: string, q: number, r: number, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: stats({ maxHp: 2000, defense: 0, magicDefense: 0 }), ...over });
const bossTemplate = enemyTemplates.find((t) => t.tier === 'boss')!;

const cast = (skill: HeroSkill, q: number, r: number) =>
  resolveSkillUse(unitNow('beetle'), skill, at(q, r), SILENT_SINK);

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
});

// ─── The tree ─────────────────────────────────────────────────────────────────

describe('the Beetle tree', () => {
  const path = findMasteryPath('beetle')!;

  it('is the Monk\'s plate path, opening on Iron Carapace', () => {
    expect(path.heroClass).toBe(HeroClass.Monk);
    expect(masteriesForClass(HeroClass.Monk).map((p) => p.id)).toContain('beetle');
    expect(path.signatureSkill).toBe('iron_carapace');
    // Both defences, never flat HP: its Barriers are a factor of them
    expect(MASTERY_GROWTH.beetle).toEqual({ defense: 2, magicDefense: 2 });
  });

  it('has five feeders with Hardened Shell at the centre, and the four actives', () => {
    const row = (tier: number) => path.nodes.filter((n) => n.tier === tier && !n.sideTree)
      .sort((a, b) => a.column - b.column);
    expect(row(1).map((n) => n.column)).toEqual([0, 1, 2, 3, 4]);
    expect(row(1)[2]).toMatchObject({ id: 'beetle_hardened_shell', grantsPassive: 'hardenedShell' });
    expect(row(2).map((n) => n.grantsSkill)).toEqual(['horn_sweep', 'carapace_leap', 'grip_and_throw', 'shell_wall']);
    expect(row(2).map((n) => n.column)).toEqual([0, 1, 2, 3]);
  });

  it('sells every node to a Beetle, row by row, through the derived prerequisites', () => {
    let hero = makeHero({
      templateId: 'monk', heroClass: HeroClass.Monk, level: 20,
      masteryPath: 'beetle', masteryPoints: 15, masteryNodes: {},
    });
    // Every node below the capstones, and the first capstone: the other two are locked out by it
    const capstones = path.nodes.filter((n) => n.tier === 3 && !n.sideTree).sort((a, b) => a.column - b.column);
    const sold = path.nodes.filter((n) => n.tier < 3 && !n.sideTree).sort((a, b) => a.tier - b.tier || a.column - b.column);
    for (const node of [...sold, capstones[0]]) {
      expect([node.id, canUnlockNode(hero, node.id)]).toEqual([node.id, { ok: true }]);
      hero = { ...hero, masteryNodes: { ...hero.masteryNodes, [node.id]: 1 }, masteryPoints: hero.masteryPoints - node.cost };
    }
    // And the skills it bought are the ones on its bar
    const monk = heroTemplates.find((t) => t.heroClass === HeroClass.Monk)!;
    const bar = deriveHeroSkills(hero, monk.skills).map((s) => s.id);
    for (const id of ['iron_carapace', 'horn_sweep', 'carapace_leap', 'grip_and_throw', 'shell_wall', 'vengeful_shell']) {
      expect(bar).toContain(id);
    }
  });

  it('crowns the tree with three capstones that exclude each other', () => {
    const capstones = path.nodes.filter((n) => n.tier === 3 && !n.sideTree).sort((a, b) => a.column - b.column);
    expect(capstones.map((n) => n.grantsSkill)).toEqual(['vengeful_shell', 'carapace_bastion', 'shell_swap']);
    expect(capstones.every((n) => n.exclusiveGroup === 'capstone')).toBe(true);
    const below = Object.fromEntries(path.nodes.filter((n) => n.tier < 3 && !n.sideTree).map((n) => [n.id, 1]));
    for (const owned of capstones) {
      const hero = makeHero({
        templateId: 'monk', heroClass: HeroClass.Monk, level: 20,
        masteryPath: 'beetle', masteryPoints: 15, masteryNodes: { ...below, [owned.id]: 1 },
      });
      for (const other of capstones.filter((n) => n.id !== owned.id)) {
        expect(canUnlockNode(hero, other.id).ok).toBe(false);
      }
    }
  });

  /**
   * The chi loop needs every press to cost: a free signature would always beat a
   * Basic Attack, and the loop would never turn.
   */
  it('prices the signature and every active in chi', () => {
    expect(ironCarapace.manaCost).toBe(BALANCE.CHI.SIGNATURE);
    for (const skill of [hornSweep, carapaceLeap, gripAndThrow, shellWall]) {
      expect(skill.manaCost).toBeGreaterThan(ironCarapace.manaCost);
      expect(skill.cooldown).toBeGreaterThan(0);
    }
    // A capstone and one regular spell leave a full pool dry: every capstone costs
    // more than any regular spell, and is slower to come back
    for (const capstone of [vengefulShell, carapaceBastion, shellSwap]) {
      for (const regular of [hornSweep, carapaceLeap, gripAndThrow, shellWall]) {
        expect(capstone.manaCost).toBeGreaterThan(regular.manaCost);
        expect(capstone.cooldown!).toBeGreaterThan(regular.cooldown!);
      }
      expect(capstone.manaCost + Math.min(hornSweep.manaCost, shellWall.manaCost)).toBeGreaterThanOrEqual(BALANCE.CHI.POOL);
    }
  });

  it('raises the chi pool with Steady Breath and both defences with Thick Plates', () => {
    const at2 = (nodes: Record<string, number>) => getEffectiveStats(makeHero({
      templateId: 'monk', heroClass: HeroClass.Monk, level: 10, masteryPath: 'beetle', masteryNodes: nodes,
      baseStats: heroTemplates.find((t) => t.heroClass === HeroClass.Monk)!.baseStats,
    }));
    const bare = at2({});
    const steady = at2({ beetle_steady_breath: 2 });
    const plates = at2({ beetle_thick_plates: 2 });
    expect(bare.maxMana).toBe(BALANCE.CHI.POOL);
    expect(steady.maxMana - bare.maxMana).toBe(8);
    expect(steady.attack - bare.attack).toBe(2);
    expect(plates.defense - bare.defense).toBe(3);
    expect((plates.magicDefense ?? 0) - (bare.magicDefense ?? 0)).toBe(2);
  });

  it('says chi where a Monk node raises the pool or a Beetle skill costs it', () => {
    const steady = path.nodes.find((n) => n.id === 'beetle_steady_breath')!;
    expect(statSimpleText(steady, 2)).toContain('+8 Chi');
    expect(statSimpleText(steady, 2)).not.toContain('MP');
    expect(skillStatLine(shellWall, 'chi')).toContain(`${shellWall.manaCost} Chi`);
  });

  it('moves every Barrier factor and the heavier blow with the node\'s rank', () => {
    const leap = path.nodes.find((n) => n.grantsSkill === 'carapace_leap')!;
    const grip = path.nodes.find((n) => n.grantsSkill === 'grip_and_throw')!;
    const leapBarrier = (lv: number) =>
      (nodeSkillAt(leap, lv)!.reaction!.response.appliesEffect as { magnitude: number }[])[0].magnitude;
    expect(leapBarrier(1)).toBeLessThan(leapBarrier(2));
    expect(leapBarrier(2)).toBe(B.LEAP_BARRIER);
    expect(leapBarrier(3)).toBeGreaterThan(leapBarrier(2));
    expect(nodeSkillAt(grip, 1)!.immovableVariant!.damage).toBeLessThan(B.THROW_IMMOVABLE_DAMAGE);
  });

  /**
   * PT-04: the Barrier skills climb `BARRIER_RANK_SCALE`, steeper than the global
   * `LEVEL_SCALE`, and only their Barriers do — Shell Swap's Attack Down and every
   * strike keep the ordinary curve.
   */
  it('climbs the Barrier skills\' own steeper rung curve', () => {
    const [lo, mid, hi] = B.BARRIER_RANK_SCALE;
    expect(mid).toBe(1);
    expect(lo).toBeLessThan(LEVEL_SCALE[0]);
    expect(hi).toBeGreaterThan(LEVEL_SCALE[2]);
    const nodeOf = (id: string) => path.nodes.find((n) => n.grantsSkill === id)!;
    const barrier = (s: HeroSkill) => skillEffects(s).find((e) => e.type === AuraType.Barrier)!.magnitude;
    const leapAt = (lv: number) => nodeSkillAt(nodeOf('carapace_leap'), lv)!.reaction!.response;
    for (const [lv, k] of [[1, lo], [2, mid], [3, hi]] as const) {
      expect(barrier(leapAt(lv))).toBeCloseTo(B.LEAP_BARRIER * k, 2);
      // Both of the Leap's Barriers, the ward's and the Beetle's own
      expect(skillEffects(leapAt(lv)).map((e) => e.magnitude))
        .toEqual([barrier(leapAt(lv)), barrier(leapAt(lv))]);
      expect(barrier(nodeSkillAt(nodeOf('shell_wall'), lv)!)).toBeCloseTo(B.SHELL_WALL_BARRIER * k, 3);
      expect(barrier(nodeSkillAt(nodeOf('shell_swap'), lv)!)).toBeCloseTo(B.SWAP_BARRIER * k, 3);
    }
    const attackDown = (lv: number) =>
      skillEffects(nodeSkillAt(nodeOf('shell_swap'), lv)!).find((e) => e.type === AfflictionType.AttackDown)!.magnitude;
    expect(attackDown(3)).toBe(Math.round(B.SWAP_ATTACK_DOWN * LEVEL_SCALE[2]));
  });
});

// ─── Iron Carapace ────────────────────────────────────────────────────────────

describe('Iron Carapace', () => {
  it('banks a charge per strike, up to three, each worth Physical Defense', () => {
    useCombatStore.setState({ units: [beetle(), foe('f', 1, 0)] });
    const before = getCombatEffectiveStats(unitNow('beetle')).defense;
    for (let i = 1; i <= 4; i++) {
      expect(cast(ironCarapace, 1, 0).ok).toBe(true);
      expect(carapaceCharges(unitNow('beetle'))).toBe(Math.min(i, B.CARAPACE_MAX));
    }
    expect(getCombatEffectiveStats(unitNow('beetle')).defense - before).toBe(B.CARAPACE_MAX * B.CARAPACE_DEFENSE);
    // And it costs chi every time
    expect(unitNow('beetle').currentMana).toBe(60 - 4 * ironCarapace.manaCost);
  });

  it('soaks exactly one blow at a full carapace, and the next lands', () => {
    useCombatStore.setState({
      units: [beetle([], { activeEffects: [{ type: AuraType.Carapace, magnitude: 3, duration: -1 }] }), foe('f', 1, 0)],
    });
    const hp = unitNow('beetle').currentHp;
    const soaked = state().damageUnit('beetle', 80, 'f');
    expect(soaked).toMatchObject({ hpLost: 0, absorbed: 80 });
    expect(effectOn('beetle', AuraType.Carapace)).toBeUndefined();
    const next = state().damageUnit('beetle', 80, 'f');
    expect(next.hpLost).toBe(80);
    expect(unitNow('beetle').currentHp).toBe(hp - 80);
  });

  it('holds a short carapace, and lets a clock run out through a full one', () => {
    useCombatStore.setState({
      units: [beetle([], { activeEffects: [{ type: AuraType.Carapace, magnitude: 2, duration: -1 }] }), foe('f', 1, 0)],
    });
    expect(state().damageUnit('beetle', 30, 'f').hpLost).toBe(30);
    expect(carapaceCharges(unitNow('beetle'))).toBe(2);
    state().applyEffect('beetle', { type: AuraType.Carapace, magnitude: 3, duration: -1 });
    // A damage-over-time dose is not a blow
    state().applyEffect('beetle', { type: AfflictionType.Bleed, magnitude: 30, duration: 2, sourceUnitId: 'f' });
    const before = unitNow('beetle').currentHp;
    state().tickEffectsOnUnit('beetle');
    expect(unitNow('beetle').currentHp).toBeLessThan(before);
    expect(carapaceCharges(unitNow('beetle'))).toBe(3);
  });
});

// Playtest 2026-10-28: the two cover capstones reach one hex further each rung
it('Carapace Bastion covers 1 / 2 / 3 hexes and Vengeful Shell reaches 2 / 3 / 4, by rung', () => {
  const path = findMasteryPath('beetle')!;
  const nodeOf = (id: string) => path.nodes.find((n) => n.grantsSkill === id)!;
  for (const level of [1, 2, 3]) {
    expect(nodeSkillAt(nodeOf('carapace_bastion'), level)!.aoeRadius).toBe(level);
    const trigger = nodeSkillAt(nodeOf('vengeful_shell'), level)!.reaction!.trigger;
    expect(trigger).toMatchObject({ kind: 'interceptAlly', reach: level + 1 });
  }
});

// ─── The feeders ──────────────────────────────────────────────────────────────

describe('the feeders', () => {
  // Playtest 2026-10-28: Hardened Shell is Iron Carapace's reach, no longer a harder strike or a soak's Barrier
  it('Hardened Shell: Iron Carapace reaches 2 / 3 / 4 hexes, dashing to close the gap', () => {
    for (const level of [1, 2, 3]) {
      const reached = withHardenedShell(ironCarapace, { hardenedShell: { level, scale: LEVEL_SCALE[level - 1] } });
      expect(reached.range).toBe(B.HARDENED_SHELL_REACH + level - 1);
      expect(reached.selfMove).toEqual({ kind: 'dash', range: B.HARDENED_SHELL_REACH + level - 2 });
    }
    expect(withHardenedShell(ironCarapace, {})).toBe(ironCarapace);
    expect(skillDamagePreview(beetle(['hardenedShell']), ironCarapace)).toBe(skillDamagePreview(beetle(), ironCarapace));
  });

  it('Hardened Shell: struck from beside the enemy, Iron Carapace Taunts it for a round and ends the turn', () => {
    const reached = withHardenedShell(ironCarapace, { hardenedShell: RANK2 });
    useCombatStore.setState({ units: [beetle(['hardenedShell']), foe('f', 1, 0)] });
    const result = cast(reached, 1, 0);
    expect(result).toMatchObject({ ok: true, endsTurn: true });
    expect(effectOn('f', AfflictionType.Taunt)).toMatchObject({ duration: B.HARDENED_SHELL_TAUNT_TURNS, sourceUnitId: 'beetle' });
    expect(unitNow('beetle').position).toEqual(at(0, 0));
  });

  it('Hardened Shell: struck from further off, the Beetle dashes in, keeps its turn and Taunts nobody', () => {
    const reached = withHardenedShell(ironCarapace, { hardenedShell: RANK2 });
    useCombatStore.setState({ units: [beetle(['hardenedShell']), foe('f', 3, 0)] });
    const result = cast(reached, 3, 0);
    expect(result).toMatchObject({ ok: true, endsTurn: false });
    expect(hexDistance(unitNow('beetle').position, at(3, 0))).toBe(1);
    expect(effectOn('f', AfflictionType.Taunt)).toBeUndefined();
    expect(carapaceCharges(unitNow('beetle'))).toBe(1);
  });

  // Playtest 2026-10-29: the free dash made the Monk too strong
  it('Hardened Shell: the dash-strike deals a third, two thirds and all of the blow by rung; beside the enemy, all of it', () => {
    const struck = (level: number, q: number) => {
      const rank = { level, scale: LEVEL_SCALE[level - 1] };
      const reached = withHardenedShell(ironCarapace, { hardenedShell: rank });
      useCombatStore.setState({ units: [beetle(['hardenedShell'], { passiveRanks: { hardenedShell: rank } }), foe('f', q, 0)] });
      cast(reached, q, 0);
      return 2000 - unitNow('f').currentHp;
    };
    const whole = struck(1, 1);
    expect(B.HARDENED_SHELL_DASH_DAMAGE).toEqual([1 / 3, 2 / 3, 1]);
    for (const level of [1, 2, 3]) {
      expect(struck(level, 1)).toBe(whole);
      expect(struck(level, 2)).toBe(Math.round(whole * B.HARDENED_SHELL_DASH_DAMAGE[level - 1]));
    }
    expect(passiveSimpleText('hardenedShell', { level: 1, scale: LEVEL_SCALE[0] })).toContain('33%');
  });

  it('Shell Breath: Meditate restores more chi and banks a charge', () => {
    useCombatStore.setState({ units: [beetle(['shellBreath'], { currentMana: 0 }), foe('f', 3, 0)] });
    expect(cast(meditate, 0, 0).ok).toBe(true);
    expect(unitNow('beetle').currentMana).toBe(BALANCE.CHI.MEDITATE_REFILL + B.SHELL_BREATH_CHI);
    expect(carapaceCharges(unitNow('beetle'))).toBe(B.SHELL_BREATH_CHARGES);
  });

  it('Shoulder to Shoulder: an ally beside the Beetle takes less from a blow, and the Beetle wears its badge all fight', () => {
    useCombatStore.setState({
      units: [beetle(['shoulderToShoulder']), ally('near', 0, 1), ally('far', 0, 3), foe('f', 1, 1)],
    });
    expect(state().damageUnit('near', 100, 'f').hpLost).toBe(Math.round(100 * (1 - B.SHOULDER_REDUCTION)));
    expect(state().damageUnit('far', 100, 'f').hpLost).toBe(100);
    // The Beetle's own blows are its own
    expect(state().damageUnit('beetle', 100, 'f').hpLost).toBe(100);

    const hero = makeHero({
      templateId: 'monk', heroClass: HeroClass.Monk, level: 10, masteryPath: 'beetle',
      masteryNodes: { beetle_shoulder_to_shoulder: 2 },
    });
    const unit = playerUnitFor(hero, {}, { id: 'b', position: at(0, 0) });
    expect(unit.activeEffects).toContainEqual(expect.objectContaining({
      type: AuraType.ShoulderGuard, duration: -1, magnitude: Math.round(B.SHOULDER_REDUCTION * 100),
    }));
    // And its ring is the six hexes round wherever it stands, while it stands
    expect(shoulderHexes([unit]).map((h) => hexDistance(h, at(0, 0)))).toEqual([1, 1, 1, 1, 1, 1]);
    expect(shoulderHexes([{ ...unit, currentHp: 0 }])).toEqual([]);
    expect(shoulderHexes([beetle()])).toEqual([]);
  });
});

// ─── The four actives ─────────────────────────────────────────────────────────

describe('Horn Sweep', () => {
  it('strikes the three hexes in front, pushes each a hex and blunts its next turn', () => {
    useCombatStore.setState({ units: [beetle(), foe('a', 1, 0), foe('b', 1, -1), foe('behind', -1, 0)] });
    expect(cast(hornSweep, 1, 0).ok).toBe(true);
    for (const id of ['a', 'b']) {
      expect(hexDistance(unitNow(id).position, at(0, 0))).toBe(2);
      expect(effectOn(id, AfflictionType.AttackDown)).toMatchObject({ magnitude: B.HORN_SWEEP_ATTACK_DOWN, duration: 2 });
      expect(unitNow(id).currentHp).toBeLessThan(2000);
    }
    expect(unitNow('behind').currentHp).toBe(2000);
  });
});

describe('Carapace Leap', () => {
  const setup = (over: Partial<CombatUnit> = {}) =>
    useCombatStore.setState({
      units: [beetle([], over), ally('ward', 3, 0), ally('other', 0, 2), foe('f', 4, 0)],
    });

  it('is cast on an ally within four hexes, never on an enemy or itself', () => {
    setup();
    expect(cast(carapaceLeap, 4, 0).ok).toBe(false);
    expect(cast(carapaceLeap, 0, 0).ok).toBe(false);
    expect(cast(carapaceLeap, 3, 0).ok).toBe(true);
    expect(state().reactions[0]).toMatchObject({ ownerId: 'beetle', wardId: 'ward' });
    // Like every Reaction, it is the whole turn
    expect(unitNow('beetle')).toMatchObject({ hasMoved: true, hasActed: true });
  });

  it('leaps beside its ward when the ward is struck, shields both from the two defences, and fires once', () => {
    setup();
    cast(carapaceLeap, 3, 0);
    state().damageUnit('other', 10, 'f');
    flushReactions(SILENT_SINK);
    expect(unitNow('beetle').position).toEqual(at(0, 0));

    state().damageUnit('ward', 10, 'f');
    flushReactions(SILENT_SINK);
    expect(hexDistance(unitNow('beetle').position, unitNow('ward').position)).toBe(1);
    const expected = Math.round(B.LEAP_BARRIER * shell(unitNow('beetle')));
    expect(effectOn('beetle', AuraType.Barrier)?.magnitude).toBe(expected);
    expect(effectOn('ward', AuraType.Barrier)?.magnitude).toBe(expected);
    expect(effectOn('other', AuraType.Barrier)).toBeUndefined();
    expect(state().reactions).toHaveLength(0);
  });

  it('lays the Barriers before the blow lands, so the ward\'s Barrier soaks it (PT-09)', () => {
    setup();
    cast(carapaceLeap, 3, 0);
    const hp = unitNow('ward').currentHp;
    const blow = makeSkill({ id: 'slash', name: 'Jab', damage: 0.2, range: 6 });
    resolveSkillUse(unitNow('f'), blow, at(3, 0), SILENT_SINK);
    // Leapt and spent during the blow itself, not after it
    expect(hexDistance(unitNow('beetle').position, unitNow('ward').position)).toBe(1);
    expect(state().reactions).toHaveLength(0);
    // The ward lost nothing: the Barrier laid first took the whole of a light blow
    expect(unitNow('ward').currentHp).toBe(hp);
    const full = Math.round(B.LEAP_BARRIER * shell(unitNow('beetle')));
    expect(effectOn('ward', AuraType.Barrier)?.magnitude ?? 0).toBeLessThan(full);
    expect(effectOn('beetle', AuraType.Barrier)?.magnitude).toBe(full);
    // Nothing is left to answer once the action resolves
    flushReactions(SILENT_SINK);
    expect(unitNow('ward').currentHp).toBe(hp);
  });

  it('refuses the leap while Rooted, and the Reaction waits for the Root to lift', () => {
    setup({ activeEffects: [{ type: AfflictionType.Root, magnitude: 1, duration: 1 }] });
    cast(carapaceLeap, 3, 0);
    state().damageUnit('ward', 10, 'f');
    flushReactions(SILENT_SINK);
    expect(unitNow('beetle').position).toEqual(at(0, 0));
    expect(state().reactions).toHaveLength(1);

    state().removeEffect('beetle', AfflictionType.Root);
    state().damageUnit('ward', 10, 'f');
    flushReactions(SILENT_SINK);
    expect(hexDistance(unitNow('beetle').position, unitNow('ward').position)).toBe(1);
    expect(state().reactions).toHaveLength(0);
  });
});

describe('Grip and Throw', () => {
  // From the board's west edge, so three hexes of throw stay on it
  const west = () => beetle([], { position: at(-3, 0) });

  it('throws an adjacent enemy three hexes straight back and Stuns it', () => {
    useCombatStore.setState({ units: [west(), foe('f', -2, 0)] });
    expect(cast(gripAndThrow, -2, 0).ok).toBe(true);
    expect(unitNow('f').position).toEqual(at(-2 + B.THROW_DISTANCE, 0));
    expect(effectOn('f', AfflictionType.Stun)).toBeDefined();
  });

  it('stops the throw at a blocker on the line', () => {
    useCombatStore.setState({ units: [west(), foe('f', -2, 0), foe('wall', 0, 0)] });
    cast(gripAndThrow, -2, 0);
    expect(unitNow('f').position).toEqual(at(-1, 0));
    expect(unitNow('wall').position).toEqual(at(0, 0));
    expect(effectOn('f', AfflictionType.Stun)).toBeDefined();
  });

  it('hands a boss the heavier blow and nothing else', () => {
    const boss = () => foe('boss', 1, 0, { templateId: bossTemplate.id });
    expect(immovableTarget(boss())).toBe(true);
    expect(immovableTarget(foe('f', 1, 0))).toBe(false);

    useCombatStore.setState({ units: [beetle(), foe('f', 1, 0)] });
    cast(gripAndThrow, 1, 0);
    const thrown = 2000 - unitNow('f').currentHp;

    state().reset();
    useCombatStore.setState({ units: [beetle(), boss()] });
    expect(cast(gripAndThrow, 1, 0).ok).toBe(true);
    const lifted = 2000 - unitNow('boss').currentHp;
    expect(unitNow('boss').position).toEqual(at(1, 0));
    expect(effectOn('boss', AfflictionType.Stun)).toBeUndefined();
    expect(lifted / thrown).toBeCloseTo(B.THROW_IMMOVABLE_DAMAGE / gripAndThrow.damage!, 1);
  });
});

describe('Shell Wall', () => {
  it('shields the Beetle and every ally within two hexes from the two defences, for three turns', () => {
    useCombatStore.setState({
      units: [beetle(), ally('near', 1, 0), ally('edge', 0, 2), ally('out', 0, 3), foe('f', -2, 0)],
    });
    expect(cast(shellWall, 0, 0).ok).toBe(true);
    const expected = Math.round(B.SHELL_WALL_BARRIER * shell(unitNow('beetle')));
    for (const id of ['beetle', 'near', 'edge']) {
      expect(effectOn(id, AuraType.Barrier)).toMatchObject({ magnitude: expected, duration: B.SHELL_WALL_TURNS });
    }
    expect(effectOn('out', AuraType.Barrier)).toBeUndefined();
    expect(effectOn('f', AuraType.Barrier)).toBeUndefined();
  });

  it('grows with the shell: a Barrier read from a Beetle with more defence is larger', () => {
    useCombatStore.setState({ units: [beetle([], { stats: stats({ defense: 40, magicDefense: 30 }) })] });
    cast(shellWall, 0, 0);
    expect(effectOn('beetle', AuraType.Barrier)?.magnitude).toBe(Math.round(B.SHELL_WALL_BARRIER * 70));
  });
});

// ─── The capstones ────────────────────────────────────────────────────────────

/** A plain enemy blow: one body, or every body round the aim. */
const jab = makeSkill({ id: 'slash', name: 'Jab', damage: 1, range: 6 });
const quake = makeSkill({
  id: 'slash', name: 'Quake', damage: 1, range: 6, targetType: SkillTargetType.Ring, aoeRadius: 1,
});
const strike = (foeId: string, skill: HeroSkill, q: number, r: number) =>
  resolveSkillUse(unitNow(foeId), skill, at(q, r), SILENT_SINK);
const hpLost = (id: string, before: Record<string, number>) => before[id] - unitNow(id).currentHp;
const hpOf = () => Object.fromEntries(state().units.map((u) => [u.id, u.currentHp]));

describe('Vengeful Shell', () => {
  const setup = (over: Partial<CombatUnit> = {}) =>
    useCombatStore.setState({
      units: [
        beetle([], { skills: [vengefulShell], ...over }),
        // `far` just past the authored (rank-two) reach
        ally('ward', 0, 2), ally('far', 0, -(B.VENGEFUL_REACH + 1)), foe('f', 0, 3), foe('g', 0, -(B.VENGEFUL_REACH + 2)),
      ],
    });
  const ready = () => expect(cast(vengefulShell, 0, 0).ok).toBe(true);

  it('outlines the hexes it covers round the Beetle while it is prepared (playtest 2026-10-30)', () => {
    setup();
    expect(interceptHexes(state().units, state().reactions)).toEqual([]);
    ready();
    const covered = interceptHexes(state().units, state().reactions);
    expect(covered.length).toBeGreaterThan(0);
    expect(covered.every((h) => hexDistance(h, at(0, 0)) >= 1 && hexDistance(h, at(0, 0)) <= B.VENGEFUL_REACH)).toBe(true);
    expect(covered.some((h) => hexDistance(h, at(0, 0)) === B.VENGEFUL_REACH)).toBe(true);
    // A fallen Beetle covers nothing
    const fallen = state().units.map((u) => (u.id === 'beetle' ? { ...u, currentHp: 0 } : u));
    expect(interceptHexes(fallen, state().reactions)).toEqual([]);
  });

  it('is a Reaction that spends the turn, ready for two turns and two blows a round', () => {
    setup();
    ready();
    expect(state().reactions[0]).toMatchObject({ ownerId: 'beetle', turnsLeft: B.VENGEFUL_TURNS, shotsLeft: B.VENGEFUL_ANSWERS });
    expect(unitNow('beetle')).toMatchObject({ hasMoved: true, hasActed: true });
    expect(unitNow('beetle').currentMana).toBe(60 - vengefulShell.manaCost);
  });

  it('leaps beside the struck ally and takes the blow before it lands, then strikes the attacker', () => {
    setup();
    ready();
    const before = hpOf();
    strike('f', jab, 0, 2);
    // The blow never reached the ally: the Beetle stood beside them and took it
    expect(hpLost('ward', before)).toBe(0);
    expect(hpLost('beetle', before)).toBeGreaterThan(0);
    expect(hexDistance(unitNow('beetle').position, unitNow('ward').position)).toBe(1);
    // The answer comes once the action has resolved, at the attacker
    expect(hpLost('f', before)).toBe(0);
    flushReactions(SILENT_SINK);
    expect(hpLost('f', before)).toBeGreaterThan(0);
    expect(state().reactions[0].shotsLeft).toBe(B.VENGEFUL_ANSWERS - 1);
  });

  it('takes up to two blows a round, and refills with the Beetle\'s next turn', () => {
    setup();
    ready();
    for (let i = 0; i < B.VENGEFUL_ANSWERS; i++) {
      const before = hpOf();
      strike('f', jab, 0, 2);
      flushReactions(SILENT_SINK);
      expect(hpLost('ward', before)).toBe(0);
    }
    const before = hpOf();
    strike('f', jab, 0, 2);
    flushReactions(SILENT_SINK);
    expect(hpLost('ward', before)).toBeGreaterThan(0);
    expect(hpLost('f', before)).toBe(0);
    // The Beetle's next regular turn gives it its answers back
    state().tickReactionsFor('beetle');
    expect(state().reactions[0].shotsLeft).toBe(B.VENGEFUL_ANSWERS);
  });

  it('does not take an area blow, or a blow at an ally out of reach', () => {
    setup();
    ready();
    let before = hpOf();
    strike('f', quake, 0, 2);
    flushReactions(SILENT_SINK);
    expect(hpLost('ward', before)).toBeGreaterThan(0);
    expect(unitNow('beetle').position).toEqual(at(0, 0));

    before = hpOf();
    strike('g', jab, 0, -(B.VENGEFUL_REACH + 1));
    flushReactions(SILENT_SINK);
    expect(hpLost('far', before)).toBeGreaterThan(0);
    expect(unitNow('beetle').position).toEqual(at(0, 0));
    expect(state().reactions[0].shotsLeft).toBe(B.VENGEFUL_ANSWERS);
  });

  it('cannot leap while Rooted, but takes the blow where it stands when already beside the ally', () => {
    const root = { type: AfflictionType.Root, magnitude: 1, duration: 2 };
    setup({ activeEffects: [root] });
    ready();
    let before = hpOf();
    strike('f', jab, 0, 2);
    expect(hpLost('ward', before)).toBeGreaterThan(0);
    expect(unitNow('beetle').position).toEqual(at(0, 0));

    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'ward' ? { ...u, position: at(0, 1) } : u)) }));
    before = hpOf();
    strike('f', jab, 0, 1);
    expect(hpLost('ward', before)).toBe(0);
    expect(hpLost('beetle', before)).toBeGreaterThan(0);
  });
});

describe('Carapace Bastion', () => {
  const setup = () =>
    useCombatStore.setState({
      units: [beetle([], { skills: [carapaceBastion] }), ally('inside', 1, 0), ally('outside', 3, 0), foe('f', 2, 0)],
    });

  it('turns the ground within its radius into static ground for two of its turns', () => {
    setup();
    expect(cast(carapaceBastion, 0, 0).ok).toBe(true);
    const ground = state().hazards.find((h) => h.bastion)!;
    expect(ground).toMatchObject({ ownerId: 'beetle', turnsLeft: B.BASTION_TURNS, solid: false });
    // Every hex within the rank-two radius (2): the Beetle's, its six and the twelve beyond
    expect(ground.hexes).toHaveLength(1 + 3 * B.BASTION_RADIUS * (B.BASTION_RADIUS + 1));
    // Static: the Beetle walking off leaves the ground where it fell
    state().moveUnit('beetle', at(-2, 0));
    expect(state().hazards.find((h) => h.bastion)!.hexes).toEqual(ground.hexes);
    state().tickHazards('beetle');
    expect(state().hazards.some((h) => h.bastion)).toBe(true);
    state().tickHazards('beetle');
    expect(state().hazards.some((h) => h.bastion)).toBe(false);
  });

  it('sends half of a struck ally\'s blow inside it to the Beetle, and nothing outside it', () => {
    setup();
    cast(carapaceBastion, 0, 0);
    let before = hpOf();
    const result = state().damageUnit('inside', 40, 'f');
    expect(hpLost('inside', before)).toBe(40 * (1 - B.BASTION_SHARE));
    expect(hpLost('beetle', before)).toBe(40 * B.BASTION_SHARE);
    expect(result.shared).toBe(40 * B.BASTION_SHARE);

    before = hpOf();
    state().damageUnit('outside', 40, 'f');
    expect(hpLost('outside', before)).toBe(40);
    expect(hpLost('beetle', before)).toBe(0);
  });

  it('never splits the Beetle\'s own blows, nor what has no hostile author', () => {
    setup();
    cast(carapaceBastion, 0, 0);
    let before = hpOf();
    state().damageUnit('beetle', 40, 'f');
    expect(hpLost('beetle', before)).toBe(40);
    before = hpOf();
    state().damageUnit('inside', 40);
    expect(hpLost('inside', before)).toBe(40);
    expect(hpLost('beetle', before)).toBe(0);
  });

  it('splits a resolved enemy strike the same way, the Beetle\'s half down its own funnel', () => {
    setup();
    cast(carapaceBastion, 0, 0);
    // A Barrier on the Beetle eats its half first: the split goes down the Beetle's funnel
    state().applyEffect('beetle', { type: AuraType.Barrier, magnitude: 1000, duration: 2, sourceUnitId: 'beetle' });
    const before = hpOf();
    strike('f', jab, 1, 0);
    expect(hpLost('inside', before)).toBeGreaterThan(0);
    expect(hpLost('beetle', before)).toBe(0);
    expect(effectOn('beetle', AuraType.Barrier)!.magnitude).toBeLessThan(1000);
  });
});

describe('Shell Swap', () => {
  const setup = (over: Partial<CombatUnit> = {}) =>
    useCombatStore.setState({
      units: [
        beetle([], { skills: [shellSwap], ...over }),
        ally('pinned', 0, 3), ally('far', 0, -5), foe('f', 0, 4), foe('g', 1, 3),
      ],
    });

  it('trades places with the ally, shields both from the Beetle\'s defences and shoves the enemies round its new hex', () => {
    setup();
    expect(cast(shellSwap, 0, 3).ok).toBe(true);
    expect(unitNow('beetle').position).toEqual(at(0, 3));
    expect(unitNow('pinned').position).toEqual(at(0, 0));
    const expected = Math.round(B.SWAP_BARRIER * shell(unitNow('beetle')));
    expect(effectOn('beetle', AuraType.Barrier)?.magnitude).toBe(expected);
    expect(effectOn('pinned', AuraType.Barrier)?.magnitude).toBe(expected);
    for (const id of ['f', 'g']) {
      expect(hexDistance(unitNow(id).position, at(0, 3))).toBe(1 + B.SWAP_PUSH);
      expect(effectOn(id, AfflictionType.AttackDown)?.magnitude).toBe(B.SWAP_ATTACK_DOWN);
    }
    expect(unitNow('beetle').currentMana).toBe(60 - shellSwap.manaCost);
  });

  it('refuses an ally out of reach, an enemy, and a Rooted Beetle', () => {
    setup();
    expect(cast(shellSwap, 0, -5).ok).toBe(false);
    expect(cast(shellSwap, 0, 4).ok).toBe(false);
    expect(unitNow('beetle').position).toEqual(at(0, 0));
    setup({ activeEffects: [{ type: AfflictionType.Root, magnitude: 1, duration: 2 }] });
    expect(cast(shellSwap, 0, 3).ok).toBe(false);
    expect(unitNow('pinned').position).toEqual(at(0, 3));
  });
});
