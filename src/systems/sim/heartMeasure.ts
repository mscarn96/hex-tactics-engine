import { AuraType, CombatUnit, PreparedAttack } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { LAIR_SPECS } from '@/locations/lairs';
import { useCombatStore } from '@/stores/combatStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { createEnemyUnits, createPlayerUnits, generateEnemyPositions, generatePlayerPositions } from '@/systems/combat/unitFactory';
import { runHeadless, TurnPolicy } from '@/systems/sim/fightRunner';
import { neutralDepth, threatPowerScale } from '@/systems/world/threat';
import { buildSimHero, SimHeroConfig } from '@/systems/sim/simHarness';
import { measuredPartyPolicy } from '@/systems/sim/emperorMeasure';
import { ANCHOR_KIND, reprisalGrade, SPIRE_KIND } from '@/systems/combat/heartScript';
import { clampHeartTier, heartTierScale } from '@/systems/world/heartRefight';
import type { AnswerTally } from '@/systems/combat/answerTally';

/**
 * Measuring the Heart of Winter's fight.
 *
 * Runs the real fight headlessly — `beginTurn`, the Heart's move selection, the real
 * damage pipeline and the real turn hand-over — with a party the tuning harness
 * builds, and reports what happened: how many turns it took, what it chose, which
 * warnings landed and which were broken, and how it was released. The same job
 * `dragonMeasure` does for the Hollow's boss, for the same reason: the plan asks for
 * the encounter HP to be set from a measured fight.
 *
 * **The parties bracket the answer.** The plain AI party never leaves a footprint and
 * never goes for an objective on purpose; the *responding* one steps out of a footprint
 * the way a prepared player does (`respondingPolicy`). Neither plays the objectives, so
 * the sim reads as the party at its least prepared — a floor on how hard the fight can
 * go, not a prediction. Retune from play, not from the sim.
 */

export interface HeartOptions {
  party: SimHeroConfig[];
  /** The average party level the Heart is scaled to. Defaults to the party's own. */
  partyLevel?: number;
  /**
   * The Winter Seal tier (`heartRefight.ts`): 1, the default, is the lair's own fight; above it the
   * refight, priced × the tier and carrying it on the Heart for its twists, as the game builds it.
   */
  tier?: number;
  /** A party that answers warnings, or the plain brain that does not. */
  responds: boolean;
  /**
   * Plays the heroes' turns in place of `respondingPolicy` (the balance simulator's party policy):
   * return the actions, or null to leave the turn to the plain brain.
   */
  policy?: TurnPolicy;
  /**
   * A party that plays the fight: spires first, then the anchors, and the Heart only
   * once nothing else is left to answer. The plain brain spreads its blows over whatever
   * is nearest, which is a floor; this is the party the fight is *about*.
   */
  playsObjectives?: boolean;
  /** A cap on individual unit turns, so a fight nobody can finish ends. */
  maxTurns?: number;
  /** Lines of the fight as it is played: a header per unit turn, then what the turn logged. For a replay. */
  transcript?: string[];
}

export interface HeartRun {
  outcome: 'victory' | 'defeat' | 'draw';
  /** Regular turns it began, whatever it did with them — landings included. */
  bossTurns: number;
  /** What it cast, by skill id, and the order it chose them in. */
  moves: Record<string, number>;
  order: string[];
  /** Warnings that landed, by skill id. */
  landed: Record<string, number>;
  /** The most warnings of its own open at once: always one or none. */
  peakOpen: number;
  /** Anchors and spires the party destroyed. */
  anchorsBroken: number;
  spiresBroken: number;
  /** How it came free: by the last anchor, by health, or not at all. */
  released: 'anchors' | 'health' | 'never';
  /** Boss turn on which it was released, when it was. */
  releasedOnTurn?: number;
  /** Turns an exposure window was open at the start of its turn. */
  exposedTurns: number;
  heroDeaths: number;
  /** Individual unit turns taken by every side, for the balance simulator's facts. */
  unitTurns: number;
  /** Its maximum HP in the fight — the encounter HP the plan talks about — and what it had left. */
  bossMaxHp: number;
  bossHpLeft: number;
  partyDamageTaken: number;
  partyMaxHp: number;
  /** How each warned move was answered over the fight (`answerTally`): the instrument for "one column above seventy per cent". */
  tally: AnswerTally;
  /** How whole the bound anchor was when each Icebound Reprisal landed (1 whole, 0 nothing): what partial damage bought. */
  reprisalGrades: number[];
}

/**
 * The roster as a party that plays the objectives sees it: while spires stand only the
 * spires can be the target, then the anchors, then the Heart. The units themselves are
 * the store's; only the choice is narrowed.
 */
function objectiveFocus(units: CombatUnit[]): CombatUnit[] {
  const alive = (kind: string) => units.some((u) => u.currentHp > 0 && u.objective?.kind === kind);
  const hide = alive(SPIRE_KIND)
    ? (u: CombatUnit) => !u.isPlayer && u.objective?.kind !== SPIRE_KIND
    : alive(ANCHOR_KIND)
      ? (u: CombatUnit) => !u.isPlayer && u.objective?.kind !== ANCHOR_KIND
      : () => false;
  return units.filter((u) => !hide(u));
}

/** The encounter scale the ice lair's boss is fielded at: the lair's band, at neutral depth. */
export const glacierPowerScale = (): number => {
  const spec = LAIR_SPECS.find((s) => s.boss === 'heart_of_winter');
  return spec ? threatPowerScale(spec.band, neutralDepth(spec.band), false) : 1;
};

/** The summed party level that opens the ice lair's gate, and the level a pair of heroes is at it. */
export const HEART_GATE_PARTY_LEVEL = Math.max(1, Math.round(
  (LAIR_SPECS.find((s) => s.boss === 'heart_of_winter')?.unlockLevel ?? BALANCE.MASTERY_UNLOCK_LEVEL) / 2,
));

export function runHeart(options: HeartOptions): HeartRun {
  const level = options.partyLevel ?? Math.max(1, Math.round(
    options.party.reduce((sum, c) => sum + c.level, 0) / Math.max(1, options.party.length),
  ));

  useInventoryStore.getState().reset();
  const mint = useInventoryStore.getState().addItem;
  const heroes = options.party.map((config, i) => {
    // The index, not a counter that outlives the run: ids that depend on how many fights came
    // before change tie-breaks, and a replay would not be the fight it replays
    const hero = buildSimHero(config, mint, `heart_${i}`);
    if (!hero) throw new Error(`no hero template ${config.templateId}`);
    return hero;
  });

  const players = createPlayerUnits(heroes, generatePlayerPositions(heroes.length));
  const tier = clampHeartTier(options.tier ?? 1);
  const enemies = createEnemyUnits(['heart_of_winter'], generateEnemyPositions(1), level, glacierPowerScale() * heartTierScale(tier))
    .map((u) => (tier > 1 ? { ...u, challengeTier: tier } : u));

  const store = useCombatStore.getState();
  store.reset();
  store.initCombat(players, enemies);

  const moves: Record<string, number> = {};
  const landed: Record<string, number> = {};
  const order: string[] = [];
  let bossTurns = 0;
  let peakOpen = 0;
  const reprisalGrades: number[] = [];
  let exposedTurns = 0;
  let released: HeartRun['released'] = 'never';
  let releasedOnTurn: number | undefined;
  const bossMaxHp = enemies[0].stats.maxHp;
  const isBoss = (u: CombatUnit) => u.templateId === 'heart_of_winter';
  const standing = (kind: string) =>
    useCombatStore.getState().units.filter((u) => u.currentHp > 0 && u.objective?.kind === kind).length;
  // Anchors seen and standing: tier 5 raises two more at a quarter health
  let anchorsSeen = standing(ANCHOR_KIND);
  let anchorsLeft = anchorsSeen;
  let spiresBroken = 0;
  let spiresSeen = 0;

  // Read as each turn comes up: whether it is a speed-granted one, the warnings its unit has open, the spires
  let bonus = false;
  let before: PreparedAttack[] = [];
  let spiresBefore = 0;
  let gradeBefore = new Map<string, number>();
  const { outcome, turns: unitTurns } = runHeadless({
    maxTurns: options.maxTurns ?? 800,
    policy: measuredPartyPolicy(options),
    brainView: (unit, units) => (unit.isPlayer && options.playsObjectives ? objectiveFocus(units) : units),
    transcript: options.transcript && { lines: options.transcript },
    watches: [{
      before: (current) => {
        bonus = useCombatStore.getState().bonusTurn.active;
        before = useCombatStore.getState().preparedAttacks.filter((p) => p.casterId === current.id);
        spiresBefore = standing(SPIRE_KIND);
        // The chain's grade as it is about to land: read off the anchor before the boss's turn resolves it
        gradeBefore = new Map(before.filter((p) => p.skill.id === 'icebound_reprisal')
          .map((p) => [p.id, reprisalGrade(p.id, useCombatStore.getState().units)] as const));
      },
      started: (current, started) => {
        if (isBoss(current) && !bonus && (started.kind === 'act' || started.kind === 'resolved')) {
          bossTurns++;
          if (started.kind === 'resolved') {
            const gone = before.filter((p) => !useCombatStore.getState().preparedAttacks.some((q) => q.id === p.id));
            for (const p of gone) {
              landed[p.skill.id] = (landed[p.skill.id] ?? 0) + 1;
              const grade = gradeBefore.get(p.id);
              if (grade !== undefined && grade > 0) reprisalGrades.push(grade);
            }
          }
          const boss = useCombatStore.getState().units.find(isBoss);
          if (boss?.activeEffects.some((e) => e.type === AuraType.Exposed)) exposedTurns++;
        }
        const spiresNow = standing(SPIRE_KIND);
        if (spiresNow > spiresSeen) spiresSeen = spiresNow;
        if (spiresNow < spiresBefore && started.kind !== 'resolved') spiresBroken += spiresBefore - spiresNow;

        peakOpen = Math.max(
          peakOpen,
          useCombatStore.getState().preparedAttacks.filter((p) => p.casterId !== undefined && isBoss(
            useCombatStore.getState().units.find((u) => u.id === p.casterId) ?? current,
          )).length,
        );
      },
      traces: isBoss,
      decided: (_boss, t) => {
        if (!t.choseSkillId || bonus) return;
        moves[t.choseSkillId] = (moves[t.choseSkillId] ?? 0) + 1;
        order.push(t.choseSkillId);
      },
      after: () => {
        // How it was freed: with health to spare it was the last anchor, at or under the threshold it was its health
        const boss = useCombatStore.getState().units.find(isBoss);
        if (boss && released === 'never' && (boss.bossPhase ?? 0) >= 1) {
          released = boss.currentHp > boss.stats.maxHp * BALANCE.HEART_RELEASE_THRESHOLD ? 'anchors' : 'health';
          releasedOnTurn = bossTurns;
        }
        const now = standing(ANCHOR_KIND);
        if (now > anchorsLeft) anchorsSeen += now - anchorsLeft;
        anchorsLeft = now;
      },
    }],
  });

  const finalUnits = useCombatStore.getState().units;
  const party = finalUnits.filter((u) => u.isPlayer && !u.objective && !u.summonedBy);
  return {
    outcome,
    bossTurns,
    moves,
    order,
    landed,
    peakOpen,
    anchorsBroken: anchorsSeen - anchorsLeft,
    spiresBroken,
    released,
    ...(releasedOnTurn !== undefined && { releasedOnTurn }),
    exposedTurns,
    heroDeaths: party.filter((u) => u.currentHp <= 0).length,
    unitTurns,
    bossMaxHp,
    bossHpLeft: Math.max(0, finalUnits.find(isBoss)?.currentHp ?? 0),
    partyDamageTaken: party.reduce((sum, u) => sum + (useCombatStore.getState().fightStats[u.id]?.damageTaken ?? 0), 0),
    partyMaxHp: party.reduce((sum, u) => sum + u.stats.maxHp, 0),
    tally: useCombatStore.getState().answerTally,
    reprisalGrades,
  };
}
