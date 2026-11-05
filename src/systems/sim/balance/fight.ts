import { CombatUnit, Hero } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { createEnemyUnits, createPlayerUnits, createRivalUnits, generateEnemyPositions, generatePlayerPositions } from '@/systems/combat/unitFactory';
import { decideTactically } from '@/systems/combat/tacticalAI';
import { buildSimHero, SimHeroConfig } from '@/systems/sim/simHarness';
import type { TurnPolicy } from '@/systems/sim/fightRunner';
import { HeartFacts, runDragon } from '@/systems/sim/dragonMeasure';
import { runEmperor } from '@/systems/sim/emperorMeasure';
import { partyPolicy as rolePolicy } from './partyPolicy';
import { runHeart } from '@/systems/sim/heartMeasure';
import { runFight } from '@/systems/sim/combatSim';
import { runTroll } from '@/systems/sim/trollMeasure';
import { runKairen } from '@/systems/sim/kairenMeasure';
import { runJorogumo, runLastLesson } from '@/systems/sim/jadeveilLairMeasure';
import {
  castleEnemyHp,
  CASTLE_STAGES, castleStageName,
  castleStageCarry,
  castleStageEnemies,
  castleStagePower,
} from '@/systems/world/castle';
import { hexDistance } from '@/utils/hexUtils';
import { atSpecRoad } from './bandRoad';
import { EncounterSpec } from './encounters';
import { RolledParty, rollParty } from './partyRoll';
import { fightRng, makeRng, mixSeed, withSeededRandom } from './rng';
import { FightRecord, HeroFact, Outcome, partyRecord, StageFact } from './record';
import { ANSWER_KINDS, AnswerTally, mergeTallies, owedOf, packTally, unpackTally } from '@/systems/combat/answerTally';

/**
 * One fight per encounter, played through the real pipeline and stored as facts
 * (the private project notes, "One fight's record").
 *
 * The boss fights are the existing `run*` measurers; the castle is a chain of
 * stages with health and mana carried between them. Whatever the measurers do
 * not report (each hero's health, the boss's) is read off the combat store as
 * the fight left it.
 */

export interface BalanceFightOptions {
  /** The dodging party (default) or the plain AI party. */
  responds?: boolean;
  maxTurns?: number;
  /**
   * Castle only: called as each stage is about to begin, with the heroes as they
   * will enter it (after the patch-up) and the combat store still holding the
   * stage before. Lets a test or a replay see what was carried.
   */
  onStageStart?: (stage: number, heroes: readonly Hero[]) => void;
  /** Collects the fight turn by turn, for a replay. Never changes the dice. */
  transcript?: string[];
}

/** The turn cap ending a fight, or a deadlock, is a draw. */
const asOutcome = (o: string): Outcome => (o === 'victory' || o === 'defeat' ? o : 'draw');

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Writes the branch a hero's turn took into a replay's transcript. */
const whyOf = (options: BalanceFightOptions) => options.transcript ? (branch: string) => { options.transcript!.push(`  · ${branch}`); } : undefined;

const isHeroUnit = (u: CombatUnit) => u.isPlayer && !u.objective && !u.summonedBy && !!u.heroId;

/**
 * Plays the party's heroes: the scripted `partyPolicy` (boss answers included), or, when the spec names
 * a `partyAi`, the tactical AI at that level without its clock so a fight replays the same.
 * Monsters and summons are left to their own brain.
 */
function heroPolicy(spec: EncounterSpec, options: BalanceFightOptions): TurnPolicy {
  const ai = spec.partyAi;
  if (!ai || ai === 'brain') return (u, all) => rolePolicy(u, all, whyOf(options));
  return (u) => {
    if (!isHeroUnit(u)) return null;
    let considered = '';
    const { actions } = decideTactically(u, ai, {
      maxMs: Infinity,
      onTrace: options.transcript ? (t) => { considered = t.considered.slice(0, 5).map((c) => `${c.skillName} ${c.targetPos ? `${c.targetPos.q},${c.targetPos.r}` : ''}=${c.value}`).join(' | '); } : undefined,
    });
    // The turn as chosen, for a replay: where the hero stood, what it did and where the nearest foe was
    if (options.transcript) {
      const foes = useCombatStore.getState().units.filter((x) => !x.isPlayer && !x.objective && x.currentHp > 0);
      const near = Math.min(99, ...foes.map((x) => hexDistance(x.position, u.position)));
      const did = actions.map((a) => (a.type === 'move' ? `walks to ${a.targetPos!.q},${a.targetPos!.r}` : a.type === 'skill' ? `casts ${a.skill!.id}` : 'holds')).join(', ') || 'holds';
      options.transcript.push(`  · ${u.position.q},${u.position.r}, foe ${near} away: ${did}`); // i18n-exempt: replay transcript, shown only on the dev sim panel
      if (considered) options.transcript.push(`    weighed ${considered}`); // i18n-exempt: replay transcript, shown only on the dev sim panel
    }
    return actions;
  };
}

/** Heroes' ids end in a counter that grows in party order. */
const heroOrder = (u: CombatUnit) => Number(/(\d+)$/.exec(u.heroId ?? '')?.[1] ?? 0);

/** Each hero as the last fight left it, in party order. */
function heroFacts(): HeroFact[] {
  return useCombatStore.getState().units
    .filter(isHeroUnit)
    .sort((a, b) => heroOrder(a) - heroOrder(b))
    .map((u) => ({
      a: u.currentHp > 0 ? 1 : 0,
      hp: u.currentHp > 0 ? round3(Math.min(1, u.currentHp / Math.max(1, u.stats.maxHp))) : 0,
    }));
}

/** Share of a boss's maximum health taken off it, read from the store. */
function bossDealt(templateId: string, maxHp: number, outcome: Outcome): number {
  if (outcome === 'victory') return 1;
  const boss = useCombatStore.getState().units.find((u) => !u.isPlayer && u.templateId === templateId);
  if (!boss || maxHp <= 0) return 0;
  return round3(Math.min(1, Math.max(0, 1 - Math.max(0, boss.currentHp) / maxHp)));
}

/** What every boss measurer reports that a record keeps. */
interface MeasuredBoss {
  outcome: Outcome;
  unitTurns: number;
  bossTurns: number;
  bossMaxHp: number;
  /** The Troll's fort (`trollMeasure`): heaps standing at each Smash cast, and the braces each Smash met. */
  heapsAtSmash?: number[];
  braces?: { rubble: number; wall: number };
  preyOnRubble?: number;
  landed?: Record<string, number>;
  /** The Dragon's carried Heart and his Skyfires over a Rift (`dragonMeasure`). */
  hearts?: HeartFacts;
  skyfire?: { withRift: number; withoutRift: number };
}

/** The Troll's fort as a record keeps it, when the measurer reported it. */
const fortFacts = (run: MeasuredBoss): Pick<FightRecord, 'hs' | 'hb' | 'hx'> => ({
  ...(run.heapsAtSmash && { hs: run.heapsAtSmash }),
  ...(run.braces && { hb: [run.braces.rubble, run.braces.wall] }),
  ...(run.preyOnRubble !== undefined && { hx: [run.preyOnRubble, run.landed?.farthest_prey ?? 0] }),
});

/** The Dragon's Heart and Skyfires as a record keeps them, when the measurer reported them. */
const heartFacts = (run: MeasuredBoss): Pick<FightRecord, 'dh'> => {
  const h = run.hearts;
  const sky = run.skyfire;
  return h && sky
    ? { dh: [h.thrown, h.passes, h.broken, h.burst, h.early, h.earlyDamage, h.earlyDeaths, sky.withRift, sky.withoutRift] }
    : {};
};

/** A boss fight's facts: what its measurer reported, and the boss and heroes as the fight left them. */
function bossFacts(templateId: string, run: MeasuredBoss): Pick<FightRecord, 'o' | 't' | 'bt' | 'd' | 'h'> {
  return { o: run.outcome, t: run.unitTurns, bt: run.bossTurns, d: bossDealt(templateId, run.bossMaxHp, run.outcome), h: heroFacts() };
}

/** The lair bosses, each with the measurer that plays its fight. */
const BOSS_MEASURERS: Record<'troll' | 'dragon' | 'heart' | 'jorogumo' | 'last_lesson' | 'kairen', {
  boss: string;
  measure: (options: { party: SimHeroConfig[]; responds: boolean; policy?: TurnPolicy; maxTurns?: number; transcript?: string[]; tier?: number }) => MeasuredBoss;
}> = {
  troll: { boss: 'troll_chieftain', measure: runTroll },
  dragon: { boss: 'dragon', measure: runDragon },
  heart: { boss: 'heart_of_winter', measure: runHeart },
  jorogumo: { boss: 'jorogumo', measure: runJorogumo },
  last_lesson: { boss: 'last_lesson', measure: runLastLesson },
  kairen: { boss: 'kairen', measure: runKairen },
};

function averageLevel(party: RolledParty): number {
  return party.heroes.reduce((sum, h) => sum + h.level, 0) / Math.max(1, party.heroes.length);
}

/** The tally as a record stores it, or nothing when the enemy warned of nothing. */
const withAnswers = (tally: AnswerTally): Pick<FightRecord, 'an'> =>
  Object.keys(tally).length > 0 ? { an: packTally(tally) } : {};

/** The tally at the end of a transcript: per move, each answer's count and what was owed. */
function tallyLines(tally: AnswerTally): string[] {
  return Object.entries(tally).map(([move, row]) => // i18n-exempt: replay transcript, shown only on the dev sim panel
    `tally ${move}: ${ANSWER_KINDS.map((k) => `${k} ${row[k]}`).join(', ')} (owed ${owedOf(row)})`);
}

// ─── The castle chain ─────────────────────────────────────────────────────────

function runCastleChain(party: RolledParty, spec: EncounterSpec, tier: number, responds: boolean, options: BalanceFightOptions): Omit<FightRecord, 'seed' | 'enc' | 'dg' | 'party'> {
  useInventoryStore.getState().reset();
  const mint = useInventoryStore.getState().addItem;
  const heroes: Hero[] = party.heroes.map((config, i) => {
    const hero = buildSimHero(config, mint, `castle_${i}`);
    if (!hero) throw new Error(`no hero template ${config.templateId}`);
    return hero;
  });
  const level = averageLevel(party);

  const stages: StageFact[] = [];
  // Each stage rebuilds the combat store, so what was answered is gathered as the stages end
  let answered: AnswerTally = {};
  const gather = () => { answered = mergeTallies(answered, useCombatStore.getState().answerTally); };
  let totalTurns = 0;
  let totalEnemyTurns = 0;
  let outcome: Outcome = 'victory';

  for (let stage = spec.castleFrom ?? 0; stage < CASTLE_STAGES.length; stage++) {
    options.onStageStart?.(stage, heroes);
    options.transcript?.push(`=== ${castleStageName(CASTLE_STAGES[stage])} ===`);
    const maxTurns = options.maxTurns;
    if (CASTLE_STAGES[stage].boss) {
      const run = runEmperor({ party: [], heroes, tier, partyLevel: level, responds, policy: responds ? heroPolicy(spec, options) : undefined, castleHp: true, maxTurns, transcript: options.transcript, startPhase: spec.emperorPhase });
      stages.push({ n: stage, ...bossFacts('aethelred', run) });
      gather();
      totalTurns += run.unitTurns;
      totalEnemyTurns += run.bossTurns;
      outcome = run.outcome;
      break;
    }

    const ids = castleStageEnemies(tier, stage);
    const enemies = createEnemyUnits(ids, generateEnemyPositions(ids.length), level, castleStagePower(tier, stage)).map((u) => {
      const maxHp = castleEnemyHp(u.stats.maxHp);
      return { ...u, stats: { ...u.stats, maxHp }, currentHp: maxHp };
    });
    const enemyMax = enemies.reduce((sum, u) => sum + u.stats.maxHp, 0);
    const players = createPlayerUnits(heroes, generatePlayerPositions(heroes.length));

    let enemyTurns = 0;
    const result = runFight(players, enemies, {
      quiet: !options.transcript,
      maxTurns,
      // The party's policy steps out of warnings itself, as it does in the boss fights
      policy: responds ? heroPolicy(spec, options) : undefined,
      watch: { started: (unit, start) => { if (start.kind === 'act' && !unit.isPlayer) enemyTurns++; } },
    });
    for (const turn of result.turnLog) {
      options.transcript?.push(`#${turn.index + 1} ${turn.unitName} (${turn.isPlayer ? 'party' : 'enemy'})`);
      for (const line of turn.logs) options.transcript?.push(`  ${line.text}`);
    }
    const left = useCombatStore.getState().units.filter((u) => !u.isPlayer).reduce((sum, u) => sum + Math.max(0, u.currentHp), 0);
    stages.push({
      n: stage,
      o: asOutcome(result.outcome),
      t: result.turns,
      bt: enemyTurns,
      d: round3(Math.min(1, Math.max(0, 1 - left / Math.max(1, enemyMax)))),
      h: heroFacts(),
    });
    gather();
    totalTurns += result.turns;
    totalEnemyTurns += enemyTurns;
    if (result.outcome !== 'victory') { outcome = asOutcome(result.outcome); break; }

    // The patch-up between stages, by the game's own rule
    const byHero = new Map(useCombatStore.getState().units.filter(isHeroUnit).map((u) => [u.heroId, u]));
    for (const hero of heroes) {
      const unit = byHero.get(hero.id);
      if (!unit) continue;
      const carry = castleStageCarry(unit);
      hero.currentHp = carry.hp;
      hero.currentMana = carry.mana;
    }
  }

  const last = stages[stages.length - 1];
  const aethelred = stages.find((s) => s.n === CASTLE_STAGES.length - 1);
  return { o: outcome, t: totalTurns, bt: totalEnemyTurns, d: aethelred?.d ?? 0, h: last.h, st: stages, ...withAnswers(answered) };
}

// ─── PvP ──────────────────────────────────────────────────────────────────────

/** The second party a PvP fight's seed rolls: the same budget as the first, no constraints, its own generator. */
export function pvpRival(spec: EncounterSpec, seed: number): RolledParty {
  return rollParty(spec, {}, makeRng(mixSeed(seed, 3)));
}

/** One side's heroes as the fight left them, in party order. */
function sideFacts(isPlayer: boolean): HeroFact[] {
  return useCombatStore.getState().units
    .filter((u) => u.isPlayer === isPlayer && !u.objective && !u.summonedBy && !!u.heroId)
    .sort((a, b) => heroOrder(a) - heroOrder(b))
    .map((u) => ({
      a: u.currentHp > 0 ? 1 : 0,
      hp: u.currentHp > 0 ? round3(Math.min(1, u.currentHp / Math.max(1, u.stats.maxHp))) : 0,
    }));
}

const mirrored = (o: Outcome): Outcome => (o === 'victory' ? 'defeat' : o === 'defeat' ? 'victory' : 'draw');

/**
 * Two parties of equal standing in one budget, both played by the spec's `pvpAi` (the ordinary brain,
 * or the tactical AI without its clock, so a fight replays the same). The engine needs a side for each,
 * so which party stands where alternates with the seed; the fight is recorded twice, once from each
 * party, and each record carries the other (`vs`). The other party's health dealt stands for the
 * boss's, and its units' turns for the boss turns.
 */
export function runPvpPair(spec: EncounterSpec, first: RolledParty, second: RolledParty, seed: number, options: BalanceFightOptions = {}): [FightRecord, FightRecord] {
  const ai = spec.pvpAi ?? 'normal';
  const dg = ((options.responds ?? true) ? 1 : 0) as 0 | 1;
  return atSpecRoad(spec, () => withSeededRandom(fightRng(seed), () => {
    setTempoRandom(() => Math.random());
    useInventoryStore.getState().reset();
    const mint = useInventoryStore.getState().addItem;
    const build = (side: string, party: RolledParty) => party.heroes.map((config, i): Hero => {
      const hero = buildSimHero(config, mint, `${side}_${i}`);
      if (!hero) throw new Error(`no hero template ${config.templateId}`);
      return hero;
    });
    // The first party stands on the near end on even seeds, the far end on odd ones
    const firstNear = seed % 2 === 0;
    const near = build('pvp_near', firstNear ? first : second);
    const far = build('pvp_far', firstNear ? second : first);
    const nearUnits = createPlayerUnits(near, generatePlayerPositions(near.length));
    const farUnits = createRivalUnits(far, generateEnemyPositions(far.length));
    const maxOf = (units: CombatUnit[]) => Math.max(1, units.reduce((sum, u) => sum + u.stats.maxHp, 0));
    const nearMax = maxOf(nearUnits);
    const farMax = maxOf(farUnits);
    options.transcript?.push(`pvp (${ai} on both): near ${(firstNear ? first : second).heroes.map((h) => `${h.templateId} ${h.level} ${h.masteryPath ?? '-'}`).join(', ')}`
      + ` · far ${(firstNear ? second : first).heroes.map((h) => `${h.templateId} ${h.level} ${h.masteryPath ?? '-'}`).join(', ')}`);

    let nearTurns = 0;
    let farTurns = 0;
    const result = runFight(nearUnits, farUnits, {
      quiet: !options.transcript,
      maxTurns: options.maxTurns,
      policy: ai === 'brain' ? undefined : (unit) => decideTactically(unit, ai, { maxMs: Infinity }).actions,
      watch: { started: (unit, start) => { if (start.kind !== 'act') return; if (unit.isPlayer) nearTurns++; else farTurns++; } },
    });
    for (const turn of result.turnLog) {
      options.transcript?.push(`#${turn.index + 1} ${turn.unitName} (${turn.isPlayer ? 'near' : 'far'})`);
      for (const line of turn.logs) options.transcript?.push(`  ${line.text}`);
    }
    const units = useCombatStore.getState().units;
    const left = (isPlayer: boolean) => units.filter((u) => u.isPlayer === isPlayer && !u.summonedBy && !u.objective).reduce((sum, u) => sum + Math.max(0, u.currentHp), 0);
    const nearOutcome = asOutcome(result.outcome);
    const dealt = (won: boolean, otherLeft: number, otherMax: number) => (won ? 1 : round3(Math.min(1, Math.max(0, 1 - otherLeft / otherMax))));
    const nearRecord = {
      o: nearOutcome, t: result.turns, bt: farTurns,
      d: dealt(nearOutcome === 'victory', left(false), farMax), h: sideFacts(true),
    };
    const farRecord = {
      o: mirrored(nearOutcome), t: result.turns, bt: nearTurns,
      d: dealt(nearOutcome === 'defeat', left(true), nearMax), h: sideFacts(false),
    };
    const firstFacts = firstNear ? nearRecord : farRecord;
    const secondFacts = firstNear ? farRecord : nearRecord;
    return [
      { seed, enc: spec.id, dg, party: partyRecord(first), vs: partyRecord(second), ...firstFacts },
      { seed, enc: spec.id, dg, party: partyRecord(second), vs: partyRecord(first), sd: 1, ...secondFacts },
    ];
  }));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Plays one fight and returns its facts. Everything random in the fight comes
 * from `seed`: `Math.random` is the fight's own generator for the duration, so
 * the same seed and party replay exactly.
 */
export function runBalanceFight(spec: EncounterSpec, party: RolledParty, seed: number, options: BalanceFightOptions = {}): FightRecord {
  const responds = options.responds ?? true;
  const base = { seed, enc: spec.id, dg: (responds ? 1 : 0) as 0 | 1, party: partyRecord(party) };
  const configs = party.heroes;

  return atSpecRoad(spec, () => withSeededRandom(fightRng(seed), () => {
    // The speed bonus-turn roll captured the unseeded `Math.random` when its module loaded
    setTempoRandom(() => Math.random());
    const record = playEncounter();
    // A fight that warned of something says how it was answered, at the foot of its replay too
    if (options.transcript && record.an) options.transcript.push(...tallyLines(unpackTally(record.an)));
    return record;
  }));

  function playEncounter(): FightRecord {
    switch (spec.id) {
      case 'castle':
        return { ...base, ...runCastleChain(party, spec, spec.tier ?? 1, responds, options) };
      case 'pvp':
        // Recorded twice, from each party (`runPvpPair`); this is the first party's record
        return runPvpPair(spec, party, pvpRival(spec, seed), seed, options)[0];
      default: {
        const { boss, measure } = BOSS_MEASURERS[spec.id];
        // The Heart's Winter Seal tier and Kairen's Storm Seal tier (the lairs have none)
        const tier = spec.id === 'heart' || spec.id === 'kairen' ? spec.tier : undefined;
        const run = measure({ party: configs, responds, policy: responds ? heroPolicy(spec, options) : undefined, maxTurns: options.maxTurns, transcript: options.transcript, tier });
        return { ...base, ...bossFacts(boss, run), ...withAnswers(useCombatStore.getState().answerTally), ...fortFacts(run), ...heartFacts(run) };
      }
    }
  }
}
