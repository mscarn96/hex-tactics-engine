import { AfflictionType, CombatUnit, PreparedAttack } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { LAIR_SPECS } from '@/locations/lairs';
import { useCombatStore } from '@/stores/combatStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { createEnemyUnits, createPlayerUnits, generateEnemyPositions, generatePlayerPositions } from '@/systems/combat/unitFactory';
import { runHeadless, TurnPolicy } from '@/systems/sim/fightRunner';
import { neutralDepth, threatPowerScale } from '@/systems/world/threat';
import { buildSimHero, SimHeroConfig } from '@/systems/sim/simHarness';
import { measuredPartyPolicy } from '@/systems/sim/emperorMeasure';
import { applySkillStatus } from '@/systems/combat/combatEvents';
import type { AnswerTally } from '@/systems/combat/answerTally';
import { heatOf } from '@/systems/combat/dragonHeat';
import { riftActive } from '@/systems/combat/dragonScript';
import { isPreparedDue } from '@/systems/combat/preparedAttacks';

/**
 * Measuring the Emerald Dragon's fight.
 *
 * Runs the real fight headlessly — `beginTurn`, the Dragon's move selection, the
 * real damage pipeline and the real turn hand-over — with a party the tuning
 * harness builds, and reports what happened: how many turns he took, what he
 * chose, which warnings landed and which were broken. The same job
 * `trollMeasure` does for the Warren's boss, for the same reason: the plan asks
 * for the encounter HP to be set from a measured fight.
 *
 * **Two parties bracket the answer.** The plain AI party never leaves a
 * footprint; the *responding* one steps out of one the way a prepared player
 * does (`respondingPolicy`). Neither interrupts or breaks a Heart on purpose, so
 * the sim reads as the party at its least prepared — a floor on how hard the
 * fight can go, not a prediction. Retune from play, not from the sim.
 */

export interface DragonOptions {
  party: SimHeroConfig[];
  /** The average party level the Dragon is scaled to. Defaults to the party's own. */
  partyLevel?: number;
  /** A party that answers warnings, or the plain brain that does not. */
  responds: boolean;
  /**
   * Plays the heroes' turns in place of `respondingPolicy` (the balance simulator's party policy):
   * return the actions, or null to leave the turn to the plain brain.
   */
  policy?: TurnPolicy;
  /**
   * A party that carries an answer to Skyfire: the first hero to act while one is
   * open lands a Stun on him, standing in for whichever of Stun, Silence, Freeze
   * or Taunt the party has. The skill is not simulated, only the answer, which
   * is what the fight is measuring.
   */
  interrupts?: boolean;
  /** A cap on individual unit turns, so a fight nobody can finish ends. */
  maxTurns?: number;
  /** Lines of the fight as it is played: a header per unit turn, then what the turn logged. For a replay. */
  transcript?: string[];
}

export interface DragonRun {
  outcome: 'victory' | 'defeat' | 'draw';
  /** Regular turns he began, whatever he did with them — landings included. */
  bossTurns: number;
  /** What he cast, by skill id. */
  moves: Record<string, number>;
  /** Warnings that landed, by skill id. */
  landed: Record<string, number>;
  /** Skyfires the party broke. */
  interrupted: number;
  /** Every move in the order he chose it. */
  order: string[];
  /** The most warnings of his open at once, his carried Heart aside: always one or none. */
  peakOpen: number;
  heroDeaths: number;
  /** Individual unit turns taken by every side, for the balance simulator's facts. */
  unitTurns: number;
  /** His maximum HP in the fight — the encounter HP the plan talks about — and what he had left. */
  bossMaxHp: number;
  bossHpLeft: number;
  partyDamageTaken: number;
  partyMaxHp: number;
  /** How each warned move was answered over the fight (`answerTally`): the instrument for "one column above seventy per cent". */
  tally: AnswerTally;
  /**
   * The highest his heat reached (`dragonHeat`), its mean over the fight (read after every unit turn) and the
   * number of times a quench made it fall.
   */
  heatPeak: number;
  heatMean: number;
  quenches: number;
  /**
   * The carried Furnace Heart over the fight: how many he threw, how often one changed hands, and how each
   * ended — broken, bursting on time on whoever held it, or bursting at once on a fallen carrier's hex —
   * with what the early bursts cost the heroes (health, and heroes felled by them).
   */
  hearts: HeartFacts;
  /** Skyfires cast while a Cinder Rift was burning (the trench there to shelter in), and with none. */
  skyfire: { withRift: number; withoutRift: number };
}

export interface HeartFacts {
  thrown: number;
  passes: number;
  broken: number;
  burst: number;
  early: number;
  earlyDamage: number;
  earlyDeaths: number;
}

/** The encounter scale the Hollow's boss is fielded at: the lair's band, at neutral depth. */
export const hollowPowerScale = (): number => {
  const spec = LAIR_SPECS.find((s) => s.boss === 'dragon');
  return spec ? threatPowerScale(spec.band, neutralDepth(spec.band), false) : 1;
};

export function runDragon(options: DragonOptions): DragonRun {
  const level = options.partyLevel ?? Math.max(1, Math.round(
    options.party.reduce((sum, c) => sum + c.level, 0) / Math.max(1, options.party.length),
  ));

  useInventoryStore.getState().reset();
  const mint = useInventoryStore.getState().addItem;
  const heroes = options.party.map((config, i) => {
    // The index, not a counter that outlives the run: ids that depend on how many fights came
    // before change tie-breaks, and a replay would not be the fight it replays
    const hero = buildSimHero(config, mint, `dragon_${i}`);
    if (!hero) throw new Error(`no hero template ${config.templateId}`);
    return hero;
  });

  const players = createPlayerUnits(heroes, generatePlayerPositions(heroes.length));
  const enemies = createEnemyUnits(['dragon'], generateEnemyPositions(1), level, hollowPowerScale());

  const store = useCombatStore.getState();
  store.reset();
  store.initCombat(players, enemies);

  const moves: Record<string, number> = {};
  const landed: Record<string, number> = {};
  const order: string[] = [];
  let bossTurns = 0;
  let peakOpen = 0;
  let interrupted = 0;
  let heatPeak = 1;
  let quenches = 0;
  let lastHeat = 1;
  let heatSum = 0;
  let heatReads = 0;
  const bossMaxHp = enemies[0].stats.maxHp;
  const isBoss = (u: CombatUnit) => u.templateId === 'dragon';

  // Read as each turn comes up: whether it is a speed-granted one, and the warnings its unit has open
  let bonus = false;
  let before: PreparedAttack[] = [];
  // Every warning of his seen so far, and the Heart's carrier as last seen, read between turns
  const hearts: HeartFacts = { thrown: 0, passes: 0, broken: 0, burst: 0, early: 0, earlyDamage: 0, earlyDeaths: 0 };
  const skyfire = { withRift: 0, withoutRift: 0 };
  const seen = new Set<string>();
  const carriers = new Map<string, { carrierId?: string; due: boolean }>();
  let partyHp = new Map<string, number>();
  const heroesNow = () => useCombatStore.getState().units.filter((u) => u.isPlayer && !u.objective && !u.summonedBy);
  /** New warnings of his (a Rift raised with the wing, a Skyfire over or clear of a Rift), and a Heart changing hands. */
  const readWarnings = () => {
    const live = useCombatStore.getState();
    const boss = live.units.find(isBoss);
    for (const p of live.preparedAttacks.filter((x) => x.casterId === boss?.id)) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        if (p.skill.id === 'furnace_heart') hearts.thrown++;
        if (p.skill.id === 'skyfire' && boss) skyfire[riftActive(boss, live.hazards) ? 'withRift' : 'withoutRift']++;
        // The Rift is raised by the wing's own cast, so his brain never names it: counted here
        if (p.skill.id === 'cinder_rift') {
          moves.cinder_rift = (moves.cinder_rift ?? 0) + 1;
          order.push('cinder_rift');
        }
      }
      if (p.skill.id !== 'furnace_heart') continue;
      const known = carriers.get(p.id);
      const carrierId = p.bound?.[0];
      if (known && known.carrierId !== carrierId) hearts.passes++;
      carriers.set(p.id, { carrierId, due: isPreparedDue(p, live.units) });
    }
  };
  /** A Heart gone since the turn began: burst on time (it was due), burst at once on a fallen carrier, or broken. */
  const readHeartsGone = () => {
    const live = useCombatStore.getState();
    for (const [id, known] of carriers) {
      if (live.preparedAttacks.some((p) => p.id === id)) continue;
      carriers.delete(id);
      const carrier = live.units.find((u) => u.id === known.carrierId);
      if (known.due) hearts.burst++;
      else if (!carrier || carrier.currentHp <= 0) {
        hearts.early++;
        for (const hero of heroesNow()) {
          const was = partyHp.get(hero.id) ?? 0;
          if (hero.id === known.carrierId || was <= 0) continue;
          hearts.earlyDamage += Math.max(0, was - Math.max(0, hero.currentHp));
          if (hero.currentHp <= 0) hearts.earlyDeaths++;
        }
      } else hearts.broken++;
    }
  };
  const { outcome, turns: unitTurns } = runHeadless({
    maxTurns: options.maxTurns ?? 600,
    policy: measuredPartyPolicy(options),
    transcript: options.transcript && { lines: options.transcript },
    watches: [{
      before: (current) => {
        // His heat, read after every turn: its peak, its mean, and each fall (a break, a stop, a sprawl)
        const boss = useCombatStore.getState().units.find(isBoss);
        if (boss) {
          const heat = heatOf(boss);
          if (heat < lastHeat) quenches++;
          lastHeat = heat;
          heatPeak = Math.max(heatPeak, heat);
          heatSum += heat;
          heatReads++;
        }
        bonus = useCombatStore.getState().bonusTurn.active;
        before = useCombatStore.getState().preparedAttacks.filter((p) => p.casterId === current.id);
        readWarnings();
        readHeartsGone();
        partyHp = new Map(heroesNow().map((h) => [h.id, h.currentHp]));
      },
      started: (current, started) => {
        readHeartsGone();
        if (isBoss(current) && !bonus && (started.kind === 'act' || started.kind === 'resolved')) {
          bossTurns++;
          if (started.kind === 'resolved') {
            const gone = before.filter((p) => !useCombatStore.getState().preparedAttacks.some((q) => q.id === p.id));
            for (const p of gone) landed[p.skill.id] = (landed[p.skill.id] ?? 0) + 1;
          }
        }
        // His carried Heart runs alongside his other warnings: the peak counts the others
        peakOpen = Math.max(
          peakOpen,
          useCombatStore.getState().preparedAttacks.filter((p) => !p.spec.carried && isBoss(
            useCombatStore.getState().units.find((u) => u.id === p.casterId) ?? current,
          )).length,
        );
        // The party's answer to Skyfire, stood in for before the hero decides
        if (started.kind === 'act' && options.interrupts && current.isPlayer) {
          const open = useCombatStore.getState().preparedAttacks.find((p) => p.skill.id === 'skyfire');
          if (open) {
            applySkillStatus(current, open.casterId, {
              type: AfflictionType.Stun, magnitude: 1, duration: 1, sourceUnitId: current.id,
            }, { log: () => {}, float: () => {} });
            interrupted++;
          }
        }
      },
      traces: isBoss,
      decided: (_boss, t) => {
        if (!t.choseSkillId || bonus) return;
        moves[t.choseSkillId] = (moves[t.choseSkillId] ?? 0) + 1;
        order.push(t.choseSkillId);
      },
    }],
  });

  const finalUnits = useCombatStore.getState().units;
  const party = finalUnits.filter((u) => u.isPlayer && !u.objective && !u.summonedBy);
  return {
    outcome,
    bossTurns,
    moves,
    landed,
    interrupted,
    order,
    peakOpen,
    heroDeaths: party.filter((u) => u.currentHp <= 0).length,
    unitTurns,
    bossMaxHp,
    bossHpLeft: Math.max(0, finalUnits.find(isBoss)?.currentHp ?? 0),
    partyDamageTaken: party.reduce((sum, u) => sum + (useCombatStore.getState().fightStats[u.id]?.damageTaken ?? 0), 0),
    partyMaxHp: party.reduce((sum, u) => sum + u.stats.maxHp, 0),
    tally: useCombatStore.getState().answerTally,
    heatPeak,
    heatMean: heatReads > 0 ? heatSum / heatReads : 1,
    quenches,
    hearts,
    skyfire,
  };
}

/** Shared with the tests and the tuning notes, so the intended fight is named once. */
export const DRAGON_TARGET_ENCOUNTER_HP = 2000;
export const DRAGON_GATE_PARTY_LEVEL = Math.max(1, Math.round(
  (LAIR_SPECS.find((s) => s.boss === 'dragon')?.unlockLevel ?? BALANCE.MASTERY_UNLOCK_LEVEL) / 2,
));
