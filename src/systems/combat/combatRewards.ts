import { CombatUnit, GemId, Item, MasteryId, ResourceType } from '@/models/types';
import type { MessageKey } from '@/i18n';
import { mealLootAmount, mealRarityLuck } from '@/systems/economy/expeditionMeals';
import { BALANCE } from '@/data/balanceConstants';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { rollBonusResources, rollChest, rollChestGuardItem, rollLoot, rollSiegeSpoils } from '@/systems/economy/lootGenerator';
import { isChestGuard } from '@/systems/world/finds';
import { CASTLE_STAGES, castleStageBlurb, castleStageName, castleTierScale, sealRewardFor } from '@/systems/world/castle';
import { stormSealRewardFor, summitItemLevel, summitTierFromId, summitTierScale } from '@/systems/world/summit';
import {
  HEART_LAIR_BOSS_ENCOUNTER, heartChestLevel, heartTierFromId, heartTierScale, winterSealRewardFor,
} from '@/systems/world/heartRefight';
import { siegePowerScale, siegeWeekFromId, tributeDemand } from '@/systems/world/tribute';
import { neutralDepth, threatEncounterSize, threatRewardScale, ThreatBand } from '@/systems/world/threat';
import { Hero } from '@/models/types';
import { rollRewardGem } from '@/systems/economy/gemRewards';
import { contentLevel } from '@/systems/world/contentLevel';
import { levelBand } from '@/systems/world/worldBands';
import { bandRewardScale } from '@/systems/quests/questRewards';
import { fightInk, summitGuaranteedPieces } from '@/systems/economy/jadeveilRewards';
import { aethelredMythicRoll, mythicRollFor } from '@/systems/economy/mythicDrops';
import type { WorldId } from '@/data/worlds';
import type { QuestProgressQuest } from '@/systems/quests/battleQuests';

/**
 * What a finished fight pays, and what a lost one costs.
 *
 * Both lived inside `useEffect`s in `CombatScene`, which made them the only
 * rules in the game with no test — they were already pure functions of the
 * board, the encounter and the party that happened to end in a `setState`.
 * Taking the store reads as arguments is what moves them here.
 */

/** Which run this fight belongs to, if any. `null` is an ordinary encounter. */
export interface CastleRun {
  tier: number;
  stage: number;
}

export interface RewardContext {
  units: CombatUnit[];
  mealTier?: number;
  /** The village buff's multiplier on the fight's gold (`goldMultiplier`); 1 or absent for none. */
  goldMultiplier?: number;
  heroes: Hero[];
  encounterId: string | null;
  threatBand: ThreatBand;
  /**
   * The ground's own band beyond the Empire, which sets its level: a chest's guards are
   * paid a band up (`threatBand`) and stand on this one. Absent, `threatBand`.
   */
  groundBand?: ThreatBand;
  /**
   * How far through that band the ground is — see `threatDepth`.
   *
   * Optional, and omitting it pays the band's flat rate. That is the right
   * answer for every fight with no ground under it, and it is the same default
   * `threatPowerScale` takes, so pay and cost cannot fall out of step by one
   * call site forgetting the argument.
   */
  threatDepth?: number;
  /**
   * Whether the fight was on haunted ground. Same optionality and the same
   * reasoning as `threatDepth`: omitting it pays the corridor rate, which is the
   * right answer for every fight with no ground under it.
   */
  haunted?: boolean;
  castleRun: CastleRun | null;
  /** True on the last stage of a castle run — the chest, not the usual roll. */
  isLastStage: boolean;
  /**
   * What the guarded chest under this fight holds, when `encounterId` is its
   * guards. Paid on top of the fight, and only to the party that won it.
   */
  treasure?: { type: ResourceType; amount: number }[];
  /**
   * Jadeveil: whether Kairen has been killed before (`ascentStore.summit.slain`). A summit
   * win while it is false is the first kill, and the only one whose reward tells the story.
   */
  kairenSlain?: boolean;
  /** Template ids the party owns (`ownedTemplateIds`): Legendary rolls draw what it lacks first. */
  owned?: ReadonlySet<string>;
  /**
   * Which world the fight is in. Omitted is the Empire, which pays exactly what it
   * always did; in Jadeveil the loot draws the range's own gear and the fight pays
   * Spirit Ink (`jadeveilRewards.ts`).
   */
  world?: WorldId;
  /** The bad-luck counter (`mythicStore.kills`): eligible boss kills since the last mythic. */
  mythicKills?: number;
  /** Templates the party holds as a mythic (`heldMythics`), which a boss will not pay again. */
  heldMythics?: Iterable<string>;
}

/**
 * The first kill's story, told once on the victory dialog. Catalog keys, not text: the
 * reward is held until the dialog shows it, and is worded then, in the current language.
 */
export const KAIREN_FIRST_KILL_STORY: readonly MessageKey[] = [
  'combatLog.story.kairen.last',
  'combatLog.story.kairen.orb',
  'combatLog.story.kairen.monks',
];

/**
 * What the victory dialog shows and `applyVictory` pays: a fight's rewards plus
 * the screen-facing fields (the XP lines, the doorway to the next castle stage).
 */
export interface CombatReward {
  kind: 'combat';
  xpPerHero: number;
  xpAwards?: { name: string; amount: number }[];
  gold: number;
  items: Item[];
  gems: GemId[];
  resources: { type: ResourceType; amount: number }[];
  /**
   * Set on a cleared castle stage that is not the last. Its presence is what
   * turns the victory screen from an exit into a doorway — closing it starts the
   * next fight rather than handing back the world map.
   */
  nextStage?: { name: string; blurb: string; healed: number };
  /** Set when a whole run is cleared. `items` is the chest. */
  chest?: { tier: number; sealTier: number };
  /**
   * Jadeveil: Kairen slain at a Storm Seal tier. `items` is the summit's chest, and
   * `sealTier` the Storm Seal it pays (`summit.stormSealRewardFor`). Whether this is the
   * first kill — the one with the story — is decided when it is banked (`ascentStore`).
   */
  summit?: SummitReward;
  /**
   * The Heart of Winter killed: its lair's first kill or a Seal refight. `items` holds the
   * refight's chest from tier 2; every kill pays the next Winter Seal (`heartRefight.ts`).
   */
  winterSeal?: WinterSealReward;
  /** Quest counters this fight moves — `battleQuests.previewVictory`, applied on close. */
  quests?: QuestProgressQuest[];
  /** Jadeveil: Spirit Ink the fight pays (`jadeveilRewards.fightInk`), banked on close. */
  ink?: number;
  /** The bad-luck counter after this fight's boss rolls, banked on close. Absent where there were none. */
  mythicKills?: number;
}

export interface VictoryRewards {
  xpPerHero: number;
  gold: number;
  items: Item[];
  gems: GemId[];
  resources: { type: ResourceType; amount: number }[];
  nextStage?: { name: string; blurb: string; healed: number };
  chest?: { tier: number; sealTier: number };
  summit?: SummitReward;
  winterSeal?: WinterSealReward;
  /** Jadeveil: Spirit Ink, absent everywhere else. */
  ink?: number;
  /** The bad-luck counter after the fight's boss rolls; absent where a boss could not drop a mythic. */
  mythicKills?: number;
}

/** What Kairen's fall pays, beside the chest's items. */
export interface SummitReward {
  tier: number;
  sealTier: number;
  /** The chest's item level (`summit.summitItemLevel`). */
  itemLevel: number;
  /** Set on the first kill: the story beats the dialog tells, as catalog keys. Never on a repeat. */
  story?: MessageKey[];
}

/** What a Heart kill pays beside its items. */
export interface WinterSealReward {
  /** The tier it was killed at: 1 for the lair's own kill and the free refight. */
  tier: number;
  sealTier: number;
  /** The chest's item level, or null when the kill pays no chest (tier 1). */
  itemLevel: number | null;
}

/**
 * The Heart's tier when this fight is a Heart kill that pays a Winter Seal: the refight's own,
 * or 1 for the lair's boss fight (its first kill: a lair's boss trigger is spent on the win).
 */
function heartKillTier(encounterId: string | null): number | null {
  if (encounterId === HEART_LAIR_BOSS_ENCOUNTER) return 1;
  return heartTierFromId(encounterId);
}

/**
 * Rewards follow the same multiplier the enemies were built with.
 *
 * A scaled-up fight paying a base-rate wage is the failure this exists to
 * prevent, and the siege is the sharp case: choosing to fight it is choosing
 * not to pay the rent, so it has to be worth surviving.
 *
 * The depth is passed through for exactly that reason. Deep Contested ground
 * fields enemies at `×1.25` of the band's flat power, so it has to pay `×1.25`
 * of the band's flat wage — an unpaid discount at a band's shallow end would be
 * harmless, but an unpaid *premium* at its far end makes the deepest ground in
 * every band the worst deal on the map.
 */
export function rewardScaleFor(
  castleRun: CastleRun | null,
  encounterId: string | null,
  threatBand: ThreatBand,
  threatDepth: number = neutralDepth(threatBand),
  /**
   * Haunted ground pays what it costs.
   *
   * Same argument as the depth above, one axis over: blighted ground fields
   * enemies at `THREAT_HAUNTED_PREMIUM`, so it has to pay the same premium or
   * leaving the road would be strictly worse than staying on it — and the whole
   * structure of the map is built on leaving the road being the profitable,
   * dangerous choice.
   */
  haunted: boolean = false,
): number {
  if (castleRun) return castleTierScale(castleRun.tier);
  // Jadeveil: Kairen pays by his tier, as he is built by it
  const summitTier = summitTierFromId(encounterId);
  if (summitTier !== null) return summitTierScale(summitTier);
  const siegeWeek = siegeWeekFromId(encounterId ?? '');
  if (siegeWeek !== null) return siegePowerScale(siegeWeek);
  // The Heart's Seal refight pays the lair boss fight's wage, × its tier as it is built
  const heartTier = heartTierFromId(encounterId);
  return threatRewardScale(threatBand, threatDepth, haunted) * (heartTier !== null ? heartTierScale(heartTier) : 1);
}

export function victoryRewards(ctx: RewardContext): VictoryRewards {
  const { units, heroes, encounterId, threatBand, castleRun, isLastStage } = ctx;

  // What a unit another unit made (a briar Thrall, a warband Grunt) is not a second payment:
  // the fight's reward already counts the elite that called it
  const templates = units
    .filter((u) => !u.isPlayer && !u.summonedBy)
    .map((u) => enemyTemplates.find((t) => t.id === u.templateId))
    .filter((t): t is NonNullable<typeof t> => !!t);

  const scale = rewardScaleFor(castleRun, encounterId, threatBand, ctx.threatDepth, ctx.haunted);
  const world = ctx.world ?? 'empire';
  const content = contentLevel({ world, encounterId, threatBand: ctx.groundBand ?? threatBand });
  // A band pays what its five levels cost to climb, and repeatable content pays at the cap it stands at
  const bandScale = content ? bandRewardScale(levelBand(content.level)) : 1;
  let totalXp = 0;
  let totalGold = 0;
  for (const t of templates) {
    totalXp += Math.round(t.xpReward * scale);
    // `ENEMY_GOLD_SCALE` is the one place the templates' authored gold is bent,
    // and it is on gold alone — see the note on the constant. XP is deliberately
    // left at the template's own number.
    totalGold += Math.round(t.goldReward * scale * BALANCE.ENEMY_GOLD_SCALE);
  }
  totalXp = Math.round(totalXp * bandScale);
  totalGold = Math.round(totalGold * bandScale);

  // The late campaign's extra body (`THREAT_LATE_EXTRA_ENEMIES`) is difficulty,
  // not wages: a fight on that ground pays the gold of the roster it had before,
  // or the weekly tribute's budget (`economyProjection.test.ts`) would lose the
  // pressure it is tuned to keep on a slow campaign.
  const siegeWeekForGold = siegeWeekFromId(encounterId ?? '');
  if (!castleRun && siegeWeekForGold === null && summitTierFromId(encounterId) === null && threatBand >= BALANCE.THREAT_LATE_FROM_BAND) {
    const size = threatEncounterSize(threatBand);
    totalGold = Math.round(totalGold * (size - BALANCE.THREAT_LATE_EXTRA_ENEMIES) / size);
  }

  const aliveHeroes = units.filter((u) => u.isPlayer && u.currentHp > 0);
  const xpPerHero = aliveHeroes.length > 0 ? Math.floor(totalXp / aliveHeroes.length) : 0;

  // A cleared run ends at a chest rather than the usual reward roll — 3–5
  // items, each with its own Legendary chance, biased toward paths the party
  // actually walks.
  //
  // The loot is levelled by the same ground its enemies were scaled by — band
  // and depth, or the run's Seal tier — and aimed at who is fighting for it.
  // A siege is fought in the city's streets, whose band is the home ring's: its
  // loot names the party's level instead, or every drop would be band-0 iron
  const siegeWeek = siegeWeekFromId(encounterId ?? '');
  // Jadeveil: Kairen's chest is levelled by its Storm Seal tier, the summit having no ladder of ground
  const summitTier = summitTierFromId(encounterId);
  // The Heart's refight from tier 2 pays a chest, levelled by the ladder (`heartChestLevel`)
  const heartTier = heartTierFromId(encounterId);
  const heartChest = heartTier !== null ? heartChestLevel(heartTier) : null;
  const partyLevel = heroes.length ? Math.round(heroes.reduce((sum, h) => sum + h.level, 0) / heroes.length) : 1;
  const mythicKills = ctx.mythicKills ?? 0;
  const mythic = castleRun && templates.some((t) => t.id === 'aethelred')
    ? aethelredMythicRoll(castleRun.tier, mythicKills, ctx.heldMythics ?? [])
    : mythicRollFor(encounterId, content, mythicKills, ctx.heldMythics ?? []);
  const loot = {
    world,
    party: heroes,
    owned: ctx.owned,
    mythic,
    rarityLuck: mealRarityLuck(ctx.mealTier ?? 0),
    ground: {
      band: threatBand,
      depth: ctx.threatDepth ?? neutralDepth(threatBand),
      castleTier: castleRun?.tier ?? null,
      ...(siegeWeek !== null ? { level: partyLevel } : {}),
      ...(summitTier !== null ? { level: summitItemLevel(summitTier) } : {}),
      ...(heartChest !== null ? { level: heartChest } : {}),
      ...(content ? { content } : {}),
    },
  };
  const chestPaid = isLastStage || summitTier !== null || heartChest !== null;
  const items = chestPaid
    ? [
      ...rollLoot(templates.filter((template) => template.tier === 'boss'), loot),
      ...rollChest(heroes.map((h) => h.masteryPath).filter((p): p is MasteryId => !!p), loot),
    ]
    : rollLoot(templates, loot);
  // A chest's guards leave one more drop than their own pockets — a piece
  // levelled by the ground, its tier rolled on odds that improve with the band.
  if (isChestGuard(encounterId)) {
    const extra = rollChestGuardItem(threatBand, loot);
    if (extra) items.push(extra);
  }
  // Jadeveil: every summit clear pays a collection piece for somebody (`jadeveilRewards.ts`)
  if (summitTier !== null && world === 'jadeveil') items.push(...summitGuaranteedPieces(loot));
  // A won siege leaves the Legion's spoils in the streets (playtest 2026-10-14)
  if (siegeWeek !== null) items.push(...rollSiegeSpoils({ ...loot, rarityLuck: 0 }));
  // Jadeveil's own Spirit tier drops only on its ground (`gemRewards.ts`)
  const gem = rollRewardGem(chestPaid, world);

  // Nothing but the fight's own gold inside the castle: resource nodes are a
  // map activity, and the gauntlet has no map.
  const totalLevel = heroes.reduce((sum, h) => sum + h.level, 0);
  const resources = castleRun ? [] : rollBonusResources(totalLevel, heroes.length);
  // ...and a siege's war chest: a second haul and a share of the refused bill
  if (siegeWeek !== null) {
    resources.push(...rollBonusResources(totalLevel, heroes.length));
    totalGold += Math.max(BALANCE.SIEGE_SPOILS_GOLD_MIN, Math.round(tributeDemand(siegeWeek) * BALANCE.SIEGE_SPOILS_GOLD_SHARE));
  }

  const next = castleRun && !isLastStage ? CASTLE_STAGES[castleRun.stage + 1] : undefined;

  // The chest's own contents arrive already carrying the meal bonus (see
  // `findPayout`), so they join after the fight's loot has had its.
  const treasure = ctx.treasure ?? [];
  const paid = new Map<ResourceType, number>();
  for (const r of resources) {
    paid.set(r.type, (paid.get(r.type) ?? 0) + mealLootAmount(r.amount, ctx.mealTier ?? 0, r.type));
  }
  let treasureGold = 0;
  for (const t of treasure) {
    if (t.type === ResourceType.Gold) treasureGold += t.amount;
    else paid.set(t.type, (paid.get(t.type) ?? 0) + t.amount);
  }

  return {
    xpPerHero,
    gold: Math.round(mealLootAmount(totalGold, ctx.mealTier ?? 0, ResourceType.Gold) * (ctx.goldMultiplier ?? 1)) + treasureGold,
    items,
    gems: gem ? [gem] : [],
    resources: [...paid].map(([type, amount]) => ({ type, amount })),
    nextStage: next && {
      name: castleStageName(next),
      blurb: castleStageBlurb(next),
      healed: Math.round(BALANCE.CASTLE_STAGE_HEAL * 100),
    },
    chest: isLastStage && castleRun
      ? { tier: castleRun.tier, sealTier: sealRewardFor(castleRun.tier) }
      : undefined,
    ...(world === 'jadeveil' ? { ink: fightInk(templates, encounterId) } : {}),
    ...(mythic ? { mythicKills: mythic.kills } : {}),
    summit: summitTier !== null
      ? {
        tier: summitTier, sealTier: stormSealRewardFor(summitTier), itemLevel: summitItemLevel(summitTier),
        ...(!ctx.kairenSlain && { story: [...KAIREN_FIRST_KILL_STORY] }),
      }
      : undefined,
    ...winterSealOf(encounterId),
  };
}

/** The Winter Seal a Heart kill pays, and its chest's level; nothing for any other fight. */
function winterSealOf(encounterId: string | null): { winterSeal?: WinterSealReward } {
  const tier = heartKillTier(encounterId);
  if (tier === null) return {};
  return { winterSeal: { tier, sealTier: winterSealRewardFor(tier), itemLevel: heartChestLevel(tier) } };
}

export interface DefeatPenalties {
  /** Unequipped items about to be lost. Worn gear survives. */
  itemCount: number;
  goldLost: number;
}

/**
 * What a loss takes. Gold is capped at what is actually held, so the screen
 * never promises to take more than exists.
 */
export function defeatPenalties(
  heroes: Hero[],
  bagItems: Item[],
  goldHeld: number,
): DefeatPenalties {
  const equippedIds = new Set(heroes.flatMap((h) => Object.values(h.equipment)));
  const summedLevel = heroes.reduce((sum, h) => sum + h.level, 0);
  const calculated = heroes.length * summedLevel * BALANCE.DEFEAT_GOLD_PER_LEVEL;
  return {
    itemCount: bagItems.filter((i) => !equippedIds.has(i.id)).length,
    goldLost: Math.min(calculated, goldHeld),
  };
}
