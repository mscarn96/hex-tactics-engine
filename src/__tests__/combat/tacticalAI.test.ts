import { AIAction } from '@/systems/combat/aiTypes';
import { CombatUnit, Hero, HeroClass, MasteryId } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { SILENT_SINK } from '@/systems/combat/combatSink';
import { beginTurn } from '@/systems/combat/turnStart';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { createPlayerUnits, createRivalUnits, generateEnemyPositions, generatePlayerPositions } from '@/systems/combat/unitFactory';
import { inSandbox, isSandboxed } from '@/systems/combat/sandbox';
import { decideTactically, TACTICAL_LEVELS, TacticalLevel } from '@/systems/combat/tacticalAI';
import { healsOthers, roleOf } from '@/systems/combat/roles';
import { combatMaxHp } from '@/systems/combat/forms';
import { runFight } from '@/systems/sim/combatSim';
import { buildSimHero } from '@/systems/sim/simHarness';
import { rollPvpTeams } from '@/systems/sim/pvp';
import { makeRng, withSeededRandom } from '@/systems/sim/balance/rng';
import { masteriesForClass } from '@/data/skills/masteryData';
import { hexDistance } from '@/utils/hexUtils';

const pick = (heroClass: HeroClass) => ({ heroClass, masteryPath: masteriesForClass(heroClass)[0].id as MasteryId });
const PICKS = [pick(HeroClass.Warrior), pick(HeroClass.Mage), pick(HeroClass.Ranger)];

/** Two rolled PvP teams as units on the board: the picks as the party, the rival as the enemy. */
function pvpBoard(seed: number) {
  const teams = rollPvpTeams('dragon', PICKS, seed);
  useInventoryStore.getState().reset();
  const mint = useInventoryStore.getState().addItem;
  const build = (side: string) => (cfg: Parameters<typeof buildSimHero>[0], i: number) => buildSimHero(cfg, mint, `${side}_${i}`);
  const party = teams.player.heroes.map(build('p')).filter((h): h is Hero => !!h);
  const rival = teams.ai.heroes.map(build('r')).filter((h): h is Hero => !!h);
  return {
    players: createPlayerUnits(party, generatePlayerPositions(party.length)),
    enemies: createRivalUnits(rival, generateEnemyPositions(rival.length)),
  };
}

function startBoard(seed: number) {
  const { players, enemies } = pvpBoard(seed);
  const store = useCombatStore.getState();
  store.reset();
  store.initCombat(players, enemies);
}

/** Freezes the store's data, so a write that edits an object in place instead of replacing it throws. */
function deepFreeze(value: unknown, seen = new Set<unknown>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key], seen);
  Object.freeze(value);
}

/** Hands the turn to the first rival, as the scene would, and returns it. */
function firstRivalTurn(): CombatUnit {
  while (useCombatStore.getState().getCurrentUnit()?.isPlayer !== false) useCombatStore.getState().nextTurn();
  const unit = useCombatStore.getState().getCurrentUnit()!;
  beginTurn(unit.id, SILENT_SINK);
  return useCombatStore.getState().getCurrentUnit()!;
}

describe('the sandbox', () => {
  it('plays turns on a frozen fight without touching it, and puts the same state back', () => {
    withSeededRandom(makeRng(7), () => {
      setTempoRandom(() => Math.random());
      startBoard(7);
      const before = useCombatStore.getState();
      const { units, turnOrder, preparedAttacks, hazards, reactions, fightStats } = before;
      deepFreeze({ units, turnOrder, preparedAttacks, hazards, reactions, fightStats });
      // A rehearsal of a dozen turns of the ordinary brain on both sides: a write in place would throw here
      inSandbox(() => {
        expect(isSandboxed()).toBe(true);
        for (let i = 0; i < 12; i++) {
          const current = useCombatStore.getState().getCurrentUnit()!;
          if (beginTurn(current.id, SILENT_SINK).kind === 'act') {
            executeAIActions(current, decideEnemyAction(current, useCombatStore.getState().units), SILENT_SINK);
          }
          useCombatStore.getState().nextTurn();
        }
        expect(useCombatStore.getState().units).not.toBe(units);
      });
      expect(isSandboxed()).toBe(false);
      expect(useCombatStore.getState()).toBe(before);
    });
  });
});

describe('the tactical AI', () => {
  it.each(TACTICAL_LEVELS)('takes a turn a player could take, at %s, without changing the fight', (level) => {
    withSeededRandom(makeRng(11), () => {
      setTempoRandom(() => Math.random());
      startBoard(11);
      const unit = firstRivalTurn();
      const before = useCombatStore.getState();
      const traces: string[] = [];
      const decision = decideTactically(unit, level, { onTrace: (t) => traces.push(t.chose) });
      expect(useCombatStore.getState()).toBe(before);
      expect(decision.candidates).toBeGreaterThan(1);
      expect(traces).toHaveLength(1);
      // A walk is always the last step, and never follows a cast that did not grant a reposition
      const walkAt = decision.actions.findIndex((a) => a.type === 'move');
      expect(walkAt === -1 || walkAt === decision.actions.length - 1).toBe(true);
    });
  });

  it('casts only from where the hero stands', () => {
    withSeededRandom(makeRng(5), () => {
      setTempoRandom(() => Math.random());
      // Sixty turns of a fight: no rival turn may walk and then cast
      const seen: AIAction[][] = [];
      const { players, enemies } = pvpBoard(5);
      runFight(players, enemies, {
        quiet: true, maxTurns: 60,
        policy: (unit) => {
          if (unit.isPlayer) return null;
          const turn = decideTactically(unit, 'easy').actions;
          seen.push(turn);
          return turn;
        },
      });
      expect(seen.length).toBeGreaterThan(0);
      for (const turn of seen) {
        const walk = turn.findIndex((a) => a.type === 'move');
        const cast = turn.findIndex((a) => a.type === 'skill');
        expect(walk === -1 || cast === -1 || walk > cast).toBe(true);
      }
    });
  });
});

// ─── Measurement (phase 0) ───────────────────────────────────────────────────

interface Behaviour {
  /** Rival turns taken while it had a tank, and how many of those had a tank nearest the enemy. */
  tankTurns: number;
  tankFront: number;
  /** Health the rival's non-tanks lost while none of its tanks was engaged, as a share of their health. */
  exposedLoss: number;
  /** Ranged heroes' damaging casts, and how many were made from three hexes or more. */
  rangedCasts: number;
  rangedFar: number;
  /** Heals cast, and how many landed on an ally below 60% health. */
  heals: number;
  healsNeeded: number;
}

const blank = (): Behaviour => ({ tankTurns: 0, tankFront: 0, exposedLoss: 0, rangedCasts: 0, rangedFar: 0, heals: 0, healsNeeded: 0 });

/** Watches the rival side turn by turn: called with the board at each acting unit's turn. */
function watcher(b: Behaviour) {
  let last: { hp: number; max: number; engaged: boolean } | null = null;
  return {
    board(units: CombatUnit[]) {
      const rival = units.filter((u) => !u.isPlayer && u.currentHp > 0 && u.heroId);
      const foes = units.filter((u) => u.isPlayer && u.currentHp > 0);
      const nonTanks = units.filter((u) => !u.isPlayer && u.heroId && roleOf(u) !== 'tank');
      const hp = nonTanks.reduce((s, u) => s + Math.max(0, u.currentHp), 0);
      const max = nonTanks.reduce((s, u) => s + combatMaxHp(u), 0);
      if (last && !last.engaged && last.max > 0) b.exposedLoss += Math.max(0, last.hp - hp) / last.max;
      const engaged = rival.some((u) => roleOf(u) === 'tank' && foes.some((f) => hexDistance(f.position, u.position) <= 1));
      last = { hp, max, engaged };
    },
    turn(unit: CombatUnit, units: CombatUnit[], actions: AIAction[]) {
      if (unit.isPlayer || !unit.heroId) return;
      const rival = units.filter((u) => !u.isPlayer && u.currentHp > 0 && u.heroId);
      const foes = units.filter((u) => u.isPlayer && u.currentHp > 0);
      const nearest = (u: CombatUnit) => Math.min(99, ...foes.map((f) => hexDistance(f.position, u.position)));
      if (rival.some((u) => roleOf(u) === 'tank')) {
        b.tankTurns++;
        const front = Math.min(...rival.map(nearest));
        if (rival.some((u) => roleOf(u) === 'tank' && nearest(u) === front)) b.tankFront++;
      }
      const cast = actions.find((a) => a.type === 'skill' && a.skill && a.skillTarget);
      if (!cast?.skill || !cast.skillTarget) return;
      if (roleOf(unit) === 'ranged' && cast.skill.damage) {
        b.rangedCasts++;
        if (hexDistance(unit.position, cast.skillTarget) >= 3) b.rangedFar++;
      }
      if (healsOthers(cast.skill) && cast.skill.healing) {
        b.heals++;
        const target = units.find((u) => u.position.q === cast.skillTarget!.q && u.position.r === cast.skillTarget!.r);
        if (target && target.currentHp / combatMaxHp(target) < 0.6) b.healsNeeded++;
      }
    },
  };
}

/**
 * The tactical AI against the ordinary brain, for the PvP proof of concept: the same two teams on the
 * same sides, the party always on the ordinary brain and the rival on each brain in turn. Prints win
 * counts, time per decision and the behaviour numbers. Run with TACTICAL_MEASURE=1 (TACTICAL_RUNS,
 * TACTICAL_LEVELS).
 */
const measuring = process.env.TACTICAL_MEASURE ? describe : describe.skip;

measuring('the tactical AI against the ordinary brain', () => {
  it('measures', () => {
    const runs = Number(process.env.TACTICAL_RUNS ?? 12);
    const levels = (process.env.TACTICAL_LEVELS?.split(',') ?? TACTICAL_LEVELS) as TacticalLevel[];
    const pct = (a: number, n: number) => (n ? `${Math.round((100 * a) / n)}%` : '–');
    const lines: string[] = [];
    for (const rival of ['brain', ...levels] as const) {
      let wins = 0, losses = 0, draws = 0, turns = 0;
      const times: number[] = [];
      const b = blank();
      for (let seed = 1; seed <= runs; seed++) {
        withSeededRandom(makeRng(seed * 101), () => {
          setTempoRandom(() => Math.random());
          const { players, enemies } = pvpBoard(seed);
          const watch = watcher(b);
          const result = runFight(players, enemies, {
            quiet: true,
            maxTurns: 300,
            policy: (unit, units) => {
              watch.board(units);
              let actions: AIAction[];
              if (unit.isPlayer || rival === 'brain') actions = decideEnemyAction(unit, units);
              else {
                const d = decideTactically(unit, rival);
                times.push(d.ms);
                actions = d.actions;
              }
              watch.turn(unit, units, actions);
              return actions;
            },
          });
          turns += result.turns;
          // The rival is the enemy side: the party's defeat is its win
          if (result.outcome === 'defeat') wins++;
          else if (result.outcome === 'victory') losses++;
          else draws++;
        });
      }
      times.sort((x, y) => x - y);
      const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0;
      lines.push(`${rival.padEnd(6)} won ${wins}/${runs} (lost ${losses}, drew ${draws}), ${Math.round(turns / runs)} turns`
        + (times.length ? `, ms median ${at(0.5)} p90 ${at(0.9)} max ${at(1)}` : '')
        + ` | tank in front ${pct(b.tankFront, b.tankTurns)}, non-tank loss before tank engaged ${(b.exposedLoss / runs).toFixed(2)}/fight`
        + `, ranged casts from 3+ ${pct(b.rangedFar, b.rangedCasts)} (${b.rangedCasts}), heals on <60% ${pct(b.healsNeeded, b.heals)} (${b.heals})`);
    }
    console.log(lines.join('\n'));
  });
});
