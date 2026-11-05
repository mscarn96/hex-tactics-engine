import type { WorldId } from '@/data/worlds';
import { EnemyTemplateId, ItemSlot, POIType, Rarity, ResourceType } from '@/models/types';
import type { QuestSiteId } from './sites';
import { LocationId } from '@/locations/types';

/**
 * Quests, as data.
 *
 * Pure TypeScript with no React Native imports, the same rule `src/locations/`
 * and `src/voxel/` follow — the whole point being that a quest's rules can be
 * exercised in a node test without a screen anywhere near them.
 *
 * The shape is deliberately small. A quest is a list of stages, a stage is a
 * list of objectives, and an objective is a counter that goes up when the game
 * reports something. Everything else — who gives it, what it says, what it pays
 * — hangs off that spine rather than being part of it.
 */

export type QuestId =
  // The city's own, oldest first
  | 'wolves_at_the_gate'
  | 'a_word_with_the_trapper'
  | 'the_goblin_tithe'
  | 'the_ford_at_greywater'
  | 'the_roadwardens'
  | 'word_from_the_high_workings'
  | 'what_the_barrow_keeps'
  // The people out on the map
  | 'snares_and_stakes'
  | 'the_thing_in_the_thicket'
  | 'hoofprints_in_the_mud'
  | 'a_claim_worth_keeping'
  | 'the_bell_below'
  | 'the_overseers_cut'
  // The three lairs, each a contract rather than a search. A lair door is one
  // hex of 4,900 and nothing on the map says which one, so without these the
  // only way to find a lair is to walk into it.
  | 'the_warren_under_the_fields'
  | 'the_door_in_the_barrow'
  | 'what_sleeps_in_the_hollow'
  | 'northern_1_the_silent_trapline'
  | 'northern_2_the_frozen_camp'
  | 'northern_3_the_supply_trail'
  | 'the_obsidian_ledger'
  // After the Emperor: the five orbs
  | 'the_red_orb'
  // Jadeveil: the green orb's road, from the foothill camp up the shrine chain
  | 'the_green_orb'
  | 'the_mossgate'
  | 'lanterns_in_the_bamboo'
  | 'the_silk_hollow'
  | 'the_teaching_turned'
  | 'the_silent_hall'
  | 'the_hosts_road'
  // Jadeveil's grand quest: Kairen on the Cloud Crown, then his orb to Ivane
  | 'the_cloud_crown'
  | 'kairens_orb';

/**
 * Everybody who can be talked to.
 *
 * The first three keep the city; the last three live on the map, on a
 * `POIType.Wayside` tile placed by `mapGenerator`. Nothing in the dialogue
 * layer distinguishes them — a conversation is a conversation, and the only
 * difference is which scene the trigger fired in.
 */
export type NpcId =
  | 'gate_captain'
  | 'caravan_master'
  | 'archivist'
  | 'huntsman'
  | 'fen_hermit'
  | 'prospector'
  // Jadeveil's foothill camp (`NpcDef.camp`)
  | 'exile_monk'
  | 'lantern_keeper';

/**
 * One counter.
 *
 * `kill` takes a *list* of templates rather than one, so "four wolves" can mean
 * any wolf. Requiring an exact template would make a quest fail quietly the
 * moment the encounter generator fielded the wrong size of the same animal.
 *
 * **No objective carries a label.** What the log, the tracker, the notices and
 * the combat screens call an objective is derived from what it counts — see
 * `systems/quests/objectiveLabel.ts` — so it always names the enemy, resource,
 * place or person the game itself uses. The only words chosen here are ids
 * whose text lives in the `quests` catalog (`src/quests/questText.ts`):
 *  - `group` on a kill over more than two templates ("Wolves"), which must be
 *    a faction name or the plural of a word every template name shares;
 *  - `verb` on the person and place kinds ("Report to", "Examine"), which only
 *    replaces the default verb — the name after it is still derived.
 */
export type Objective =
  | { kind: 'kill'; templates: EnemyTemplateId[]; count: number; group?: ObjectiveGroup }
  | { kind: 'clearPoi'; poi: POIType; site?: QuestSiteId; count: number; verb?: ObjectiveVerb }
  | { kind: 'investigate'; site: QuestSiteId; verb?: ObjectiveVerb }
  | { kind: 'reach'; location: LocationId; verb?: ObjectiveVerb }
  | { kind: 'talk'; npc: NpcId; verb?: ObjectiveVerb }
  | { kind: 'collect'; resource: ResourceType; count: number }
  /**
   * A Jadeveil shrine held (`systems/world/shrines.ts`): a stock like `collect`,
   * read off the chain, so a shrine claimed before the quest was taken counts.
   */
  | { kind: 'shrine'; index: number };

/** What a kill counter over several templates counts: `quests.group.<id>.name`. */
export type ObjectiveGroup = 'wolves' | 'goblins' | 'brigands' | 'yokai' | 'fallenOrder';

/**
 * An objective's line pattern, `quests.verb.<id>.label`. The first five are the
 * defaults each kind falls back to; the rest are authored on one objective.
 */
export type ObjectiveVerb =
  | 'speakWith' | 'reach' | 'search' | 'clear' | 'claim'
  | 'find' | 'returnTo' | 'examineStakes' | 'examineBell' | 'showSeal' | 'askNorthernNews'
  | 'reportTracks' | 'driveJarls' | 'bringCampPapers' | 'recoverManifest' | 'breakConvoy'
  | 'bringManifest' | 'giveRedOrb' | 'giveGreenOrb' | 'breakDelveCrew' | 'readHoofprints' | 'scatterRaiders';

/** What the game reports. Mirrors `Objective` so matching is a shape comparison. */
export type QuestEvent =
  | { kind: 'kill'; template: EnemyTemplateId; count?: number }
  | { kind: 'clearPoi'; poi: POIType; site?: string }
  | { kind: 'investigate'; site: string }
  | { kind: 'reach'; location: LocationId }
  | { kind: 'talk'; npc: NpcId }
  | { kind: 'collect'; resource: ResourceType; count: number }
  | { kind: 'shrine'; index: number };

/** Its log line, shown while it is the current one, is `questStageSummary(quest, index)`. */
export interface QuestStage {
  objectives: Objective[];
}

/**
 * A question about the state of the world, answerable from the quest log.
 *
 * Used for two things: when a quest becomes offerable, and which line an NPC
 * says. One vocabulary for both, because "has the player done this yet" is the
 * same question whether it gates content or picks a greeting.
 *
 * `partyLevel` is the **summed** level of the party, not one hero's — a solo
 * level-8 hero and four level-2 heroes are the same amount of game played, and
 * gating on a single hero would lock a wide party out of its own content.
 */
export type QuestPredicate =
  /**
   * `over`, set on a gate in an expansion world, states `total` over that world's band
   * (`bandGateBase`), so the gate moves with the band it took. Read it with `partyLevelGate`.
   */
  | { kind: 'partyLevel'; total: number; over?: WorldId }
  | { kind: 'questDone'; quest: QuestId }
  /** Taken on and not yet claimed. */
  | { kind: 'questActive'; quest: QuestId }
  /** Active, and sitting on this stage index. */
  | { kind: 'questStage'; quest: QuestId; stage: number }
  /** Every stage done, reward not collected. */
  | { kind: 'questReady'; quest: QuestId }
  /** Offerable right now: gate passed, not running, not finished. */
  | { kind: 'questAvailable'; quest: QuestId }
  /** Boss lairs beaten. The only gate that measures places rather than levels. */
  | { kind: 'lairsCleared'; count: number }
  | { kind: 'not'; of: QuestPredicate }
  | { kind: 'all'; of: QuestPredicate[] };

/**
 * A piece of gear described by what it *is* rather than by which one.
 *
 * Declared here rather than imported from `systems/economy/questGear`, because
 * `src/quests/` is pure content and imports no system — the same rule
 * `src/locations/` and `src/voxel/` follow. The resolver imports this.
 */
export interface GearReward {
  slot: ItemSlot;
  rarity: Rarity;
}

export interface QuestRewards {
  xp?: number;
  gold?: number;
  resources?: Partial<Record<ResourceType, number>>;
  /** Item template ids, minted on claim. For a *named* piece. */
  items?: string[];
  /**
   * A piece of gear stated as a **shape** — a slot and a rarity — and resolved
   * against the party at claim time.
   *
   * The reason it is not four more entries in `items`: non-common gear is
   * class-locked, so a named template is dead weight to three quarters of the
   * roster. Spreading one reward per class across the campaign was the best a
   * fixed id could do, and it still meant most quests handed a player something
   * for a hero they had not recruited.
   *
   * `systems/economy/questGear.ts` picks the piece from the **masteries the
   * party has actually chosen**, reading each path's priorities off the stat
   * bonuses its own tree grants — so a Bulwark is handed the defensive cuirass
   * and a Berserker the one that spends its budget on crit, and neither answer
   * is written down anywhere to go stale. Legality goes through `canEquip`,
   * which is what makes a weapon reward respect the mastery weapon lock.
   */
  gear?: GearReward;
  /**
   * Sends a hero the party does not have to the tavern.
   *
   * Deliberately not a specific class: the player picks one of four to start
   * with, so naming a class here would make one quest in every save pay out
   * nothing. Resolved at claim time against who is actually missing.
   */
  unlocksHero?: true;
}

/** Its title and one-line summary are `questTitle(id)` and `questSummary(id)` (`questText.ts`). */
export interface Quest {
  id: QuestId;
  giver: NpcId;
  unlockedBy?: QuestPredicate;
  stages: QuestStage[];
  rewards: QuestRewards;
  /**
   * Taken on the moment its gate opens, rather than offered.
   *
   * For the Grand Quest only. The player does not choose to be at war with the
   * Empire — the tribute has been arriving every week since the first one — so
   * an "Accept" button on it would be a lie about who is deciding.
   */
  autoAccept?: true;
}
