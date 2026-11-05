import type { CombatUnit, HeroSkill, HexCoord, PreparedAttack } from '@/models/types';
import type { AIAction, AIConsideration, AITrace, SkillResult } from '@/systems/combat/aiTypes';
import type { CombatSink } from '@/systems/combat/combatSink';
import type { PreparedPreview } from '@/systems/combat/preparedAttacks';

/**
 * The seam every boss and elite plugs into.
 *
 * Sixteen files implemented the same shape by convention — an `isX`, a `chooseXMove`,
 * a `castXMove`, a `beginXTurn`, a `landXWarning`, a `beforeX` and an `afterX` — and
 * were wired by hand at six places, so a new encounter was an edit to every one of
 * them and the order of the before-hooks was a nested call chain nobody could read.
 * An `EncounterScript` is that shape named once: each hook is optional, and an
 * encounter that has no opinion at a point simply leaves it out. The registry
 * (`scriptRegistry`) walks the list once per hook point, in registration order.
 *
 * A script owns **rules**, not a unit: most hooks are handed the unit or the warning
 * and answer for themselves whether it is theirs (`false`, `null` or the unit
 * unchanged when it is not). Per-script state lives in `CombatUnit.bossScript`,
 * which each script reads and writes through its own accessors.
 *
 * The order a warned attack goes through, pinned by `encounterScript.test.ts`:
 * `land` (a script that lands it whole takes it and the rest is skipped) → else
 * `beforeLanding` (each script may move the striker) → the ordinary resolver →
 * `afterLanding` (every script, once the strike has happened). Only `land` strikes, and it
 * strikes through the `Landing` it is handed.
 */

export interface DecideContext {
  enemy: CombatUnit;
  /** Who it may reach: the opposing side, less whoever a duel's circle bars. */
  foes: CombatUnit[];
  allUnits: CombatUnit[];
  trace: (chose: string, over?: Partial<AITrace>) => void;
  considered?: AIConsideration[];
  /** The ordinary scoring, restricted to `skills` and aimed at `against`. */
  aim(skills: HeroSkill[], against: CombatUnit[]): SkillResult | null;
  /** The hex nearest the closest of `against` the unit can walk to, or `null` to hold. */
  approach(against: CombatUnit[]): HexCoord | null;
}

export interface CastContext {
  caster: CombatUnit;
  skill: HeroSkill;
  target: HexCoord;
  /** The rotation position the action carries once it is done (`AIAction.bossStep`). */
  bossStep: number | undefined;
  sink: CombatSink;
}

/**
 * One warned attack landing, handed to the script that lands it whole (`EncounterScript.land`).
 *
 * Every blow a warning makes goes through it, so the landing knows who it actually struck: the
 * answer tally and the whiff are decided from that, not from the footprint as it was warned. A
 * script that lands its warning its own way still strikes through these, never past them
 * (`warnedLanding` builds it; see there for the order a landing runs in).
 */
export interface Landing {
  readonly attack: PreparedAttack;
  /**
   * The warning's footprint struck from `striker` by the one landing plan (`landingPlan`): the
   * split, the blocker and the shelter applied. `over` names a different blow of the same warning
   * (`skill`, `aim`) or another area it lands (`hexes`: a spire's blast), which gets its own plan.
   * `pushOrigin: null` is a blow with no push origin of its own.
   */
  strike(
    striker: CombatUnit,
    sink: CombatSink,
    over?: { skill?: HeroSkill; aim?: HexCoord; hexes?: HexCoord[]; pushOrigin?: HexCoord | null },
  ): void;
  /**
   * A further blow of the warning over `hexes` of its own, outside the plan (Skyfire's landing
   * blow, a bite, Kairen's downdraft): the ordinary resolver, landing like any warned strike, and
   * the bodies on those hexes counted as struck.
   */
  blow(striker: CombatUnit, skill: HeroSkill, aim: HexCoord, sink: CombatSink, hexes: HexCoord[]): void;
  /** Bodies the landing reached without a blow over ground: the pair a chain settles on, a marsh's catch. */
  hit(unitIds: readonly string[]): void;
  /** The party broke it as it came due (a chain that lost a link): counted `broken`, nobody struck. */
  broken(): void;
}

/**
 * An encounter's answer to a unit paying for a skill: the Writ's price, a Foreclosure seal's toll,
 * the Geas spent. The resolver fires it once per paid cast (`castRules.castPaid`), so a new cast
 * path is one call and never a list of curses to remember.
 *
 * Not an `EncounterScript` hook, because of where the resolver sits: every script lands its
 * warnings through `resolveSkillUse`, so the resolver cannot reach their registry (the
 * import-cycle suite holds that line). A cast rule lives in the encounter's own store-writing
 * module instead, which never casts through the resolver, and `castRules` lists them.
 */
export interface CastRule {
  id: string;
  /**
   * `caster` has paid for `skill` (a cast, a release, or a warning announced) and its blows landed
   * on `struck`. Called for every caster; a rule answers only what it laid on them.
   */
  paid(caster: CombatUnit, skill: HeroSkill, struck: readonly string[], fx: Pick<CombatSink, 'log' | 'float'>): void;
}

export interface EncounterScript {
  id: string;
  /**
   * Chooses the unit's actions instead of the ordinary scoring, or `null` when the
   * unit is not this script's. A scripted unit's sequence — preparations that must
   * run to the end, delayed payoffs — is not something a highest-damage pick can hold.
   */
  decide?(ctx: DecideContext): AIAction[] | null;
  /**
   * Casts a skill through the script's own rules when it is one of the script's
   * moves. `true` means the script took it (whether or not the cast landed); `false`
   * means it is an ordinary skill and the resolver casts it.
   */
  cast?(ctx: CastContext): boolean;
  /** Something between two turns, whoever's it is: a response owed, a fracture following its heroes. */
  betweenTurns?(sink: CombatSink): void;
  /** A unit's regular turn is beginning. */
  beginTurn?(unit: CombatUnit, sink: CombatSink): void;
  /**
   * A unit's regular turn is beginning, after its statuses and the ground under it have ticked and
   * before it is known whether it may act, so a Stun or a Freeze does not spare it: the Furnace Heart's
   * burn on its carrier. Called for every unit; a script answers only what it laid.
   */
  turnTick?(unit: CombatUnit, sink: CombatSink): void;
  /**
   * Lands a warned attack whole, every blow through `landing`. `true` when it did, `false` for
   * the ordinary strike to run.
   */
  land?(landing: Landing, caster: CombatUnit, sink: CombatSink): boolean;
  /** Where the ordinary strike is made from: a leap comes down in the marked ground. */
  beforeLanding?(attack: PreparedAttack, striker: CombatUnit, sink: CombatSink): CombatUnit;
  /**
   * What a warned attack leaves behind once it has landed. `held` is the preview the landing was
   * struck by, fixed before anything moved: who was braced and against what, who shared it.
   */
  afterLanding?(attack: PreparedAttack, caster: CombatUnit, sink: CombatSink, held?: PreparedPreview): void;
  /**
   * A warned attack landed and struck nobody. Called for every script with the attack, once;
   * a script answers only the hooks it owns (`attack.spec.onWhiff`), so no boss answers another's.
   */
  whiff?(attack: PreparedAttack, caster: CombatUnit, sink: CombatSink): void;
  /** What a cast leaves behind: a warning's riders, a marsh, a seed. */
  afterCast?(caster: CombatUnit, skill: HeroSkill, kind: 'prepare' | 'strike', sink: CombatSink): void;
}
