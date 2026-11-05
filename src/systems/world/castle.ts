import { EnemyTemplateId } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { t, type MessageKey } from '@/i18n';
import {
  CASTLE_LADDER, canEnterTier, clampLadderTier, ladderSealReward, ladderSpendsSeal, ladderTierScale, ladderTiers, openTiers,
  twistTiersAt,
} from '@/systems/world/sealLadder';

/**
 * The castle gauntlet.
 *
 * Four fights back to back with no return to the world map between them, then a
 * repeatable ladder on top. Beating Aethelred does not end the game and does not
 * hand you his castle — it stops the tribute and leaves you holding a key to the
 * same run made meaner. A home is content that is finished the moment you own
 * it; a key is content that keeps asking whether you are strong enough yet.
 *
 * Everything here is pure. The run's state lives in `empireStore`, the fighting
 * in `combatStore`, and the composition below is the only thing either needs to
 * agree on.
 */

export type CastleStageId = 'gate' | 'yard' | 'sanctum' | 'throne';

export interface CastleStage {
  /**
   * Its words are in the `worldEvents` catalog: `castleStageName` and
   * `castleStageBlurb`, the one line shown on the stage card between fights.
   */
  id: CastleStageId;
  /**
   * Cycled to fill the stage. Curated rather than composed from roles: the
   * Legion's role table cannot tell a Sentinel from a Dread-Knight, and each
   * stage is a different *kind* of problem rather than a different size of the
   * same one — which is the entire reason it is a gauntlet.
   */
  roster: EnemyTemplateId[];
  /** Set on the last stage. A boss stage is always exactly one unit. */
  boss?: EnemyTemplateId;
}

export const CASTLE_STAGES: CastleStage[] = [
  {
    id: 'gate',
    roster: ['runeguard_sentinel', 'obsidian_infantry', 'obsidian_infantry'],
  },
  // The casters before the riders (playtest 2026-10-28): the Dread-Knights are the
  // garrison's last stand, the fight before the throne
  {
    id: 'sanctum',
    roster: ['blood_iron_arcanist', 'blood_thirster_stalker', 'blood_iron_arcanist'],
  },
  {
    id: 'yard',
    roster: ['dread_knight', 'obsidian_infantry', 'dread_knight'],
  },
  {
    id: 'throne',
    roster: [],
    boss: 'aethelred',
  },
];

export const CASTLE_STAGE_COUNT = CASTLE_STAGES.length;

/** A stage's name, in the current language. */
export function castleStageName(stage: Pick<CastleStage, 'id'>): string {
  return t(`worldEvents.castle.${stage.id}.name`);
}

/** A stage's one line for the card between fights, in the current language. */
export function castleStageBlurb(stage: Pick<CastleStage, 'id'>): string {
  return t(`worldEvents.castle.${stage.id}.blurb`);
}

/** Encounter id for one stage of a run. Decoded by `castleRunFromId`. */
export function castleEncounterId(tier: number, stage: number): string {
  return `castle_${tier}_${stage}`;
}

/** The tier and stage encoded in a castle encounter id, or null. */
export function castleRunFromId(encounterId: string): { tier: number; stage: number } | null {
  const match = /^castle_(\d+)_(\d+)$/.exec(encounterId);
  if (!match) return null;
  const tier = parseInt(match[1], 10);
  const stage = parseInt(match[2], 10);
  if (!Number.isFinite(tier) || !Number.isFinite(stage)) return null;
  if (stage < 0 || stage >= CASTLE_STAGE_COUNT) return null;
  return { tier, stage };
}

/** Every Seal tier, low to high. The ladder's rules are the shared ones (`sealLadder.ts`). */
export const SEAL_TIERS = ladderTiers(CASTLE_LADDER);

export function clampTier(tier: number): number {
  return clampLadderTier(CASTLE_LADDER, tier);
}

/**
 * Enemy stat multiplier for a tier.
 *
 * The **other** lever — count — lives in `castleStageSize`, and the two
 * multiply. Each therefore has to be gentler than it would be alone: tier 5 is
 * not 1.8× the tier-1 fight, it is roughly 1.8 × 1.7 ≈ three times it. Neither
 * number should be tuned without the other in view.
 */
export function castleTierScale(tier: number): number {
  return ladderTierScale(CASTLE_LADDER, tier);
}

/**
 * The garrison stages' multiplier: Gate, Yard and Sanctum. Their own, well above
 * `castleTierScale`, because the castle is where a finished party is tested
 * (playtest 2026-10-14) and the Legion standing in it should outclass any siege.
 */
export function castleGarrisonScale(tier: number): number {
  return BALANCE.CASTLE_GARRISON_POWER + BALANCE.CASTLE_GARRISON_TIER_POWER * (clampTier(tier) - 1);
}

/**
 * A castle enemy's health: its scaled maximum at `CASTLE_HP_SCALE`. Applied after
 * the stage's multiplier, which scales every stat alike, so the castle can be
 * shorter without hitting softer (playtest 2026-10-17).
 */
export function castleEnemyHp(maxHp: number): number {
  return Math.max(1, Math.round(maxHp * BALANCE.CASTLE_HP_SCALE));
}

/**
 * What a hero carries into the next stage: the fight's closing health and mana
 * plus the stage's patch-up (`CASTLE_STAGE_HEAL` of health, `CASTLE_STAGE_MANA`
 * of mana), capped at the maximum. A hero who fell is patched up the same way —
 * from zero — because the rule is applied to every unit of the party.
 *
 * One rule, read by the victory handler and by the balance simulator's castle
 * chain, so the simulated gauntlet cannot drift from the played one.
 */
export function castleStageCarry(unit: {
  currentHp: number;
  currentMana: number;
  stats: { maxHp: number; maxMana: number };
}): { hp: number; mana: number } {
  const { maxHp, maxMana } = unit.stats;
  return {
    hp: Math.min(maxHp, unit.currentHp + Math.round(maxHp * BALANCE.CASTLE_STAGE_HEAL)),
    mana: Math.min(maxMana, unit.currentMana + Math.round(maxMana * BALANCE.CASTLE_STAGE_MANA)),
  };
}

/** The multiplier one stage of a run fights at: the garrison's, or the tier's for Aethelred. */
export function castleStagePower(tier: number, stage: number): number {
  return CASTLE_STAGES[stage]?.boss ? castleTierScale(tier) : castleGarrisonScale(tier);
}

/**
 * How many enemies a stage fields.
 *
 * **The count lever stops at the boss.** Aethelred grows in stats only, and that
 * is not a concession to the spawn budget — a boss surrounded by eight scaled
 * guards is a fight about the guards, and his phases, his telegraph and his
 * ratcheting health bar all stop mattering. Keeping the last stage a duel is
 * what makes the three before it feel like a gauntlet rather than a warm-up.
 */
export function castleStageSize(tier: number, stage: number): number {
  if (CASTLE_STAGES[stage]?.boss) return 1;
  return Math.min(
    BALANCE.SIEGE_MAX_ENEMIES,
    BALANCE.CASTLE_BASE_ENEMIES + (clampTier(tier) - 1),
  );
}

/** The units standing in a stage, in arrival order. */
export function castleStageEnemies(tier: number, stage: number): EnemyTemplateId[] {
  const definition = CASTLE_STAGES[stage];
  if (!definition) return [];
  if (definition.boss) return [definition.boss];

  const size = castleStageSize(tier, stage);
  return Array.from({ length: size }, (_, i) => definition.roster[i % definition.roster.length]);
}

/**
 * Whether a run at this tier can be started.
 *
 * Tier 1 is free exactly once — the castle is simply there on the map, and a
 * key you need before you have ever seen the door is a locked ending. Every
 * entry after that costs a Seal, spent on the way in.
 */
export function canEnterCastle(
  tier: number,
  seals: number[],
  castleCleared: boolean,
): boolean {
  return canEnterTier(CASTLE_LADDER, tier, { seals, cleared: castleCleared });
}

/** Tiers the player can actually start right now. */
export function availableTiers(seals: number[], castleCleared: boolean): number[] {
  return openTiers(CASTLE_LADDER, { seals, cleared: castleCleared });
}

/** Whether a run at this tier spends a Seal: every one but the free first entry. */
export function castleSpendsSeal(tier: number, castleCleared: boolean): boolean {
  return ladderSpendsSeal(CASTLE_LADDER, tier, castleCleared);
}

/**
 * The Seal a cleared run pays out.
 *
 * One rung up, capped. Clearing tier 5 pays another tier-5 Seal rather than
 * nothing — the top of the ladder has to remain repeatable, or the best content
 * in the game locks itself the moment you finish it.
 */
export function sealRewardFor(tier: number): number {
  return ladderSealReward(CASTLE_LADDER, tier);
}

/** Whether the party should be warned before walking in. */
export function isUnderpowered(totalHeroLevel: number): boolean {
  return totalHeroLevel < BALANCE.CASTLE_RECOMMENDED_POWER;
}

/** One twist of Aethelred's per tier from the second, each in one line (`bossScript.aethelredTwist` reads the tier off him). */
export const CASTLE_TIER_TWISTS: Readonly<Record<number, MessageKey>> = {
  2: 'worldEvents.castleTwist.2',
  3: 'worldEvents.castleTwist.3',
  4: 'worldEvents.castleTwist.4',
  5: 'worldEvents.castleTwist.5',
};

/** Every twist in force at a tier, in the current language: each tier keeps the ones below, and tier 1 has none. */
export const castleTwistsAt = (tier: number): string[] =>
  twistTiersAt(CASTLE_LADDER, tier).map((n) => t(CASTLE_TIER_TWISTS[n]));
