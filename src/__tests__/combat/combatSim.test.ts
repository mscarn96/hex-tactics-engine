import { runFight, runBatch } from '@/systems/sim/combatSim';
import { slash, arrowShot } from '@/data/skills/skillData';
import { CombatUnit, HexCoord } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';

const at = (q: number, r: number): HexCoord => ({ q, r });

const unit = (id: string, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, isPlayer: false, stats: makeStats({ maxHp: 80, attack: 15, defense: 4, magic: 5, maxMana: 30 }), skills: [slash], ...over });

const hero = (over: Partial<CombatUnit> = {}) =>
  unit('hero', { isPlayer: true, heroId: 'h1', position: at(0, -2), ...over });
const foe = (over: Partial<CombatUnit> = {}) =>
  unit('foe', { isPlayer: false, position: at(0, 2), ...over });

describe('runFight', () => {
  it('drives a fight to a conclusion without a screen', () => {
    const result = runFight([hero()], [foe()]);

    expect(['victory', 'defeat']).toContain(result.outcome);
    expect(result.turns).toBeGreaterThan(0);
    expect(result.turnLog.length).toBeGreaterThan(0);
  });

  // The whole point of making the AI side-agnostic: the hero fights back
  it('lets the player side act rather than standing still', () => {
    const result = runFight([hero()], [foe()]);
    const heroTurns = result.turnLog.filter((t) => t.isPlayer && t.trace);
    expect(heroTurns.length).toBeGreaterThan(0);
  });

  it('records what the AI weighed, losers included', () => {
    const result = runFight(
      [hero({ skills: [slash, arrowShot] })],
      [foe({ skills: [slash, arrowShot] })]
    );
    const withTrace = result.turnLog.find((t) => t.trace && t.trace.considered.length > 1);

    expect(withTrace).toBeDefined();
    // Both candidates appear, not just the winner — a skill that never gets
    // picked is the thing the log exists to explain
    expect(withTrace!.trace!.considered.map((c) => c.skillId).sort()).toEqual(
      ['arrow_shot', 'slash']
    );
    expect(withTrace!.trace!.chose).toBeTruthy();
  });

  it('is a victory when the party is overwhelming', () => {
    const result = runFight(
      [hero({ stats: { ...hero().stats, attack: 100, maxHp: 500 }, currentHp: 500 })],
      [foe({ currentHp: 10, stats: { ...foe().stats, maxHp: 10, attack: 1 } })]
    );
    expect(result.outcome).toBe('victory');
  });

  it('is a defeat when the party is hopeless', () => {
    const result = runFight(
      [hero({ currentHp: 5, stats: { ...hero().stats, maxHp: 5, attack: 1 } })],
      [foe({ stats: { ...foe().stats, attack: 100, maxHp: 500 }, currentHp: 500 })]
    );
    expect(result.outcome).toBe('defeat');
  });

  // Two units that cannot reach or hurt each other must not hang the harness
  it('stops at the turn cap rather than looping forever', () => {
    const harmless = { ...hero().stats, attack: 0, magic: 0, moveRange: 0 };
    const result = runFight(
      [hero({ stats: harmless })],
      [foe({ stats: { ...harmless }, isPlayer: false })],
      { maxTurns: 40 }
    );

    expect(result.outcome).toBe('draw');
    expect(result.turns).toBe(40);
  });

  it('drops the transcript when asked to be quiet', () => {
    const result = runFight([hero()], [foe()], { quiet: true });
    expect(result.turnLog).toHaveLength(0);
    expect(['victory', 'defeat']).toContain(result.outcome);
  });
});

describe('runBatch', () => {
  it('reports a win rate over many runs', () => {
    const result = runBatch([hero()], [foe()], 20);

    expect(result.runs).toBe(20);
    expect(result.victories + result.defeats + result.draws).toBe(20);
    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeLessThanOrEqual(1);
    expect(result.averageTurns).toBeGreaterThan(0);
  });

  // Each run must start from full health, or run 2 inherits run 1's corpses
  it('does not let one run bleed into the next', () => {
    const strong = hero({ stats: { ...hero().stats, attack: 60 } });
    const weak = foe({ currentHp: 30, stats: { ...foe().stats, maxHp: 30, attack: 2 } });

    const result = runBatch([strong], [weak], 15);
    expect(result.winRate).toBe(1);
  });
});
