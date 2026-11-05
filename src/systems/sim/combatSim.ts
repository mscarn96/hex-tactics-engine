import { CombatUnit, EncounterWave } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { AITrace } from '@/systems/combat/enemyAI';
import { TurnStart } from '@/systems/combat/turnStart';
import { RunnerOutcome, runHeadless, TurnPolicy, TurnWatch } from '@/systems/sim/fightRunner';

/**
 * A whole fight, resolved without a screen.
 *
 * The point is tuning: run the same matchup a thousand times and the win rate
 * is a number rather than a feeling. Everything it drives is the code the game
 * drives — `beginTurn`, `decideEnemyAction`, `executeAIActions`, the real
 * damage pipeline — so a number measured here means something in the app.
 *
 * **Both sides are played by the AI.** `decideEnemyAction` became side-agnostic
 * for exactly this, so the hero side is not a punching bag. It is not a model of
 * a good human player and is not meant to be: it is a fixed opponent, which is
 * what makes two runs comparable.
 */

export interface SimTurn {
  index: number;
  unitId: string;
  unitName: string;
  isPlayer: boolean;
  /** What the turn-start tick decided before the unit could act. */
  start: TurnStart['kind'];
  /** Only present when the unit actually got to act. */
  trace?: AITrace;
  logs: { text: string; color: string }[];
}

export interface Survivor {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
}

export interface FightResult {
  /** `draw` means the turn cap was hit or nothing left could act — usually a sign nobody can finish. */
  outcome: RunnerOutcome;
  turns: number;
  turnLog: SimTurn[];
  survivors: Survivor[];
}

export interface SimOptions {
  /** Announced reinforcements for the fight, with the scaling their bodies are built at. */
  waves?: { waves: EncounterWave[]; partyLevel?: number; powerScale?: number };
  /**
   * Hard stop, counted in individual unit turns rather than rounds.
   *
   * A cap is not optional: two units that cannot reach each other, or a pair of
   * healers out-sustaining their own damage, will otherwise loop forever.
   */
  maxTurns?: number;
  /** Skip the per-turn transcript. Worth it when running thousands of fights. */
  quiet?: boolean;
  /**
   * Overrides the AI for some turns: return the actions to take, or `null` to
   * leave the turn to `decideEnemyAction`. How a measurement gives a side a
   * policy the plain brain does not have — a party that steps out of a warning —
   * without the harness growing a second combat implementation.
   */
  policy?: TurnPolicy;
  /** What a caller measures turn by turn (`fightRunner`), beside the transcript this keeps. */
  watch?: TurnWatch;
}

const DEFAULT_MAX_TURNS = 400;

export function runFight(
  players: CombatUnit[],
  enemies: CombatUnit[],
  options: SimOptions = {}
): FightResult {
  const store = useCombatStore.getState();
  store.reset();
  store.initCombat(players, enemies);
  if (options.waves) {
    store.setWaves(options.waves.waves, {
      partyLevel: options.waves.partyLevel ?? 1,
      powerScale: options.waves.powerScale ?? 1,
    });
  }

  // The transcript, a turn at a time: the lines the turn logged and, when the brain decided it, why
  const turnLog: SimTurn[] = [];
  let logs: SimTurn['logs'] = [];
  let trace: AITrace | undefined;
  const keep = (unit: CombatUnit, start: TurnStart, turn: number) => {
    turnLog.push({ index: turn - 1, unitId: unit.id, unitName: unit.name, isPlayer: unit.isPlayer, start: start.kind, trace, logs });
  };
  const transcribe: TurnWatch = {
    before: () => { logs = []; trace = undefined; },
    // The deadlocked turn is kept too: it is the reason the fight ended
    started: (unit, start, turn) => { if (start.kind === 'inert' && start.deadlocked) keep(unit, start, turn); },
    decided: (_unit, t) => { trace = t; },
    after: keep,
  };
  const { outcome, turns } = runHeadless({
    maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
    // The unit as its turn came up, before the tick: what this harness has always decided with
    actor: 'begun',
    policy: options.policy,
    log: options.quiet ? undefined : (text, color) => { logs.push({ text, color }); },
    watches: [...(options.quiet ? [] : [transcribe]), ...(options.watch ? [options.watch] : [])],
  });

  const finalUnits = useCombatStore.getState().units;
  return {
    outcome,
    turns,
    turnLog,
    survivors: finalUnits
      .filter((u) => u.currentHp > 0)
      .map((u) => ({
        id: u.id,
        name: u.name,
        isPlayer: u.isPlayer,
        hp: u.currentHp,
        maxHp: u.stats.maxHp,
      })),
  };
}

export interface BatchResult {
  runs: number;
  victories: number;
  defeats: number;
  draws: number;
  /** Fraction of runs the player side won, 0–1. */
  winRate: number;
  averageTurns: number;
  /** Mean fraction of party HP still standing on a win — how close it was. */
  averagePlayerHpOnWin: number;
}

/**
 * The same matchup many times over.
 *
 * Crits and dodges are rolls, so one fight says very little. This is the
 * function a balance question should actually be asked through.
 */
export function runBatch(
  players: CombatUnit[],
  enemies: CombatUnit[],
  runs: number,
  options: SimOptions = {}
): BatchResult {
  let victories = 0;
  let defeats = 0;
  let draws = 0;
  let totalTurns = 0;
  let hpOnWin = 0;

  for (let i = 0; i < runs; i++) {
    // Fresh copies each run: `initCombat` takes ownership, and a second run
    // handed the corpses of the first would measure nothing.
    const result = runFight(clone(players), clone(enemies), { ...options, quiet: true });
    totalTurns += result.turns;

    if (result.outcome === 'victory') {
      victories++;
      const alive = result.survivors.filter((s) => s.isPlayer);
      const total = players.reduce((sum, u) => sum + u.stats.maxHp, 0);
      hpOnWin += total > 0 ? alive.reduce((sum, s) => sum + s.hp, 0) / total : 0;
    } else if (result.outcome === 'defeat') defeats++;
    else draws++;
  }

  return {
    runs,
    victories,
    defeats,
    draws,
    winRate: runs > 0 ? victories / runs : 0,
    averageTurns: runs > 0 ? totalTurns / runs : 0,
    averagePlayerHpOnWin: victories > 0 ? hpOnWin / victories : 0,
  };
}

const clone = (units: CombatUnit[]): CombatUnit[] =>
  units.map((u) => ({
    ...u,
    position: { ...u.position },
    activeEffects: u.activeEffects.map((e) => ({ ...e })),
    skills: [...u.skills],
  }));
