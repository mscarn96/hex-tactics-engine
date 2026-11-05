import { ArenaHazard, CombatUnit, EncounterWave } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { wavesForPlan, waveAnnounce } from '@/data/templates/encounterWaves';
import { siteEnemies } from '@/quests/sites';
import { useCombatStore } from '@/stores/combatStore';
import { arenaHexes } from '@/systems/combat/arenaGeometry';
import { combatOutcome } from '@/systems/combat/combatOutcome';
import { CombatSink, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { fightOutcome, resolveWaves } from '@/systems/combat/waveResolve';
import {
  createWaveStates,
  livingEnemies,
  pendingWaveCount,
  planArrival,
  waveDue,
  waveSpawnHexes,
  waveViolations,
  waveAnnouncement,
  waveProgress,
} from '@/systems/combat/waves';
import { runFight } from '@/systems/sim/combatSim';
import { hexKey } from '@/utils/hexUtils';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * Announced waves: reinforcements that arrive without the fight ending.
 *
 * What is pinned is the rule — the fight is not won between waves, nothing
 * arrives on a body or on solid ground, the board never overfills, and no wave
 * can come twice — and not the numbers the tests happen to use.
 */

const hero = (id: string, position = at(0, 3)) =>
  makeUnit({ id, heroId: id, position, stats: makeStats({ maxHp: 500, attack: 60, speed: 10 }) });
const foe = (id: string, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, templateId: 'giant_spider' as CombatUnit['templateId'], position: at(0, -3), ...over });

const wave = (over: Partial<EncounterWave> = {}): EncounterWave => ({
  // A real wave's id: its announcement is in the catalog
  id: 'spider_brood',
  trigger: { kind: 'enemiesFallen' },
  templateIds: ['giant_spider', 'giant_spider', 'giant_spider'],
  ...over,
});

const state = () => useCombatStore.getState();

function start(players: CombatUnit[], enemies: CombatUnit[], waves: EncounterWave[]) {
  state().reset();
  state().initCombat(players, enemies);
  state().setWaves(waves, { partyLevel: 1, powerScale: 1 });
}

const kill = (id: string) => state().damageUnit(id, 99999);
const logs: string[] = [];
const sink: CombatSink = {
  ...SILENT_SINK,
  log: (text) => { logs.push(text); },
  announce: (text) => { logs.push(`ANNOUNCE ${text}`); },
};
beforeEach(() => { logs.length = 0; });

describe('when a wave comes', () => {
  it('waits for its trigger, and an empty-side trigger is not met while anyone stands', () => {
    start([hero('a')], [foe('f1'), foe('f2')], [wave()]);
    expect(waveDue(state().waves, state().units)).toBeUndefined();
    kill('f1');
    expect(waveDue(state().waves, state().units)).toBeUndefined();
    kill('f2');
    expect(waveDue(state().waves, state().units)?.wave.id).toBe('spider_brood');
  });

  it('can be set off by one named unit falling while others fight on', () => {
    const revenge = wave({ trigger: { kind: 'unitFallen', templateId: 'brigand_captain' }, templateIds: ['footpad'] });
    start(
      [hero('a')],
      [foe('captain', { templateId: 'brigand_captain' as CombatUnit['templateId'] }), foe('thug', { position: at(1, -3) })],
      [revenge],
    );
    expect(waveDue(state().waves, state().units)).toBeUndefined();
    kill('captain');
    expect(livingEnemies(state().units)).toHaveLength(1);
    expect(waveDue(state().waves, state().units)?.wave.id).toBe('spider_brood');
  });

  it('goes strictly in order: a later wave cannot trigger off an earlier one still to come', () => {
    start([hero('a')], [foe('f1')], [wave({ id: 'first' }), wave({ id: 'second' })]);
    kill('f1');
    expect(waveDue(state().waves, state().units)?.wave.id).toBe('first');
    resolveWaves(sink);
    // The first has arrived; the second waits for *those* bodies to fall
    expect(state().waves.map((w) => w.status)).toEqual(['done', 'waiting']);
    expect(waveDue(state().waves, state().units)).toBeUndefined();
    for (const e of livingEnemies(state().units)) kill(e.id);
    expect(waveDue(state().waves, state().units)?.wave.id).toBe('second');
  });
});

describe('the fight does not end between waves', () => {
  it('is not won while a wave is still to arrive', () => {
    start([hero('a')], [foe('f1')], [wave()]);
    kill('f1');
    // The bare verdict would call this a victory…
    expect(combatOutcome(state().units)).toBe('victory');
    // …and the one every driver asks does not
    expect(fightOutcome()).toBe('ongoing');
  });

  it('is won once the last wave has been beaten, and only then', () => {
    start([hero('a')], [foe('f1')], [wave()]);
    kill('f1');
    expect(resolveWaves(sink)).toHaveLength(3);
    expect(fightOutcome()).toBe('ongoing');
    for (const e of livingEnemies(state().units)) kill(e.id);
    expect(pendingWaveCount(state().waves)).toBe(0);
    expect(fightOutcome()).toBe('victory');
  });

  it('is still lost if the party falls with a wave pending', () => {
    start([hero('a')], [foe('f1')], [wave()]);
    kill('a');
    expect(fightOutcome()).toBe('defeat');
  });

  it('brings the wave in from beginTurn, between two turns', () => {
    start([hero('a')], [foe('f1')], [wave()]);
    kill('f1');
    beginTurn('a', sink);
    expect(livingEnemies(state().units)).toHaveLength(3);
    expect(state().waves[0].status).toBe('done');
  });

  it('plays through a whole headless fight: victory only after the wave', () => {
    const striker = makeSkill({ id: 'test_hit' as never, damage: 3, range: 1 });
    const result = runFight(
      [hero('a', at(0, -2))].map((u) => ({ ...u, skills: [striker] })),
      [foe('f1', { position: at(0, -3), stats: makeStats({ maxHp: 30, attack: 1, speed: 1 }) })],
      { waves: { waves: [wave({ templateIds: ['giant_spider'] })] }, maxTurns: 200 },
    );
    expect(result.outcome).toBe('victory');
    // The wave's spider was fought and beaten too
    expect(result.survivors.filter((s) => !s.isPlayer)).toHaveLength(0);
  });
});

describe('where they arrive', () => {
  it('never on a living body, objectives included', () => {
    const heroes = [hero('a', at(0, -5)), hero('b', at(-1, -4))];
    const crystal = foe('crystal', { position: at(1, -4), objective: { kind: 'crystal', ownerId: 'f1' } as CombatUnit['objective'] });
    const f1 = foe('f1', { position: at(0, -4) });
    const hexes = waveSpawnHexes(6, [...heroes, f1, crystal]);
    const taken = new Set([...heroes, f1, crystal].map((u) => hexKey(u.position)));
    expect(hexes).toHaveLength(6);
    for (const h of hexes) expect(taken.has(hexKey(h))).toBe(false);
    expect(new Set(hexes.map(hexKey)).size).toBe(6);
  });

  it('never on solid ground, and always inside the arena', () => {
    const board = arenaHexes();
    const rubble: ArenaHazard = {
      id: 'rubble', label: 'Rubble', solid: true, hexes: board.filter((h) => h.r <= -3),
    };
    const hexes = waveSpawnHexes(8, [hero('a')], [rubble]);
    const blocked = new Set(rubble.hexes.map(hexKey));
    for (const h of hexes) {
      expect(blocked.has(hexKey(h))).toBe(false);
      expect(board.some((b) => b.q === h.q && b.r === h.r)).toBe(true);
    }
  });

  it('keeps clear of the party when the board allows, from the back of the enemy side', () => {
    const hexes = waveSpawnHexes(3, [hero('a', at(0, 0))]);
    for (const h of hexes) {
      expect(Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r))).toBeGreaterThan(1);
      expect(h.r).toBeLessThan(0);
    }
  });

  it('puts the arrivals on the board through the real path, none on a hero', () => {
    start([hero('a', at(0, -5))], [foe('f1')], [wave()]);
    kill('f1');
    resolveWaves(sink);
    const living = state().units.filter((u) => u.currentHp > 0);
    expect(new Set(living.map((u) => hexKey(u.position))).size).toBe(living.length);
  });
});

describe('how many', () => {
  it('never takes the board above the wave\'s active limit, and finishes in instalments', () => {
    const big = wave({ templateIds: ['giant_spider', 'giant_spider', 'giant_spider', 'giant_spider'], maxActive: 3 });
    start([hero('a')], [foe('f1'), foe('f2', { position: at(1, -3) })], [big]);
    kill('f1');
    // One enemy standing: the wave is not due until the board is cleared
    expect(waveDue(state().waves, state().units)).toBeUndefined();
    kill('f2');

    resolveWaves(sink);
    expect(livingEnemies(state().units)).toHaveLength(3);
    expect(state().waves[0]).toMatchObject({ status: 'arriving' });
    expect(state().waves[0].pending).toHaveLength(1);

    // Full board: asking again changes nothing
    resolveWaves(sink);
    expect(livingEnemies(state().units)).toHaveLength(3);

    kill(livingEnemies(state().units)[0].id);
    resolveWaves(sink);
    expect(livingEnemies(state().units)).toHaveLength(3);
    expect(state().waves[0]).toMatchObject({ status: 'done', pending: [] });
  });

  it('plans nothing for a full board and does not lose the pending bodies', () => {
    const states = createWaveStates([wave({ maxActive: 1 })]);
    const arrival = planArrival(states[0], [hero('a'), foe('f1')]);
    expect(arrival.templateIds).toEqual([]);
    expect(arrival.remaining).toHaveLength(3);
  });

  it('is bounded: an encounter may carry only so many waves of only so many bodies', () => {
    const many = Array.from({ length: BALANCE.WAVE_MAX_PER_ENCOUNTER + 1 }, (_, i) => wave({ id: `w${i}` }));
    expect(waveViolations(many)).not.toEqual([]);
    expect(waveViolations([wave({ templateIds: Array(BALANCE.WAVE_MAX_SIZE + 1).fill('giant_spider') })])).not.toEqual([]);
    expect(waveViolations([wave({ templateIds: [] })])).not.toEqual([]);
    // No announcement in the catalog for this id
    expect(waveViolations([wave({ id: 'unannounced' })])).not.toEqual([]);
    expect(waveViolations([wave({ templateIds: ['nobody'] })], new Set(['giant_spider']))).not.toEqual([]);
    expect(waveViolations([wave()])).toEqual([]);
  });
});

describe('announcing and repeating', () => {

  it('never repeats: a finished wave does not come again when the board clears again', () => {
    start([hero('a')], [foe('f1')], [wave({ templateIds: ['giant_spider'] })]);
    kill('f1');
    resolveWaves(sink);
    kill(livingEnemies(state().units)[0].id);
    expect(resolveWaves(sink)).toEqual([]);
    expect(livingEnemies(state().units)).toHaveLength(0);
    expect(fightOutcome()).toBe('victory');
  });

  it('does not soft-lock when there is nowhere at all to put anyone', () => {
    start([hero('a')], [foe('f1')], [wave()]);
    kill('f1');
    const wall: ArenaHazard = { id: 'wall', label: 'Wall', solid: true, hexes: [...arenaHexes()] };
    state().addHazard(wall);
    resolveWaves(sink);
    // Dropped rather than waited on forever
    expect(state().waves[0].status).toBe('done');
    expect(fightOutcome()).toBe('victory');
  });
});

describe('the authored waves', () => {
  const known = new Set(enemyTemplates.map((t) => t.id as string));

  it('gives brigands a revenge wave once the captain is on the field', () => {
    const waves = wavesForPlan('random_danger', {
      factionId: 'brigands',
      enemies: ['brigand_captain', 'bandit'],
    });
    expect(waves.map((w) => w.id)).toEqual(['brigand_revenge']);
    expect(waves[0].trigger).toEqual({ kind: 'unitFallen', templateId: 'brigand_captain' });
    expect(waveViolations(waves, known)).toEqual([]);
    expect(wavesForPlan('random_danger', { factionId: 'brigands', enemies: ['bandit', 'footpad'] })).toEqual([]);
  });

  it('sends a second brood after a spider nest, no larger than the first', () => {
    const waves = wavesForPlan('random_danger', {
      factionId: 'beasts',
      enemies: ['giant_spider', 'giant_spider', 'wolf'],
    });
    expect(waves.map((w) => w.id)).toEqual(['spider_brood']);
    expect(waves[0].templateIds).toHaveLength(2);
    expect(waveViolations(waves, known)).toEqual([]);
    expect(wavesForPlan('random_danger', { factionId: 'beasts', enemies: ['giant_spider', 'wolf'] })).toEqual([]);
  });

  it('puts two waves on the Greywater crossing, each only once the last is down', () => {
    const waves = wavesForPlan('quest_greywater', { factionId: null, enemies: [...siteEnemies('quest_greywater')!] });
    expect(waves.map((w) => w.id)).toEqual(['greywater_first_wave', 'greywater_second_wave']);
    // PT-09: the ford ends on its keeper, exactly these three
    expect(waves[waves.length - 1].templateIds).toEqual(['bog_hulk', 'silt_speaker', 'reed_stalker']);
    expect(siteEnemies('quest_greywater')).toContain('reed_stalker');
    expect(waves.every((w) => w.trigger.kind === 'enemiesFallen')).toBe(true);
    expect(waveViolations(waves, known)).toEqual([]);
  });

  it('grows the Snare Thicket nest 2 -> 3 -> 4 spiders, the one wave list allowed to outgrow its fight', () => {
    const opening = siteEnemies('quest_thicket')!;
    expect(opening).toEqual(['giant_spider', 'giant_spider']);
    const waves = wavesForPlan('quest_thicket', { factionId: null, enemies: opening });
    expect(waves.map((w) => w.id)).toEqual(['thicket_brood', 'thicket_nest']);
    expect(waves.map((w) => w.templateIds)).toEqual([
      Array(3).fill('giant_spider'),
      Array(4).fill('giant_spider'),
    ]);
    expect(waves.every((w) => w.trigger.kind === 'enemiesFallen')).toBe(true);
    expect(waveViolations(waves, known)).toEqual([]);
    // Each wave fits on the board at once, so no brood arrives in instalments
    expect(Math.max(...waves.map((w) => w.templateIds.length))).toBeLessThanOrEqual(BALANCE.WAVE_MAX_ACTIVE);
  });

  it('leaves other quest sites without waves', () => {
    expect(wavesForPlan('quest_frozen_camp', { factionId: 'rime_jarls', enemies: ['hold_thrall'] })).toEqual([]);
  });

  it('leaves curated fights as they are', () => {
    const plan = { factionId: 'brigands', enemies: ['brigand_captain'] };
    for (const id of ['lair_warren_1', 'castle_1_2', 'siege_week_3']) {
      expect(wavesForPlan(id, plan)).toEqual([]);
    }
  });
});

describe('wave readouts', () => {
  const wave = (id: string): EncounterWave => ({
    id, trigger: { kind: 'enemiesFallen' }, templateIds: ['wolf'],
  });

  it('counts the opening enemies as wave 1 and a wave as current once it starts arriving', () => {
    const states = createWaveStates([wave('a'), wave('b')]);
    expect(waveProgress([])).toBeNull();
    expect(waveProgress(states)).toEqual({ current: 1, total: 3, toCome: 2 });
    expect(waveProgress([{ ...states[0], status: 'arriving' }, states[1]]))
      .toEqual({ current: 2, total: 3, toCome: 1 });
    expect(waveProgress(states.map((s) => ({ ...s, status: 'done' as const }))))
      .toEqual({ current: 3, total: 3, toCome: 0 });
  });
});
