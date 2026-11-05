import { AfflictionType, AuraType, CombatUnit, HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { victoryRewards } from '@/systems/combat/combatRewards';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import {
  fracturedHeroes,
  mireHexes,
  SEED_KIND,
  seedsOf,
  thrallsOf,
} from '@/systems/combat/eliteKits';
import { previewPrepared } from '@/systems/combat/preparedAttacks';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { hasEffect } from '@/systems/combat/statusEffects';
import { beginTurn } from '@/systems/combat/turnStart';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The elites whose signature is a warning the party can answer: the Bog Hulk's marsh,
 * the Delve Overseer's cracked ground, the Coven Matriarch's seed and the Ashwood
 * Crone's Geas. Pinned as rules: the footprint is fixed or follows the marked, the
 * preview is the resolution, and every answer the plan names really does answer it.
 */

const swing = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 6 });
const spell = makeSkill({ id: 'bolt' as HeroSkill['id'], damage: 0.5, range: 6, manaCost: 5 });
const basic = makeSkill({ id: BASIC_ATTACK_ID as HeroSkill['id'], damage: 0.5, range: 6 });

const hero = (id: string, position = at(0, 2), extra: Partial<CombatUnit> = {}) =>
  makeUnit({
    id, heroId: id, name: id, position,
    stats: makeStats({ maxHp: 4000, attack: 30, defense: 0, speed: 5, critChance: 0, dodgeChance: 0, maxMana: 50 }),
    skills: [swing, spell, basic],
    ...extra,
  });

const units = () => useCombatStore.getState().units;
const find = (id: string) => units().find((u) => u.id === id)!;
const byTemplate = (t: string): CombatUnit => units().find((u) => u.templateId === t)!;
const prepared = () => useCombatStore.getState().preparedAttacks;

function start(template: string, at0: ReturnType<typeof at>, heroes: CombatUnit[]) {
  const store = useCombatStore.getState();
  store.reset();
  const [elite] = createEnemyUnits([template], [at0], 1, 1);
  store.initCombat(heroes, [elite]);
  return elite.id;
}

/** One turn of the elite through the real AI, a skill forced when `only` names one. */
function eliteTurn(template: string, only?: string) {
  const unit = byTemplate(template);
  useCombatStore.getState().beginTurnFlags(unit.id);
  const view = only ? { ...unit, skills: unit.skills.filter((s) => s.id === only) } : unit;
  const actions = decideEnemyAction(view, units());
  executeAIActions(unit, actions);
  return actions;
}

/** Every responder has had their turn: whatever is open lands from its caster's turn. */
function land(template: string) {
  const store = useCombatStore.getState();
  for (const p of prepared()) store.updatePreparedAttack(p.id, { responded: p.responders });
  resolveDuePrepared(byTemplate(template).id, SILENT_SINK);
}

// ── Bog Hulk: Mire Undertow ──────────────────────────────────────────────────

describe('Mire Undertow', () => {
  const HULK = at(0, -3);
  const near = at(-1, -2);
  const far = at(0, 0);
  const startHulk = (heroes = [hero('near', near), hero('far', far)]) => start('bog_hulk', HULK, heroes);

  it('slams at once and leaves a marked marsh whose heroes owe a window', () => {
    startHulk();
    const before = find('near').currentHp;
    eliteTurn('bog_hulk', 'mire_undertow');
    expect(find('near').currentHp).toBeLessThan(before);
    expect(find('far').currentHp).toBe(find('far').stats.maxHp);
    expect(prepared()).toHaveLength(1);
    const marsh = prepared()[0];
    expect(marsh.scripted).toBe('undertow');
    expect(marsh.hexes).toHaveLength(mireHexes(HULK).length);
    expect(marsh.responders.sort()).toEqual(['far', 'near']);
  });

  it('drags heroes still standing in it toward the Hulk, exactly where the preview said', () => {
    startHulk();
    eliteTurn('bog_hulk', 'mire_undertow');
    const preview = previewPrepared(prepared()[0], units(), useCombatStore.getState().hazards);
    const promised = preview.landings.find((m) => m.unitId === 'far')!;
    expect(promised.moved).toBe(true);
    expect(hexDistance(promised.to, HULK)).toBeLessThan(hexDistance(far, HULK));

    land('bog_hulk');
    expect(find('far').position).toEqual(promised.to);
    expect(hexDistance(find('far').position, HULK)).toBe(hexDistance(far, HULK) - BALANCE.MIRE_PULL);
    // The one already beside him has nowhere nearer to go
    expect(find('near').position).toEqual(near);
  });

  it('lets a hero who left the marsh stay where they chose to be', () => {
    startHulk();
    eliteTurn('bog_hulk', 'mire_undertow');
    const out = at(2, 1);
    expect(hexDistance(out, HULK)).toBeGreaterThan(BALANCE.MIRE_RADIUS);
    useCombatStore.getState().moveUnit('far', out);
    land('bog_hulk');
    expect(find('far').position).toEqual(out);
  });

  it('is held off by a body that cannot be moved', () => {
    startHulk([hero('near', near), hero('far', far, { passives: ['immovable'] })]);
    eliteTurn('bog_hulk', 'mire_undertow');
    land('bog_hulk');
    expect(find('far').position).toEqual(far);
  });

  it('stops a pulled hero before a body in the way instead of putting two on a hex', () => {
    // 'far' is pulled along the same line 'blocker' stands on
    startHulk([hero('near', near), hero('far', far), hero('blocker', at(0, -1))]);
    eliteTurn('bog_hulk', 'mire_undertow');
    land('bog_hulk');
    const keys = units().filter((u) => u.currentHp > 0).map((u) => hexKey(u.position));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is a plain slam when a warning of the Hulk is already open: no second marsh', () => {
    startHulk();
    eliteTurn('bog_hulk', 'mire_undertow');
    useCombatStore.getState().tickCooldowns(byTemplate('bog_hulk').id);
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.templateId === 'bog_hulk' ? { ...u, cooldowns: {} } : u)),
    }));
    eliteTurn('bog_hulk', 'mire_undertow');
    expect(prepared()).toHaveLength(1);
  });

  // PT-14: the slam struck nobody, the resolver refused it, and the turn was gone
  it('walks in rather than slamming at nobody when the party waits two or three hexes off', () => {
    for (const spot of [at(0, -1), at(0, 0)]) {
      startHulk([hero('waits', spot)]);
      const before = hexDistance(byTemplate('bog_hulk').position, spot);
      const actions = eliteTurn('bog_hulk');
      expect(actions.some((a) => a.type === 'skill' && a.skill?.id === 'mire_undertow')).toBe(false);
      expect(hexDistance(byTemplate('bog_hulk').position, spot)).toBeLessThan(before);
      expect(prepared()).toHaveLength(0);
    }
  });

  it('still lays the marsh over heroes further out once someone stands beside him', () => {
    startHulk();
    const actions = eliteTurn('bog_hulk');
    expect(actions.find((a) => a.type === 'skill')?.skill?.id).toBe('mire_undertow');
    expect(prepared()).toHaveLength(1);
  });
});

// ── A refused cast is not the whole turn ─────────────────────────────────────

describe('an AI cast the resolver refuses', () => {
  it('walks toward the fight instead of standing still (PT-14)', () => {
    start('bog_hulk', at(0, -3), [hero('far', at(0, 1))]);
    const hulk = byTemplate('bog_hulk');
    useCombatStore.getState().beginTurnFlags(hulk.id);
    const slam = hulk.skills.find((s) => s.id === 'mire_undertow')!;
    // Aimed at nobody: the slam reaches one hex and the hero is four away
    executeAIActions(hulk, [{ type: 'skill', skill: slam, skillTarget: hulk.position }, { type: 'endturn' }]);
    expect(hexDistance(byTemplate('bog_hulk').position, at(0, 1))).toBeLessThan(4);
  });
});

// ── Bog Hulk: Maul ───────────────────────────────────────────────────────────

describe('the Bog Hulk\'s Maul', () => {
  it('waits its cooldown after it shoves, and the Hulk swings his club in between (PT-14)', () => {
    start('bog_hulk', at(0, -3), [hero('beside', at(0, -2), { skills: [] })]);
    // Without the marsh, whose cooldown would otherwise decide some of these turns
    const kitOf = () => byTemplate('bog_hulk').skills.filter((s) => s.id !== 'mire_undertow');
    const turn = () => {
      const id = byTemplate('bog_hulk').id;
      useCombatStore.getState().tickCooldowns(id);
      useCombatStore.getState().beginTurnFlags(id);
      // Back beside him every turn, as a melee hero would walk
      useCombatStore.getState().moveUnit('beside', at(0, -2));
      const unit = byTemplate('bog_hulk');
      const actions = decideEnemyAction({ ...unit, skills: kitOf() }, units());
      executeAIActions(unit, actions);
      return actions.find((a) => a.type === 'skill')?.skill?.id;
    };
    expect(turn()).toBe('beast_maul');
    for (let wait = 0; wait < BALANCE.MAUL_COOLDOWN; wait++) expect(turn()).toBe('club_strike');
    expect(turn()).toBe('beast_maul');
  });
});

// ── Delve Overseer: Fracture ─────────────────────────────────────────────────

describe('Fracture', () => {
  const OVERSEER = at(0, -3);
  const startOverseer = (heroes = [hero('a', at(-2, 0)), hero('b', at(3, 0)), hero('c', at(3, -1))]) =>
    start('delve_overseer', OVERSEER, heroes);

  it('leaves a Fracture mark beside the Defense it shreds', () => {
    startOverseer([hero('a', at(0, -2))]);
    eliteTurn('delve_overseer', 'fracturing_breaker');
    expect(hasEffect(find('a'), AfflictionType.Fracture)).toBe(true);
    expect(hasEffect(find('a'), AfflictionType.DefenseDown)).toBe(true);
    expect(fracturedHeroes(units()).map((h) => h.id)).toEqual(['a']);
  });

  it('strikes at once when nobody is Fractured', () => {
    startOverseer([hero('a', at(0, -2)), hero('b', at(3, 0))]);
    const before = find('a').currentHp;
    eliteTurn('delve_overseer', 'fracture_slam');
    expect(prepared()).toHaveLength(0);
    expect(find('a').currentHp).toBeLessThan(before);
  });

  it('is announced against a Fractured hero, over the Overseer and over every marked hero', () => {
    startOverseer();
    useCombatStore.getState().applyEffect('b', {
      type: AfflictionType.Fracture, magnitude: 1, duration: BALANCE.FRACTURE_TURNS, sourceUnitId: byTemplate('delve_overseer').id,
    });
    eliteTurn('delve_overseer', 'fracture_slam');
    expect(prepared()).toHaveLength(1);
    const warning = prepared()[0];
    expect(warning.scripted).toBe('fracture');
    expect(warning.bound).toEqual(['b']);
    const covered = new Set(warning.hexes.map(hexKey));
    // The ground round the Overseer, and round b — far from him
    expect(covered.has(hexKey(OVERSEER))).toBe(true);
    expect(covered.has(hexKey(find('b').position))).toBe(true);
    // c stands beside b, so is in b's ring; nobody is struck yet
    expect(warning.responders).toEqual(expect.arrayContaining(['b']));
    expect(find('b').currentHp).toBe(find('b').stats.maxHp);
  });

  it('follows the marked hero, so the secondary footprint always matches where they stand', () => {
    startOverseer();
    useCombatStore.getState().applyEffect('b', {
      type: AfflictionType.Fracture, magnitude: 1, duration: BALANCE.FRACTURE_TURNS, sourceUnitId: byTemplate('delve_overseer').id,
    });
    eliteTurn('delve_overseer', 'fracture_slam');
    const from = find('b').position;
    const to = at(-3, 3);
    useCombatStore.getState().moveUnit('b', to);
    beginTurn(find('a').id, SILENT_SINK);
    const covered = new Set(prepared()[0].hexes.map(hexKey));
    expect(covered.has(hexKey(to))).toBe(true);
    expect(covered.has(hexKey(from))).toBe(false);
  });

  it('owes a window to a hero the moving ring newly reaches', () => {
    startOverseer();
    useCombatStore.getState().applyEffect('b', {
      type: AfflictionType.Fracture, magnitude: 1, duration: BALANCE.FRACTURE_TURNS, sourceUnitId: byTemplate('delve_overseer').id,
    });
    eliteTurn('delve_overseer', 'fracture_slam');
    expect(prepared()[0].responders).not.toContain('a');
    // b steps next to a: a is now inside the ring that follows b
    useCombatStore.getState().moveUnit('b', at(-1, 0));
    beginTurn(find('a').id, SILENT_SINK);
    expect(prepared()[0].responders).toContain('a');
  });

  it('drops a ring when the hero is cleansed: cleansing answers it', () => {
    startOverseer();
    useCombatStore.getState().applyEffect('b', {
      type: AfflictionType.Fracture, magnitude: 1, duration: BALANCE.FRACTURE_TURNS, sourceUnitId: byTemplate('delve_overseer').id,
    });
    eliteTurn('delve_overseer', 'fracture_slam');
    useCombatStore.getState().removeAllAfflictions('b');
    beginTurn(find('a').id, SILENT_SINK);
    expect(new Set(prepared()[0].hexes.map(hexKey)).has(hexKey(find('b').position))).toBe(false);
    land('delve_overseer');
    expect(find('b').currentHp).toBe(find('b').stats.maxHp);
  });

  it('erupts round the marked hero wherever they stand, strikes a hero beside them, and spends the marks', () => {
    startOverseer();
    useCombatStore.getState().applyEffect('b', {
      type: AfflictionType.Fracture, magnitude: 1, duration: BALANCE.FRACTURE_TURNS, sourceUnitId: byTemplate('delve_overseer').id,
    });
    eliteTurn('delve_overseer', 'fracture_slam');
    land('delve_overseer');
    expect(find('b').currentHp).toBeLessThan(find('b').stats.maxHp);
    expect(find('c').currentHp).toBeLessThan(find('c').stats.maxHp);
    expect(hasEffect(find('b'), AfflictionType.Fracture)).toBe(false);
    expect(prepared()).toHaveLength(0);
  });

  it('spares a hero who spread out of every ring', () => {
    startOverseer([hero('a', at(0, -2)), hero('b', at(3, 0)), hero('far', at(-3, 3))]);
    useCombatStore.getState().applyEffect('b', {
      type: AfflictionType.Fracture, magnitude: 1, duration: BALANCE.FRACTURE_TURNS, sourceUnitId: byTemplate('delve_overseer').id,
    });
    eliteTurn('delve_overseer', 'fracture_slam');
    land('delve_overseer');
    expect(find('far').currentHp).toBe(find('far').stats.maxHp);
  });
});

// ── Coven Matriarch: Briar Claim ─────────────────────────────────────────────

describe('Briar Claim', () => {
  const MATRIARCH = at(0, -3);
  const startCoven = (heroes = [hero('a', at(0, -1)), hero('b', at(3, 0))]) => start('coven_matriarch', MATRIARCH, heroes);

  it('plants a visible, attackable seed beside a hero her Blight poisoned', () => {
    startCoven();
    eliteTurn('coven_matriarch', 'briar_blight');
    const m = byTemplate('coven_matriarch');
    const seeds = seedsOf(m, units());
    expect(seeds).toHaveLength(1);
    expect(seeds[0].objective?.kind).toBe(SEED_KIND);
    expect(seeds[0].isPlayer).toBe(false);
    const hero = find(seeds[0].objective!.linkedUnitId!);
    expect(hasEffect(hero, AfflictionType.Poison)).toBe(true);
    expect(hexDistance(seeds[0].position, hero.position)).toBe(1);
    expect(prepared()[0].scripted).toBe('briar');
    expect(prepared()[0].responders).toEqual([hero.id]);
  });

  it('grows into a Thrall after the window if the seed stands and the poison holds', () => {
    startCoven();
    eliteTurn('coven_matriarch', 'briar_blight');
    const seed = seedsOf(byTemplate('coven_matriarch'), units())[0];
    land('coven_matriarch');
    const m = byTemplate('coven_matriarch');
    expect(thrallsOf(m, units())).toHaveLength(1);
    expect(thrallsOf(m, units())[0].position).toEqual(seed.position);
    expect(seedsOf(m, units())).toHaveLength(0);
  });

  it('withers when the party cleanses the poison', () => {
    startCoven();
    eliteTurn('coven_matriarch', 'briar_blight');
    const heroId = prepared()[0].responders[0];
    useCombatStore.getState().removeAllAfflictions(heroId);
    land('coven_matriarch');
    expect(thrallsOf(byTemplate('coven_matriarch'), units())).toHaveLength(0);
    expect(seedsOf(byTemplate('coven_matriarch'), units())).toHaveLength(0);
  });

  it('is cancelled outright when the seed is destroyed', () => {
    startCoven();
    eliteTurn('coven_matriarch', 'briar_blight');
    const seed = seedsOf(byTemplate('coven_matriarch'), units())[0];
    useCombatStore.getState().damageUnit(seed.id, 9999, 'a');
    expect(prepared()).toHaveLength(0);
    expect(thrallsOf(byTemplate('coven_matriarch'), units())).toHaveLength(0);
  });

  it('plants one seed at a time and never past her Thrall cap', () => {
    startCoven();
    eliteTurn('coven_matriarch', 'briar_blight');
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.templateId === 'coven_matriarch' ? { ...u, cooldowns: {} } : u)),
    }));
    eliteTurn('coven_matriarch', 'briar_blight');
    expect(seedsOf(byTemplate('coven_matriarch'), units())).toHaveLength(1);

    // With her Thralls at the cap, a Blight is only a Blight
    startCoven();
    const m = byTemplate('coven_matriarch');
    const extra = createEnemyUnits(Array(BALANCE.BRIAR_THRALL_CAP).fill('coven_thrall'), [at(-3, -2), at(3, -4)], 1, 1)
      .map((t) => ({ ...t, summonedBy: m.id }));
    useCombatStore.getState().addUnits(extra);
    eliteTurn('coven_matriarch', 'briar_blight');
    expect(seedsOf(byTemplate('coven_matriarch'), units())).toHaveLength(0);
  });

  it('pays no second reward for a Thrall she grew', () => {
    startCoven();
    const m = byTemplate('coven_matriarch');
    const [thrall] = createEnemyUnits(['coven_thrall'], [at(-3, -2)], 1, 1);
    const withThrall = [...units(), { ...thrall, summonedBy: m.id }];
    const base = { heroes: [], encounterId: 'x', threatBand: 1, castleRun: undefined, isLastStage: false } as never;
    const a = victoryRewards({ ...(base as object), units: units() } as never);
    const b = victoryRewards({ ...(base as object), units: withThrall } as never);
    expect(b.gold).toBe(a.gold);
  });
});

// ── Ashwood Crone: Witch's Geas ──────────────────────────────────────────────

describe('Witch\'s Geas', () => {
  const CRONE = at(0, -3);
  const startCrone = (heroes = [hero('a', at(0, 0)), hero('b', at(3, 0))]) => start('ashwood_crone', CRONE, heroes);
  const geas = (id: string) =>
    useCombatStore.getState().applyEffect(id, {
      type: AfflictionType.Geas, magnitude: 1, duration: BALANCE.GEAS_TURNS, sourceUnitId: byTemplate('ashwood_crone').id,
    });
  const cast = (id: string, skill: HeroSkill, target = at(0, -3)) =>
    resolveSkillUse(find(id), skill, target, SILENT_SINK);

  it('marks one hero, with a curse that is visible and strikes nobody', () => {
    startCrone();
    const before = find('a').currentHp;
    eliteTurn('ashwood_crone', 'witchs_geas');
    const marked = units().filter((u) => hasEffect(u, AfflictionType.Geas));
    expect(marked).toHaveLength(1);
    expect(find(marked[0].id).currentHp).toBeLessThanOrEqual(before);
    expect(prepared()).toHaveLength(0);
  });

  it('lets the spell work and raises a warned eruption round the caster', () => {
    startCrone();
    geas('a');
    const before = find(byTemplate('ashwood_crone').id).currentHp;
    cast('a', spell);
    expect(find(byTemplate('ashwood_crone').id).currentHp).toBeLessThan(before);
    expect(hasEffect(find('a'), AfflictionType.Geas)).toBe(false);
    expect(prepared()).toHaveLength(1);
    const eruption = prepared()[0];
    expect(eruption.skill.id).toBe('geas_eruption');
    expect(eruption.hexes.map(hexKey)).toContain(hexKey(find('a').position));
    expect(eruption.responders).toContain('a');
    // Warned, not struck
    expect(find('a').currentHp).toBe(find('a').stats.maxHp);
  });

  it('lands the eruption after the window', () => {
    startCrone();
    geas('a');
    cast('a', spell);
    land('ashwood_crone');
    expect(find('a').currentHp).toBeLessThan(find('a').stats.maxHp);
    expect(find('b').currentHp).toBe(find('b').stats.maxHp);
  });

  it('is avoided by a basic attack, which lifts the curse unspent', () => {
    startCrone();
    geas('a');
    cast('a', basic);
    expect(hasEffect(find('a'), AfflictionType.Geas)).toBe(false);
    expect(prepared()).toHaveLength(0);
  });

  it('is avoided by a cleanse', () => {
    startCrone();
    geas('a');
    useCombatStore.getState().removeAllAfflictions('a');
    cast('a', spell);
    expect(prepared()).toHaveLength(0);
  });

  it('never punishes an unmarked hero, spell or not', () => {
    startCrone();
    geas('a');
    cast('b', spell);
    cast('b', basic);
    expect(prepared()).toHaveLength(0);
    expect(hasEffect(find('a'), AfflictionType.Geas)).toBe(true);
  });

  it('is not cast on a hero while one is already carrying it', () => {
    startCrone();
    geas('a');
    const actions = eliteTurn('ashwood_crone', 'witchs_geas');
    expect(actions.some((a) => a.skill?.id === 'witchs_geas')).toBe(false);
  });

  it('dies with its Crone: a fallen witch raises nothing', () => {
    startCrone();
    geas('a');
    useCombatStore.getState().damageUnit(byTemplate('ashwood_crone').id, 99999, 'b');
    cast('a', spell);
    expect(prepared()).toHaveLength(0);
  });

  it('is not an aura: it is a curse a cleanse can reach', () => {
    startCrone();
    geas('a');
    expect(find('a').activeEffects.some((e) => e.type === AuraType.Barrier)).toBe(false);
  });
});

// ── A fallen caster leaves nothing standing ──────────────────────────────────

describe('a caster who falls mid-warning', () => {
  it('takes the marsh of the Hulk off the board with him', () => {
    start('bog_hulk', at(0, -3), [hero('near', at(-1, -2)), hero('far', at(0, 0))]);
    eliteTurn('bog_hulk', 'mire_undertow');
    expect(prepared()).toHaveLength(1);
    // Last Breath spares the first blow; the Hulk is only gone once it has been spent
    useCombatStore.getState().damageUnit(byTemplate('bog_hulk').id, 99999, 'near');
    useCombatStore.getState().damageUnit(byTemplate('bog_hulk').id, 99999, 'near');
    expect(byTemplate('bog_hulk').currentHp).toBe(0);
    expect(prepared()).toHaveLength(0);
  });

  it('takes the seed of the Matriarch with her, and no Thrall grows', () => {
    start('coven_matriarch', at(0, -3), [hero('a', at(0, -1)), hero('b', at(3, 0))]);
    eliteTurn('coven_matriarch', 'briar_blight');
    const m = byTemplate('coven_matriarch');
    expect(seedsOf(m, units())).toHaveLength(1);
    useCombatStore.getState().damageUnit(m.id, 99999, 'a');
    expect(seedsOf(m, units())).toHaveLength(0);
    expect(prepared()).toHaveLength(0);
    expect(thrallsOf(m, units())).toHaveLength(0);
  });

  it('takes the eruption of the Crone with her when she dies to a tick', () => {
    start('ashwood_crone', at(0, -3), [hero('a', at(0, 0))]);
    useCombatStore.getState().applyEffect('a', {
      type: AfflictionType.Geas, magnitude: 1, duration: BALANCE.GEAS_TURNS, sourceUnitId: byTemplate('ashwood_crone').id,
    });
    resolveSkillUse(find('a'), spell, at(0, -3), SILENT_SINK);
    expect(prepared()).toHaveLength(1);
    const crone = byTemplate('ashwood_crone');
    // Her Undying is already spent, so the tick is the end of her
    useCombatStore.setState((st) => ({
      units: st.units.map((u) =>
        u.id === crone.id
          ? { ...u, currentHp: 1, activeEffects: [...u.activeEffects, { type: AuraType.UndyingSpent, magnitude: 1, duration: -1 }] }
          : u,
      ),
    }));
    useCombatStore.getState().applyEffect(crone.id, {
      type: AfflictionType.Bleed, magnitude: 9, duration: 3, sourceUnitId: 'a',
    });
    useCombatStore.getState().tickEffectsOnUnit(crone.id);
    expect(byTemplate('ashwood_crone').currentHp).toBe(0);
    expect(prepared()).toHaveLength(0);
  });
});
