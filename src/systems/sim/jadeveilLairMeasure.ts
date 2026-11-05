import type { CombatUnit } from '@/models/types';
import { LAIR_SPECS } from '@/locations/lairs';
import { useCombatStore } from '@/stores/combatStore';
import { isLastLesson, lessonMemory } from '@/systems/combat/lastLessonRules';
import { isHanging, isJorogumo, THREAD_KIND, WEB_KIND } from '@/systems/combat/yokaiKits';
import { bandPowerStep } from '@/systems/world/bandPower';
import { neutralDepth, threatPowerScale } from '@/systems/world/threat';
import { runHeadless, TurnPolicy } from '@/systems/sim/fightRunner';
import { fieldJadeveilBoss } from '@/systems/sim/jadeveilField';
import type { SimHeroConfig } from '@/systems/sim/simHarness';
import { measuredPartyPolicy } from '@/systems/sim/emperorMeasure';
import type { AnswerTally } from '@/systems/combat/answerTally';

/**
 * Measuring Jadeveil's two lair bosses in their lairs' boss fights (`lair_silk_boss`, `lair_hall_boss`), at the
 * level and power of the campaign in force (`balance/bandRoad`; their sites' `levelOffset` sets the level).
 *
 * The Jorōgumo opens on her perch, hung from her threads, and the board is hers: `bossRegistry` raises them as
 * the fight begins. The Last Lesson names his lessons and strikes what he is owed between turns, by his script.
 */

export interface LairBossOptions {
  party: SimHeroConfig[];
  responds: boolean;
  policy?: TurnPolicy;
  maxTurns?: number;
  transcript?: string[];
  /** Taken by the shared measurer signature; a lair has no Seal. */
  tier?: number;
}

export interface LairBossRun {
  outcome: 'victory' | 'defeat' | 'draw';
  bossTurns: number;
  moves: Record<string, number>;
  heroDeaths: number;
  unitTurns: number;
  bossMaxHp: number;
  level: number;
  powerScale: number;
  tally: AnswerTally;
}

export interface JorogumoRun extends LairBossRun {
  /** Threads cut, webs cut, and the boss turn she came down on (null: she never did). */
  threadsCut: number;
  websCut: number;
  droppedOnTurn: number | null;
}

export interface LastLessonRun extends LairBossRun {
  /** The rounds he named a lesson in. */
  lessonsTaught: number;
}

const lairPower = (boss: string, band: number): number => {
  const spec = LAIR_SPECS.find((s) => s.boss === boss);
  return (spec ? threatPowerScale(spec.band, neutralDepth(spec.band), false) : 1) * bandPowerStep(band);
};

/** The harness's scales for the two bosses at a band: the lair's ground and the band's step. */
export const jorogumoPowerScale = (band = 1): number => lairPower('jorogumo', band);
export const lastLessonPowerScale = (band = 1): number => lairPower('last_lesson', band);

function playLairBoss(
  options: LairBossOptions,
  encounterId: string,
  idPrefix: string,
  isBoss: (u: CombatUnit) => boolean,
  watch: { turnStarted?: (boss: CombatUnit) => void; after?: () => void } = {},
): LairBossRun {
  const built = fieldJadeveilBoss(encounterId, options.party, idPrefix);
  const moves: Record<string, number> = {};
  let bossTurns = 0;
  const bossMaxHp = built.enemies.find(isBoss)?.stats.maxHp ?? 0;
  const { outcome, turns: unitTurns } = runHeadless({
    maxTurns: options.maxTurns ?? 800,
    policy: measuredPartyPolicy(options),
    transcript: options.transcript && { lines: options.transcript },
    watches: [{
      started: (current, started) => {
        if (isBoss(current) && (started.kind === 'act' || started.kind === 'resolved')) {
          bossTurns++;
          watch.turnStarted?.(current);
        }
      },
      traces: isBoss,
      decided: (_boss, trace) => {
        if (trace.choseSkillId) moves[trace.choseSkillId] = (moves[trace.choseSkillId] ?? 0) + 1;
      },
      after: watch.after,
    }],
  });
  const units = useCombatStore.getState().units;
  return {
    outcome,
    bossTurns,
    moves,
    heroDeaths: units.filter((u) => u.isPlayer && !u.objective && !u.summonedBy && u.currentHp <= 0).length,
    unitTurns,
    bossMaxHp,
    level: built.partyLevel,
    powerScale: built.powerScale,
    tally: useCombatStore.getState().answerTally,
  };
}

export function runJorogumo(options: LairBossOptions): JorogumoRun {
  let threadsCut = 0;
  let websCut = 0;
  let turns = 0;
  let droppedOnTurn: number | null = null;
  const standing = (kind: string) => new Set(useCombatStore.getState().units.filter((u) => u.currentHp > 0 && u.objective?.kind === kind).map((u) => u.id));
  let threads = new Set<string>();
  let webs = new Set<string>();
  const run = playLairBoss(options, 'lair_silk_boss', 'jorogumo', isJorogumo, {
    turnStarted: () => { turns++; },
    after: () => {
      const threadsNow = standing(THREAD_KIND);
      const websNow = standing(WEB_KIND);
      threadsCut += [...threads].filter((id) => !threadsNow.has(id)).length;
      websCut += [...webs].filter((id) => !websNow.has(id)).length;
      threads = threadsNow;
      webs = websNow;
      const spider = useCombatStore.getState().units.find(isJorogumo);
      if (droppedOnTurn === null && spider && !isHanging(spider)) droppedOnTurn = turns;
    },
  });
  return { ...run, threadsCut, websCut, droppedOnTurn };
}

export function runLastLesson(options: LairBossOptions): LastLessonRun {
  let lessonsTaught = 0;
  const run = playLairBoss(options, 'lair_hall_boss', 'last_lesson', isLastLesson, {
    after: () => {
      const boss = useCombatStore.getState().units.find(isLastLesson);
      if (boss) lessonsTaught = lessonMemory(boss).taught;
    },
  });
  return { ...run, lessonsTaught };
}
