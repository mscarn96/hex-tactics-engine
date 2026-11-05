import { CombatUnit, PreparedAttack } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { AIAction, AITrace, decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { CombatSink } from '@/systems/combat/skillResolution';
import { beginTurn, TurnStart } from '@/systems/combat/turnStart';
import { fightOutcome } from '@/systems/combat/waveResolve';

/**
 * The headless fight runner: plays the fight the combat store holds, turn by turn, to its end.
 *
 * Every simulator fight goes through it — `runFight`, the boss measurers, the balance simulator's
 * castle chain and PvP — so the turn's order is written once: the outcome check, the turn-start tick
 * (`beginTurn`), the unit's decision, its actions (`executeAIActions`) and the hand-over (`nextTurn`).
 * What a caller measures it measures as a {@link TurnWatch}; what it changes about the play is the
 * {@link RunnerOptions.policy} that decides before the brain.
 *
 * The caller sets the fight up (`initCombat`, waves, a later phase) and reads the store afterwards.
 * The animated scene keeps its own loop; the tactical AI's rehearsal (`tacticalAI.playOn`) is a
 * lookahead from inside a turn, not a fight, and keeps its own too.
 */

/** Plays some turns in place of the brain: the actions to take, or null to leave the turn to the brain. */
export type TurnPolicy = (unit: CombatUnit, units: CombatUnit[]) => AIAction[] | null;

/** How a fight the runner played ended: `draw` is the turn cap or a deadlock. */
export type RunnerOutcome = 'victory' | 'defeat' | 'draw';

/**
 * What a caller sees of each turn, in the order the turn goes. Every hook is optional. `unit` is the
 * unit as its turn came up, before the turn-start tick; the store is there to read for the rest.
 */
export interface TurnWatch {
  /** The turn has come up: the store is as the turn before left it. `turn` counts from 1. */
  before?(unit: CombatUnit, turn: number): void;
  /**
   * The turn-start tick has run (`start`); nobody has decided yet. A watch may act on the store here
   * (a stand-in for an answer the party carries), before the unit decides.
   */
  started?(unit: CombatUnit, start: TurnStart, turn: number): void;
  /** Which units' brain decisions are traced (default: every unit's, when `decided` is given). */
  traces?(unit: CombatUnit): boolean;
  /** The brain's reasoning for the turn, when the brain decided it. */
  decided?(unit: CombatUnit, trace: AITrace): void;
  /**
   * What the unit will do, before it is done: its actions, and whether the policy chose them (`false`: the
   * brain did). `unit` here is the copy that acts.
   */
  chose?(unit: CombatUnit, actions: AIAction[], byPolicy: boolean): void;
  /** A warned attack has landed (`CombatSink.warningLanded`): `board` is the field the moment before it struck. */
  landed?(attack: PreparedAttack, board: readonly CombatUnit[]): void;
  /** The turn's actions have run; the hand-over has not. Not called for a deadlocked turn. */
  after?(unit: CombatUnit, start: TurnStart, turn: number): void;
}

export interface RunnerOptions {
  /** Hard stop, counted in unit turns: two units that cannot reach each other would loop forever. */
  maxTurns: number;
  /**
   * The one place a turn's decision is made: this policy first, for a turn it answers (non-null), and
   * the plain brain (`decideEnemyAction`) for every other. A caller with several policies composes
   * them with {@link firstOf}.
   */
  policy?: TurnPolicy;
  /**
   * Which copy of the unit decides and acts. `ticked` (the default) is the unit as the turn-start tick
   * left it: its mana regenerated, its afflictions ticked. `begun` is the copy read as the turn came up,
   * before the tick, which `runFight` has always decided with; it plays different fights (a healer that
   * would support strikes instead), so it is kept to keep that harness's numbers rather than adopted.
   */
  actor?: 'ticked' | 'begun';
  /** What of the roster the brain is shown for a unit (default: all of it). The policy sees all of it. */
  brainView?: (unit: CombatUnit, units: CombatUnit[]) => CombatUnit[];
  /** Every line the fight logs. */
  log?: (text: string, color: string) => void;
  /**
   * The fight as text, for a replay: a `#n Name (side)` header per unit turn, then each line it
   * logged, indented. `side` names a unit's side (default `party` or `enemy`).
   */
  transcript?: { lines: string[]; side?: (unit: CombatUnit) => string };
  /** What callers measure, each told of every turn in the order given. */
  watches?: readonly TurnWatch[];
}

export interface RunnerResult {
  outcome: RunnerOutcome;
  /** Unit turns begun, the deadlocked one included. */
  turns: number;
}

const partyOrEnemy = (u: CombatUnit) => (u.isPlayer ? 'party' : 'enemy');

/** The first of several policies to answer a turn. */
export function firstOf(...policies: (TurnPolicy | undefined)[]): TurnPolicy {
  return (unit, units) => {
    for (const policy of policies) {
      const actions = policy?.(unit, units);
      if (actions) return actions;
    }
    return null;
  };
}

export function runHeadless(options: RunnerOptions): RunnerResult {
  const { transcript } = options;
  const watches = options.watches ?? [];
  const sink: CombatSink = {
    log: (text, color) => {
      options.log?.(text, color);
      transcript?.lines.push(`  ${text}`);
    },
    float: () => {},
    vfx: () => {},
    status: () => {},
    warningLanded: (attack, board) => {
      for (const w of watches) w.landed?.(attack, board);
    },
  };
  const side = transcript?.side ?? partyOrEnemy;

  let turns = 0;
  while (turns < options.maxTurns) {
    const verdict = fightOutcome();
    if (verdict !== 'ongoing') return { outcome: verdict, turns };
    const current = useCombatStore.getState().getCurrentUnit();
    if (!current) break;
    turns++;
    transcript?.lines.push(`#${turns} ${current.name} (${side(current)})`);
    for (const w of watches) w.before?.(current, turns);

    const started = beginTurn(current.id, sink);
    for (const w of watches) w.started?.(current, started, turns);

    if (started.kind === 'act') {
      const units = useCombatStore.getState().units;
      const actor = options.actor === 'begun' ? current : units.find((u) => u.id === current.id) ?? current;
      const chosen = options.policy?.(actor, units) ?? null;
      // A trace costs an allocation per candidate skill, so it is built only for a unit someone reads
      const readers = chosen ? [] : watches.filter((w) => w.decided && (w.traces?.(actor) ?? true));
      const actions = chosen ?? decideEnemyAction(
        actor,
        options.brainView ? options.brainView(actor, units) : units,
        readers.length > 0 ? (t) => { for (const w of readers) w.decided!(actor, t); } : undefined,
      );
      for (const w of watches) w.chose?.(actor, actions, chosen !== null);
      executeAIActions(actor, actions, sink);
    } else if (started.kind === 'inert' && started.deadlocked) {
      // Nothing left standing can ever act, so the fight cannot progress: a draw, told apart from a defeat
      return { outcome: 'draw', turns };
    }
    for (const w of watches) w.after?.(current, started, turns);
    useCombatStore.getState().nextTurn();
  }
  return { outcome: 'draw', turns };
}
