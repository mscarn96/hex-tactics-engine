import { AfflictionType, AuraType, CombatUnit, PreparedAttack } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { LAIR_SPECS } from '@/locations/lairs';
import { useCombatStore } from '@/stores/combatStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { createEnemyUnits, createPlayerUnits, generateEnemyPositions, generatePlayerPositions } from '@/systems/combat/unitFactory';
import { runHeadless, TurnPolicy } from '@/systems/sim/fightRunner';
import { neutralDepth, threatPowerScale } from '@/systems/world/threat';
import { buildSimHero, SimHeroConfig } from '@/systems/sim/simHarness';
import { measuredPartyPolicy } from '@/systems/sim/emperorMeasure';
import { heapsOf, isFurious, trollMoveOfSkill } from '@/systems/combat/trollScript';
import { isPreparedDue, previewPrepared } from '@/systems/combat/preparedAttacks';

/**
 * Measuring the Troll Chieftain's fight.
 *
 * Runs the real fight headlessly — `beginTurn`, the Troll's script, the real
 * damage pipeline, the real turn hand-over with its Fury actions — with a party
 * the tuning harness builds, and reports what happened: how many turns he took,
 * which signatures landed, when Fury lit and what it cost the party. It is the
 * same job `emperorMeasure` does for Aethelred, and it exists for the same
 * reason: the plan asks for the fight's length to be measured and the encounter
 * HP chosen from that.
 *
 * **Two parties bracket the answer.** The plain AI party never leaves a warning;
 * the *responding* one steps out of a footprint the way a prepared player does
 * (`respondingPolicy`). Neither cleanses, which the real fight rewards, so the
 * sim reads as the party at its least prepared — a floor on how hard the fight
 * can go, not a prediction.
 */

export interface TrollOptions {
  party: SimHeroConfig[];
  /** The average party level the Troll is scaled to. Defaults to the party's own. */
  partyLevel?: number;
  /** A party that answers warnings, or the plain brain that does not. */
  responds: boolean;
  /**
   * Plays the heroes' turns in place of `respondingPolicy` (the balance simulator's party policy):
   * return the actions, or null to leave the turn to the plain brain.
   */
  policy?: TurnPolicy;
  /** A cap on individual unit turns, so a fight nobody can finish ends. */
  maxTurns?: number;
  /** Lines of the fight as it is played: a header per unit turn, then what the turn logged. For a replay. */
  transcript?: string[];
}

export interface TrollRun {
  outcome: 'victory' | 'defeat' | 'draw';
  /** Regular turns he began, whatever he did with them — landings included. */
  bossTurns: number;
  /** Of those, how many were spent landing a warning he had raised. */
  landings: number;
  /** What he cast, by skill id: the cycle's own record. */
  moves: Record<string, number>;
  /** Warnings that landed, by skill id. */
  landed: Record<string, number>;
  /** The three signatures in the order he raised them — the cycle's own record, the Collapse included. */
  signatureOrder: string[];
  /**
   * For each Warren Collapse he raised, the warning whose landing raised it in the same turn: always
   * `boundary_smash` when the Smash casts the roof.
   */
  collapseRaisedBy: string[];
  /** The heaps of his rubble standing as each Boundary Smash was cast, in order: the fort left for the brace. */
  heapsAtSmash: number[];
  /** Heroes braced as each Smash landed, against his rubble and against the wall, summed over the fight. */
  braces: { rubble: number; wall: number };
  /** Farthest Prey landings that came down on his rubble and left him Exposed. */
  preyOnRubble: number;
  /** His turn count when Fury lit, or null if it never did. */
  furyAtTurn: number | null;
  /** Extra Fury actions he took. */
  furyActions: number;
  /** The most wound stacks any hero carried. */
  peakWounds: number;
  heroDeaths: number;
  /** Individual unit turns taken by every side, for the balance simulator's facts. */
  unitTurns: number;
  /** His maximum HP in the fight — the encounter HP the plan talks about. */
  bossMaxHp: number;
  /** Health the heroes lost between them over the whole fight, and their combined maximum. */
  partyDamageTaken: number;
  partyMaxHp: number;
  /** The lowest any hero fell, as a share of its maximum, at the start of a boss turn. */
  lowestHeroShare: number;
}

/** The encounter scale the Warren's boss is fielded at: the lair's band, at neutral depth. */
export const warrenPowerScale = (): number => {
  const spec = LAIR_SPECS.find((s) => s.boss === 'troll_chieftain');
  return spec ? threatPowerScale(spec.band, neutralDepth(spec.band), false) : 1;
};

export function runTroll(options: TrollOptions): TrollRun {
  const level = options.partyLevel ?? Math.max(1, Math.round(
    options.party.reduce((sum, c) => sum + c.level, 0) / Math.max(1, options.party.length),
  ));

  useInventoryStore.getState().reset();
  const mint = useInventoryStore.getState().addItem;
  const heroes = options.party.map((config, i) => {
    // The index, not a counter that outlives the run: ids that depend on how many fights came
    // before change tie-breaks, and a replay would not be the fight it replays
    const hero = buildSimHero(config, mint, `troll_${i}`);
    if (!hero) throw new Error(`no hero template ${config.templateId}`);
    return hero;
  });

  const players = createPlayerUnits(heroes, generatePlayerPositions(heroes.length));
  const enemies = createEnemyUnits(['troll_chieftain'], generateEnemyPositions(1), level, warrenPowerScale());

  const store = useCombatStore.getState();
  store.reset();
  store.initCombat(players, enemies);

  const moves: Record<string, number> = {};
  const landed: Record<string, number> = {};
  const signatureOrder: string[] = [];
  const collapseRaisedBy: string[] = [];
  const heapsAtSmash: number[] = [];
  const braces = { rubble: 0, wall: 0 };
  let preyOnRubble = 0;
  let bossTurns = 0;
  let landings = 0;
  let furyAtTurn: number | null = null;
  let furyActions = 0;
  let peakWounds = 0;
  const bossMaxHp = enemies[0].stats.maxHp;
  let lowestHeroShare = 1;
  const isBoss = (u: CombatUnit) => u.templateId === 'troll_chieftain';

  // Read as each turn comes up: whether it is a Fury action, and the warnings he has open
  let extra = false;
  let before: PreparedAttack[] = [];
  // The braces a due Smash will hold, counted once it has actually landed this turn
  let due = { rubble: 0, wall: 0 };
  const { outcome, turns: unitTurns } = runHeadless({
    maxTurns: options.maxTurns ?? 600,
    policy: measuredPartyPolicy(options),
    transcript: options.transcript && { lines: options.transcript },
    watches: [{
      before: (current) => {
        const store = useCombatStore.getState();
        extra = store.furyExtra.active && isBoss(current);
        before = store.preparedAttacks.filter((p) => p.casterId === current.id);
        // A Smash about to land: who it will hold, and against what, read off the plan the landing will use
        due = { rubble: 0, wall: 0 };
        if (!isBoss(current) || extra) return;
        for (const p of before) {
          if (trollMoveOfSkill(p.skill) !== 'smash' || !isPreparedDue(p, store.units)) continue;
          for (const m of previewPrepared(p, store.units, store.hazards).landings) {
            if (m.moved) continue;
            if (m.blockedBy?.kind === 'hazard') due.rubble++;
            else if (m.blockedBy?.kind === 'boundary') due.wall++;
          }
        }
      },
      started: (current, started) => {
        if (isBoss(current) && !extra && (started.kind === 'act' || started.kind === 'resolved')) {
          bossTurns++;
          const now = useCombatStore.getState().units.find((u) => u.id === current.id)!;
          if (furyAtTurn === null && isFurious(now)) furyAtTurn = bossTurns;
          if (started.kind === 'resolved') {
            landings++;
            const open = useCombatStore.getState().preparedAttacks.filter((p) => p.casterId === current.id);
            const gone = before.filter((p) => !open.some((q) => q.id === p.id));
            for (const p of gone) landed[p.skill.id] = (landed[p.skill.id] ?? 0) + 1;
            braces.rubble += due.rubble;
            braces.wall += due.wall;
            // The Prey baited onto a heap: he came down on it, and it left him Exposed
            if (gone.some((p) => p.scripted === 'prey') && now.activeEffects.some((e) => e.type === AuraType.Exposed)) preyOnRubble++;
            // A warning raised by a landing (the Smash bringing the roof down) is a signature too
            for (const p of open.filter((q) => !before.some((b) => b.id === q.id))) {
              signatureOrder.push(p.skill.id);
              if (p.skill.id === 'warren_collapse') collapseRaisedBy.push(gone.map((g) => g.skill.id).join('+') || 'none');
            }
          }
          for (const u of useCombatStore.getState().units) {
            if (u.isPlayer && !u.objective && !u.summonedBy && u.stats.maxHp > 0) {
              lowestHeroShare = Math.min(lowestHeroShare, Math.max(0, u.currentHp) / u.stats.maxHp);
              const wound = u.activeEffects.find((e) => e.type === AfflictionType.Wound);
              peakWounds = Math.max(peakWounds, wound?.stacks ?? 0);
            }
          }
        }
        if (isBoss(current) && extra) furyActions++;
      },
      traces: isBoss,
      decided: (boss, t) => {
        if (!t.choseSkillId || extra) return;
        moves[t.choseSkillId] = (moves[t.choseSkillId] ?? 0) + 1;
        if (t.choseSkillId === 'bonebreaker_sweep') return;
        signatureOrder.push(t.choseSkillId);
        if (t.choseSkillId === 'warren_collapse') collapseRaisedBy.push('slot');
        if (t.choseSkillId === 'boundary_smash') heapsAtSmash.push(heapsOf(boss.id, useCombatStore.getState().hazards).length);
      },
    }],
  });

  const finalUnits = useCombatStore.getState().units;
  const party = finalUnits.filter((u) => u.isPlayer && !u.objective && !u.summonedBy);
  return {
    outcome,
    bossTurns,
    landings,
    moves,
    landed,
    signatureOrder,
    collapseRaisedBy,
    heapsAtSmash,
    braces,
    preyOnRubble,
    furyAtTurn,
    furyActions,
    peakWounds,
    heroDeaths: party.filter((u) => u.currentHp <= 0).length,
    unitTurns,
    bossMaxHp,
    partyDamageTaken: party.reduce((sum, u) => sum + (useCombatStore.getState().fightStats[u.id]?.damageTaken ?? 0), 0),
    partyMaxHp: party.reduce((sum, u) => sum + u.stats.maxHp, 0),
    lowestHeroShare,
  };
}

/** The same fight many times: rolls (crits, dodges) and the warnings' timing make one run say little. */
export function runTrollBatch(options: TrollOptions, runs: number): TrollRun[] {
  return Array.from({ length: runs }, () => runTroll(options));
}

/** Shared with the tests and the tuning notes, so the intended fight is named once. */
export const TROLL_TARGET_ENCOUNTER_HP = 1500;
export const TROLL_GATE_PARTY_LEVEL = Math.max(1, Math.round(
  (LAIR_SPECS.find((s) => s.boss === 'troll_chieftain')?.unlockLevel ?? BALANCE.MASTERY_UNLOCK_LEVEL) / 2,
));
