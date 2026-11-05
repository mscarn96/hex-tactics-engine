import type { CombatUnit } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { isKairen, KAIREN_TEMPLATE_ID, taintOf } from '@/systems/combat/kairenRules';
import { bandPowerStep } from '@/systems/world/bandPower';
import { summitEncounterId, summitTierScale } from '@/systems/world/summit';
import { runHeadless, TurnPolicy } from '@/systems/sim/fightRunner';
import { fieldJadeveilBoss } from '@/systems/sim/jadeveilField';
import type { SimHeroConfig } from '@/systems/sim/simHarness';
import { measuredPartyPolicy } from '@/systems/sim/emperorMeasure';
import type { AnswerTally } from '@/systems/combat/answerTally';

/**
 * Measuring Kairen's fight on the summit, at the story tier or a Storm Seal tier.
 *
 * Fielded through the game's own encounter id (`summit_kairen_<tier>`), so the tier's scale, its twist
 * (`challengeTier`) and the band's step are what the game gives him. His weather, the storm and the brood are his
 * script's, and run as they do in the game. The band comes from the campaign in force (`balance/bandRoad`).
 */

export interface KairenOptions {
  party: SimHeroConfig[];
  /** The Storm Seal tier: 1, the default, is the story fight. */
  tier?: number;
  responds: boolean;
  policy?: TurnPolicy;
  maxTurns?: number;
  transcript?: string[];
}

export interface KairenRun {
  outcome: 'victory' | 'defeat' | 'draw';
  /** His regular turns, landings included. */
  bossTurns: number;
  /** What he chose, by skill id. */
  moves: Record<string, number>;
  /** The furthest phase he reached, and the most Taint any hero carried. */
  phase: number;
  peakTaint: number;
  heroDeaths: number;
  unitTurns: number;
  bossMaxHp: number;
  /** The level he was fielded at and his power on top of it. */
  level: number;
  powerScale: number;
  tally: AnswerTally;
}

/** The harness's scale for Kairen at a band: his tier's scale and the band's step. */
export const kairenPowerScale = (band = 1, tier = 1): number => summitTierScale(tier) * bandPowerStep(band);

export function runKairen(options: KairenOptions): KairenRun {
  const built = fieldJadeveilBoss(summitEncounterId(options.tier ?? 1), options.party, 'kairen');
  const moves: Record<string, number> = {};
  let bossTurns = 0;
  let phase = 0;
  let peakTaint = 0;
  const isBoss = (u: CombatUnit) => isKairen(u);
  const bossMaxHp = built.enemies.find((u) => u.templateId === KAIREN_TEMPLATE_ID)?.stats.maxHp ?? 0;

  const { outcome, turns: unitTurns } = runHeadless({
    maxTurns: options.maxTurns ?? 800,
    policy: measuredPartyPolicy(options),
    transcript: options.transcript && { lines: options.transcript },
    watches: [{
      started: (current, started) => {
        if (isBoss(current) && (started.kind === 'act' || started.kind === 'resolved')) bossTurns++;
      },
      traces: isBoss,
      decided: (_boss, trace) => {
        if (trace.choseSkillId) moves[trace.choseSkillId] = (moves[trace.choseSkillId] ?? 0) + 1;
      },
      after: () => {
        for (const u of useCombatStore.getState().units) {
          if (isKairen(u)) phase = Math.max(phase, u.bossPhase ?? 0);
          else if (u.isPlayer) peakTaint = Math.max(peakTaint, taintOf(u));
        }
      },
    }],
  });

  const units = useCombatStore.getState().units;
  return {
    outcome,
    bossTurns,
    moves,
    phase,
    peakTaint,
    heroDeaths: units.filter((u) => u.isPlayer && !u.objective && !u.summonedBy && u.currentHp <= 0).length,
    unitTurns,
    bossMaxHp,
    level: built.partyLevel,
    powerScale: built.powerScale,
    tally: useCombatStore.getState().answerTally,
  };
}
