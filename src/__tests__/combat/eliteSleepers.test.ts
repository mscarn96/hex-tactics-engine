import { AfflictionType, AuraType, CombatUnit } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { hasEffect } from '@/systems/combat/statusEffects';
import { beginTurn } from '@/systems/combat/turnStart';
import { SILENT_SINK } from '@/systems/combat/skillResolution';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';
import { calculateDamage, resolveAttack } from '@/systems/combat/damageCalc';

/**
 * The Cave Bear's Winter Sleep: the first fatal blow is a sleep, not a death.
 * Pinned as rules — it happens once, it costs turns, it wakes at full health, and
 * the party's way to beat it inside the window is Defense it can take off.
 */

const hero = (id = 'h1') =>
  makeUnit({ id, heroId: id, position: at(0, 3), stats: makeStats({ maxHp: 4000, attack: 80, defense: 4, speed: 5 }) });

const units = () => useCombatStore.getState().units;
const bear = (): CombatUnit => units().find((u) => u.templateId === 'cave_bear')!;

function start() {
  const store = useCombatStore.getState();
  store.reset();
  const [b] = createEnemyUnits(['cave_bear'], [at(0, -3)], 1, 1);
  store.initCombat([hero()], [b]);
}

const lethal = () => useCombatStore.getState().damageUnit(bear().id, bear().currentHp + 500, 'h1');

describe('Winter Sleep', () => {
  it('turns the first fatal blow into a sleep and a little health back', () => {
    start();
    const maxHp = bear().stats.maxHp;
    lethal();
    const b = bear();
    expect(b.currentHp).toBe(1 + Math.round(maxHp * BALANCE.WINTER_SLEEP_HEAL));
    expect(hasEffect(b, AuraType.Slumber)).toBe(true);
    expect(hasEffect(b, AuraType.UndyingSpent)).toBe(true);
  });

  it('takes about 92% less from every strike while it sleeps, whatever the strike', () => {
    start();
    const h = units().find((u) => u.id === 'h1')!;
    const smash = makeSkill({ damage: 3 });
    const awake = calculateDamage(h, bear(), smash);
    lethal();
    const asleep = calculateDamage(h, bear(), smash);
    const kept = asleep / awake;
    expect(kept).toBeGreaterThan(0.05);
    expect(kept).toBeLessThan(0.1);
    // Armour penetration only changes what Defense is worth; the sleep still holds
    const piercer = { ...h, stats: { ...h.stats, armourPen: 100 } };
    const piercedAwake = calculateDamage(piercer, { ...bear(), activeEffects: [] }, smash);
    expect(calculateDamage(piercer, bear(), smash) / piercedAwake).toBeLessThan(0.1);
    // And a crit multiplies the reduced number, not the full one
    const always = () => 0.5;
    const crit = resolveAttack({ ...h, stats: { ...h.stats, critChance: 100 } }, bear(), smash, { rng: always });
    expect(crit.crit).toBe(true);
    expect(crit.damage).toBeLessThan(awake * 0.25);
  });

  it('loses its turns while it sleeps and wakes at full health on the last of them', () => {
    start();
    lethal();
    const id = bear().id;
    for (let turn = 1; turn <= BALANCE.WINTER_SLEEP_TURNS; turn++) {
      expect(beginTurn(id, SILENT_SINK).kind).toBe('asleep');
    }
    const b = bear();
    expect(b.currentHp).toBe(b.stats.maxHp);
    expect(hasEffect(b, AuraType.Slumber)).toBe(false);
    expect(beginTurn(id, SILENT_SINK).kind).toBe('act');
  });

  it('is finished off by anyone who kills it inside the window, and the fight ends', () => {
    start();
    lethal();
    useCombatStore.getState().damageUnit(bear().id, 9999, 'h1');
    expect(bear().currentHp).toBe(0);
  });

  it('never repeats: a woken Bear that is struck down again simply dies', () => {
    start();
    lethal();
    const id = bear().id;
    for (let i = 0; i < BALANCE.WINTER_SLEEP_TURNS; i++) beginTurn(id, SILENT_SINK);
    useCombatStore.getState().damageUnit(id, bear().currentHp + 500, 'h1');
    expect(bear().currentHp).toBe(0);
    expect(hasEffect(bear(), AuraType.Slumber)).toBe(false);
  });

  it('is not a status a cleanse can lift, and Defense Down still bites it', () => {
    start();
    lethal();
    useCombatStore.getState().removeAllAfflictions(bear().id);
    expect(hasEffect(bear(), AuraType.Slumber)).toBe(true);
    const before = getCombatEffectiveStats(bear()).defense;
    useCombatStore.getState().applyEffect(bear().id, {
      type: AfflictionType.DefenseDown, magnitude: 6, duration: 2, sourceUnitId: 'h1',
    });
    expect(getCombatEffectiveStats(bear()).defense).toBeLessThan(before);
  });

  it('is only the Bear: the same blow kills an ordinary elite outright', () => {
    const store = useCombatStore.getState();
    store.reset();
    const [grunt] = createEnemyUnits(['orc_grunt'], [at(0, -3)], 1, 1);
    store.initCombat([hero()], [grunt]);
    store.damageUnit(grunt.id, 99999, 'h1');
    expect(units().find((u) => u.id === grunt.id)!.currentHp).toBe(0);
  });
});

// ── The Revenant's Soul Fracture ─────────────────────────────────────────────

import { fragmentsOf, isSoulSplit, SOUL_FRAGMENT_KIND } from '@/systems/combat/eliteKits';
import { hexDistance } from '@/utils/hexUtils';

const revenant = (): CombatUnit => units().find((u) => u.templateId === 'revenant')!;
const fragments = () => fragmentsOf(revenant(), units());

function startRevenant(heroes: CombatUnit[] = [hero()]) {
  const store = useCombatStore.getState();
  store.reset();
  const [r] = createEnemyUnits(['revenant'], [at(0, -3)], 1, 1);
  store.initCombat(heroes, [r]);
}

const slay = () => useCombatStore.getState().damageUnit(revenant().id, revenant().currentHp + 500, 'h1');

/** One Revenant turn: its fragments cross their next hexes. */
const turn = () => beginTurn(revenant().id, SILENT_SINK);

describe('Soul Fracture', () => {
  it('breaks the first fatal blow into three fragments at separated graves, and the body lies inert', () => {
    startRevenant();
    slay();
    const r = revenant();
    expect(r.currentHp).toBe(1);
    expect(isSoulSplit(r)).toBe(true);
    expect(fragments()).toHaveLength(BALANCE.SOUL_FRAGMENTS);
    const spots = fragments().map((f) => f.position);
    for (const f of fragments()) {
      expect(f.objective?.kind).toBe(SOUL_FRAGMENT_KIND);
      expect(f.isPlayer).toBe(false);
      expect(hexDistance(f.position, r.position)).toBeGreaterThanOrEqual(3);
    }
    // Separated: no two share a hex, and none are neighbours
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) expect(hexDistance(spots[i], spots[j])).toBeGreaterThanOrEqual(2);
    }
    expect(useCombatStore.getState().turnOrder).toEqual(expect.not.arrayContaining(fragments().map((f) => f.id)));
  });

  it('cannot be struck, burned or aimed at while its fragments are loose', () => {
    startRevenant();
    slay();
    useCombatStore.getState().damageUnit(revenant().id, 999, 'h1');
    expect(revenant().currentHp).toBe(1);
    useCombatStore.getState().applyEffect(revenant().id, {
      type: AfflictionType.Poison, magnitude: 5, duration: 3, sourceUnitId: 'h1',
    });
    useCombatStore.getState().tickEffectsOnUnit(revenant().id);
    expect(revenant().currentHp).toBe(1);
  });

  it('is gone for good when every fragment is destroyed', () => {
    startRevenant();
    slay();
    for (const f of fragments()) useCombatStore.getState().damageUnit(f.id, 9999, 'h1');
    expect(revenant().currentHp).toBe(0);
    expect(isSoulSplit(revenant())).toBe(false);
  });

  it('reforms with health in proportion to the fragments that arrive, and a destroyed one costs it', () => {
    startRevenant();
    slay();
    const [first, second] = fragments();
    useCombatStore.getState().damageUnit(first.id, 9999, 'h1');
    // A fragment is still loose, so nothing is settled yet
    expect(isSoulSplit(revenant())).toBe(true);
    expect(revenant().currentHp).toBe(1);
    void second;
    // Let the rest travel home: each Revenant turn crosses its steps
    for (let i = 0; i < BALANCE.SOUL_FRAGMENT_MAX_TURNS && isSoulSplit(revenant()); i++) turn();
    const r = revenant();
    expect(isSoulSplit(r)).toBe(false);
    expect(r.currentHp).toBe(Math.round(r.stats.maxHp * BALANCE.SOUL_REFORM_PER_FRAGMENT * 2));
  });

  it('pays more for more arrivals: three home is worth more than one', () => {
    startRevenant();
    slay();
    for (let i = 0; i < BALANCE.SOUL_FRAGMENT_MAX_TURNS && isSoulSplit(revenant()); i++) turn();
    const all = revenant().currentHp;

    startRevenant();
    slay();
    const [a, b] = fragments();
    useCombatStore.getState().damageUnit(a.id, 9999, 'h1');
    useCombatStore.getState().damageUnit(b.id, 9999, 'h1');
    for (let i = 0; i < BALANCE.SOUL_FRAGMENT_MAX_TURNS && isSoulSplit(revenant()); i++) turn();
    expect(revenant().currentHp).toBeLessThan(all);
    expect(revenant().currentHp).toBeGreaterThan(1);
  });

  it('brings every loose fragment home by the turn limit, however it is blocked', () => {
    // A wall of heroes across every approach cannot hold a fragment for ever
    startRevenant([hero('h1'), hero('h2'), hero('h3'), hero('h4')]);
    slay();
    for (let i = 0; i < BALANCE.SOUL_FRAGMENT_MAX_TURNS; i++) turn();
    expect(isSoulSplit(revenant())).toBe(false);
    expect(fragments()).toHaveLength(0);
  });

  it('is only the first death: the second body dies normally', () => {
    startRevenant();
    slay();
    for (let i = 0; i < BALANCE.SOUL_FRAGMENT_MAX_TURNS && isSoulSplit(revenant()); i++) turn();
    expect(revenant().currentHp).toBeGreaterThan(1);
    slay();
    expect(revenant().currentHp).toBe(0);
    expect(fragments()).toHaveLength(0);
  });

  it('keeps the fight going while the soul is out: it is not a victory until the Revenant is truly gone', () => {
    startRevenant();
    slay();
    expect(revenant().currentHp).toBeGreaterThan(0);
  });
});
