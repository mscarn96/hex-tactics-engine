import { CombatUnit, Hero, HexCoord } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { createEnemyUnits, createPlayerUnits, generateEnemyPositions, generatePlayerPositions } from '@/systems/combat/unitFactory';
import { getMovementRange } from '@/systems/combat/movement';
import { AIAction, decideEnemyAction } from '@/systems/combat/enemyAI';
import { carrierOf, threatensUnit } from '@/systems/combat/preparedAttacks';
import { heartBurstDrawn } from '@/systems/combat/dragonScript';
import { castleEnemyHp, castleTierScale } from '@/systems/world/castle';
import { buildSimHero, SimHeroConfig } from '@/systems/sim/simHarness';
import { runHeadless, TurnPolicy } from '@/systems/sim/fightRunner';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { AfflictionType } from '@/models/types';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { AETHELRED_PHASES } from '@/data/templates/aethelred';
import { hasEffect } from '@/systems/combat/statusEffects';

/**
 * Measuring the Emperor's fight.
 *
 * The plan asks for the fight's length to be *measured* — net party damage per
 * round after movement, cleansing, shields and objectives — and HP and the
 * thresholds chosen from that, not the other way round. This runs the real fight
 * headlessly (`beginTurn`, the AI, the real damage pipeline) with the party the
 * tuning harness builds, and reports what happened turn by turn.
 *
 * **Two parties, and they bracket the answer.** The plain AI party never leaves a
 * warning, which is the worst a party could do: it is a ceiling on how fast the
 * fight can go wrong and a floor on how long it takes. The *responding* party
 * does what a prepared player does with a warning — steps out of it, answers a
 * writ with a basic attack, regroups for a chain — and so spends actions the
 * plain one does not. The intended answer sits between them.
 */

export interface EmperorOptions {
  party: SimHeroConfig[];
  /** The average party level the boss is scaled to. */
  partyLevel?: number;
  /** The Seal tier, which scales his strength and brings his twists, the way a castle run does. */
  tier?: number;
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
  /**
   * Heroes already built (the castle chain's, carrying health and mana from the
   * stages before). Absent, the party is built from `party` into a fresh bag.
   */
  heroes?: Hero[];
  /** Fielded as a castle stage is: his health at `CASTLE_HP_SCALE`, as `buildEncounter` does. */
  castleHp?: boolean;
  /**
   * Opens the fight in a later phase (0-based), at that phase's health ceiling, to measure one phase on its
   * own: the last phase is otherwise reached by few runs, and a move that needs it (Crownfall) is tallied
   * from a handful of heroes. Absent, the fight opens in the first phase as the game does.
   */
  startPhase?: number;
}

export interface EmperorTurn {
  /** Boss turns begun so far, including this one. */
  bossTurn: number;
  phase: number;
  bossHp: number;
  partyAlive: number;
  /** What the turn was: the skill he chose, 'lands' for a warning resolving, or 'advances'. */
  action: string;
}

export interface EmperorRun {
  outcome: 'victory' | 'defeat' | 'draw';
  /** Turns Aethelred began, whatever he did with them. */
  bossTurns: number;
  /** Of those, how many fell in each phase. */
  bossTurnsByPhase: number[];
  /** Of those, how many were spent landing a warning he had raised. */
  landings: number;
  /** What the rotation chose on the turns he chose, by skill id. */
  moves: Record<string, number>;
  heroDeaths: number;
  /** Individual unit turns taken by every side, for the balance simulator's facts. */
  unitTurns: number;
  /** His maximum HP in the fight — the encounter HP the plan talks about. */
  bossMaxHp: number;
  /** Mean health lost per boss turn over the whole fight. */
  damagePerBossTurn: number;
  /** Health the heroes lost between them, over the whole fight. */
  partyDamageTaken: number;
  /** Their combined maximum health, for reading the line above against. */
  partyMaxHp: number;
  /** The lowest any hero fell, as a share of their own maximum, at the start of a boss turn. */
  lowestHeroShare: number;
  /** The boss's health at the start of each of his turns. */
  trace: EmperorTurn[];
}

function bossBaseHp(): number {
  return enemyTemplates.find((t) => t.id === 'aethelred')?.baseStats.maxHp ?? 0;
}

/** The hexes any warning from the other side covers — where standing costs health. */
export function warnedFor(unit: CombatUnit, units: CombatUnit[]): Set<string> {
  const warned = new Set<string>();
  for (const attack of useCombatStore.getState().preparedAttacks) {
    // A carried burst (the Dragon's Heart) goes wherever its carrier goes: its carrier cannot step out of it,
    // and the others step off its ground only once it is drawn, near (`heartBurstDrawn`)
    if (attack.spec.carried && (carrierOf(attack) === unit.id || !heartBurstDrawn(attack, units))) continue;
    if (!threatensUnit(attack, unit, units)) continue;
    for (const h of attack.hexes) warned.add(hexKey(h));
  }
  return warned;
}

/**
 * What a prepared player does with a hero's turn when something is coming.
 *
 * Steps out of a warned footprint to the nearest safe hex (and so does not
 * attack that turn — which is the cost the fight asks), basic-attacks while a
 * writ is on them, and walks towards a chained partner who is too far. Anything
 * else is the plain brain's. Deliberately modest: it is a floor on how well a
 * party answers, not a model of a strong player.
 */
export function respondingPolicy(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  if (!unit.isPlayer || unit.objective || unit.summonedBy) return null;

  const covered = warnedFor(unit, units);
  const reach = getMovementRange(unit, units, useCombatStore.getState().hazards);
  const boss = units.find((u) => !u.isPlayer && u.currentHp > 0 && u.templateId === 'aethelred');
  const closeness = (h: HexCoord) => (boss ? hexDistance(h, boss.position) : 0);

  if (covered.has(hexKey(unit.position))) {
    const safe = reach
      .filter((h) => !covered.has(hexKey(h)))
      .sort((a, b) => closeness(a) - closeness(b) || a.q - b.q || a.r - b.r)[0];
    if (safe) return [{ type: 'move', targetPos: safe }, { type: 'endturn' }];
  }

  if (hasEffect(unit, AfflictionType.Chained)) {
    const partner = units.find(
      (u) => u.id !== unit.id && u.isPlayer && u.currentHp > 0 && hasEffect(u, AfflictionType.Chained),
    );
    if (partner && hexDistance(unit.position, partner.position) > BALANCE.AETHELRED_CHAINS_SPLIT_RANGE) {
      const closer = reach
        .filter((h) => !covered.has(hexKey(h)))
        .sort((a, b) => hexDistance(a, partner.position) - hexDistance(b, partner.position))[0];
      if (closer && hexDistance(closer, partner.position) < hexDistance(unit.position, partner.position)) {
        return [{ type: 'move', targetPos: closer }, { type: 'endturn' }];
      }
    }
  }

  if (hasEffect(unit, AfflictionType.Writ)) {
    // A basic attack voids the writ for free; the plain brain would pay for a class skill
    const basic = unit.skills.find((s) => s.id === BASIC_ATTACK_ID);
    if (basic) {
      const target = decideEnemyAction({ ...unit, skills: [basic] }, units).find((a) => a.type === 'skill');
      if (target) return [target];
    }
  }
  return null;
}

/**
 * The policy a measurer's party plays, before the plain brain: the caller's own (the balance simulator's
 * party policy, which steps out of warnings itself) in place of the responding floor, else the floor for a
 * party that responds, else none. Stated once for every boss measurer.
 */
export function measuredPartyPolicy(options: { responds: boolean; policy?: TurnPolicy }): TurnPolicy | undefined {
  return options.policy ?? (options.responds ? respondingPolicy : undefined);
}

export function runEmperor(options: EmperorOptions): EmperorRun {
  const level = options.partyLevel ?? BALANCE.MAX_LEVEL;
  const tier = options.tier ?? 1;

  let heroes = options.heroes;
  if (!heroes) {
    useInventoryStore.getState().reset();
    const mint = useInventoryStore.getState().addItem;
    heroes = options.party.map((config, i) => {
      // The index, not a counter that outlives the run: ids that depend on how many fights came
      // before change tie-breaks, and a replay would not be the fight it replays
      const hero = buildSimHero(config, mint, `emperor_${i}`);
      if (!hero) throw new Error(`no hero template ${config.templateId}`);
      return hero;
    });
  }

  const players = createPlayerUnits(heroes, generatePlayerPositions(heroes.length));
  // He carries his Seal tier, as the castle builds him (`encounterSetup`): his twists and his Standards' backlash read it
  const enemies = createEnemyUnits(['aethelred'], generateEnemyPositions(1), level, castleTierScale(tier)).map((u) => {
    if (!options.castleHp) return { ...u, challengeTier: tier };
    const maxHp = castleEnemyHp(u.stats.maxHp);
    return { ...u, challengeTier: tier, stats: { ...u.stats, maxHp }, currentHp: maxHp };
  });

  const store = useCombatStore.getState();
  store.reset();
  store.initCombat(players, enemies);
  for (let phase = 1; phase <= (options.startPhase ?? 0); phase++) store.releaseBossPhase(enemies[0].id);
  if (options.startPhase) {
    const ceiling = Math.round(enemies[0].stats.maxHp * AETHELRED_PHASES[options.startPhase].threshold);
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === enemies[0].id ? { ...u, currentHp: Math.min(u.currentHp, ceiling) } : u)),
    }));
  }

  const trace: EmperorTurn[] = [];
  const moves: Record<string, number> = {};
  const byPhase: number[] = [0, 0, 0];
  let bossTurns = 0;
  let landings = 0;
  const bossMaxHp = enemies[0].stats.maxHp;
  let lowestHeroShare = 1;
  const isBoss = (u: CombatUnit) => u.templateId === 'aethelred';

  const { outcome, turns: unitTurns } = runHeadless({
    maxTurns: options.maxTurns ?? 600,
    policy: measuredPartyPolicy(options),
    transcript: options.transcript && { lines: options.transcript },
    watches: [{
      started: (current, started) => {
        if (!isBoss(current) || (started.kind !== 'act' && started.kind !== 'resolved')) return;
        const now = useCombatStore.getState().units.find((u) => u.id === current.id)!;
        bossTurns++;
        const phase = now.bossPhase ?? 0;
        byPhase[phase]++;
        if (started.kind === 'resolved') landings++;
        for (const u of useCombatStore.getState().units) {
          if (u.isPlayer && !u.objective && !u.summonedBy && u.stats.maxHp > 0) {
            lowestHeroShare = Math.min(lowestHeroShare, Math.max(0, u.currentHp) / u.stats.maxHp);
          }
        }
        trace.push({
          bossTurn: bossTurns,
          phase,
          bossHp: now.currentHp,
          partyAlive: useCombatStore.getState().units.filter((u) => u.isPlayer && !u.objective && u.currentHp > 0).length,
          action: started.kind === 'resolved' ? 'lands' : 'advances',
        });
      },
      traces: isBoss,
      decided: (_boss, t) => {
        if (!t.choseSkillId) return;
        moves[t.choseSkillId] = (moves[t.choseSkillId] ?? 0) + 1;
        if (trace.length > 0) trace[trace.length - 1].action = t.choseSkillId;
      },
    }],
  });

  const finalUnits = useCombatStore.getState().units;
  const boss = finalUnits.find((u) => u.templateId === 'aethelred');
  const lost = bossMaxHp - Math.max(0, boss?.currentHp ?? 0);
  return {
    outcome,
    bossTurns,
    bossTurnsByPhase: byPhase,
    landings,
    moves,
    heroDeaths: finalUnits.filter((u) => u.isPlayer && !u.objective && !u.summonedBy && u.currentHp <= 0).length,
    unitTurns,
    bossMaxHp,
    damagePerBossTurn: bossTurns > 0 ? lost / bossTurns : 0,
    partyDamageTaken: finalUnits
      .filter((u) => u.isPlayer && !u.objective && !u.summonedBy)
      .reduce((sum, u) => sum + (useCombatStore.getState().fightStats[u.id]?.damageTaken ?? 0), 0),
    partyMaxHp: finalUnits.filter((u) => u.isPlayer && !u.objective && !u.summonedBy).reduce((sum, u) => sum + u.stats.maxHp, 0),
    lowestHeroShare,
    trace,
  };
}

/** The same fight many times: rolls (crits, dodges) and warnings' timing make one run say little. */
export function runEmperorBatch(options: EmperorOptions, runs: number): EmperorRun[] {
  return Array.from({ length: runs }, () => runEmperor(options));
}

export { bossBaseHp };
