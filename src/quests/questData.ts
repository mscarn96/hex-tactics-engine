import { POIType, Rarity, ResourceType } from '@/models/types';
import { Quest, QuestId, QuestPredicate } from './types';

/**
 * A Jadeveil gate, summed levels over its band's base: `-20` is a full party at level 15 in
 * band 1 (summed 60), and at level 20 in band 2.
 */
const afterOnRange = (over: number, quest: QuestId): QuestPredicate => ({
  kind: 'all',
  of: [{ kind: 'partyLevel', total: over, over: 'jadeveil' }, { kind: 'questDone', quest }],
});

/** Strength remains a floor; recruitment alone cannot skip the campaign. */
const after = (total: number, quest: QuestId, lairs = 0): QuestPredicate => ({
  kind: 'all',
  of: [
    { kind: 'partyLevel', total },
    { kind: 'questDone', quest },
    ...(lairs ? [{ kind: 'lairsCleared' as const, count: lairs }] : []),
  ],
});

/**
 * Everything the land asks of you.
 *
 * Offers combine summed party level with completed story contracts and lairs.
 * The opening hunt and trapper introduction can overlap; after recruitment,
 * completing a lead opens its next branch rather than the new hero opening
 * every level-gated offer at once. There is no cap on accepted quests.
 * See the private project notes for the audited route and exact gates.
 *
 * Objectives lean on things the game already reports — kills by template, POIs
 * cleared, resources held, people spoken to — so no quest needs a bespoke hook
 * to make progress. Anything that would need one is a sign the objective is
 * wrong.
 *
 * `collect` is the one objective that is a **stock**: it asks what is in the bag
 * when you walk back up to the giver, not what passed through it. So a delivery
 * can be finished with resources mined before the job was taken, and the counts
 * below are sized against `BALANCE.EXPLORATION_FINDS.RESOURCE_AMOUNTS` — one
 * wood find is 2–4, one iron find 1–3, one crystal find 1–2, and a week deals
 * dozens of them (see `systems/world/finds.ts`).
 *
 * ### Gear rewards are a *shape*, resolved against the party
 *
 * `QuestRewards.items` existed and was paid out from the day it was written, and
 * no quest ever used it — so a contract paid gold, XP and sometimes a place at
 * the table, and never once a thing you could wear.
 *
 * Four quests carry one now, and none of them names an item. They state a slot
 * and a rarity, and `systems/economy/questGear.ts` picks the piece **from the
 * masteries the party has actually chosen** — reading each path's priorities off
 * the stat bonuses its own tree grants, so a Bulwark is handed the cuirass that
 * spends its budget on health and defence and a Berserker the one that spends it
 * on crit.
 *
 * Naming templates was the first attempt and it does not work. Non-common gear
 * is class-locked, so a named piece is dead weight to three quarters of the
 * roster; the best a fixed id can manage is one reward per class spread across
 * the campaign, which still means most contracts hand a player something for a
 * hero they have not recruited. A shape has no such problem: whoever is standing
 * there when it is claimed is who it is for.
 *
 * The level floors stay at **8, 9, 10 and 12** and the lateness still matters, for a
 * different reason now — a path is chosen at `MASTERY_UNLOCK_LEVEL`, so a reward
 * asked to read the party's masteries wants a party that has some.
 *
 * The four slots are chosen to exercise different rules rather than for variety:
 * two armour pieces (class lock only), a **main hand** (which goes through the
 * mastery *weapon* lock, so a Skirmisher is never handed a bow), and a neck
 * piece (whose class comes from the motif rather than the form). Rare
 * throughout; legendary set pieces are excluded by construction, because the
 * forge and the dungeon chest are their only two routes.
 */
export const QUESTS: Record<QuestId, Quest> = {
  wolves_at_the_gate: {
    id: 'wolves_at_the_gate',
    giver: 'gate_captain',
    // No gate: this is the first thing a solo level-1 hero can be pointed at,
    // and it asks for exactly what they were going to do anyway
    stages: [
      {
        objectives: [
          {
            kind: 'kill',
            templates: ['wolf_pup', 'wolf', 'dire_wolf'],
            count: 5,
            group: 'wolves',
          },
        ],
      },
    ],
    rewards: { xp: 60, gold: 120, unlocksHero: true },
  },

  /**
   * The introduction to the idea that there are people out there.
   *
   * One objective, no fight, and it can be finished on the walk the player was
   * already taking. What it actually does is put the huntsman's camp on the
   * guide arrow — the two quests he gives are the whole of the level 3–4 stretch
   * and they are unreachable content until somebody says his name.
   */
  a_word_with_the_trapper: {
    id: 'a_word_with_the_trapper',
    giver: 'gate_captain',
    unlockedBy: { kind: 'partyLevel', total: 2 },
    stages: [
      {
        objectives: [
          { kind: 'talk', npc: 'huntsman' },
        ],
      },
    ],
    rewards: { xp: 40, gold: 60 },
  },

  snares_and_stakes: {
    id: 'snares_and_stakes',
    giver: 'huntsman',
    unlockedBy: after(3, 'a_word_with_the_trapper'),
    stages: [
      {
        objectives: [
          { kind: 'collect', resource: ResourceType.Wood, count: 8 },
        ],
      },
    ],
    rewards: { xp: 70, gold: 90 },
  },

  the_thing_in_the_thicket: {
    id: 'the_thing_in_the_thicket',
    giver: 'huntsman',
    unlockedBy: after(4, 'snares_and_stakes'),
    stages: [
      {
        objectives: [{ kind: 'clearPoi', poi: POIType.QuestSite, site: 'quest_thicket', count: 1 }],
      },
    ],
    rewards: { xp: 180, gold: 240 },
  },

  the_goblin_tithe: {
    id: 'the_goblin_tithe',
    giver: 'gate_captain',
    unlockedBy: after(5, 'wolves_at_the_gate'),
    stages: [
      {
        objectives: [
          {
            kind: 'kill',
            templates: ['goblin_whelp', 'goblin', 'goblin_spearthrower'],
            count: 6,
            group: 'goblins',
          },
        ],
      },
      /**
       * Orcs, not the shaman the prose wants.
       *
       * `SHAPES` has no `caster` slot below band 2, so a stage asking for one
       * named greenskin caster is a stage that cannot be finished until the
       * party is walking ground two bands above the one this quest opens on. A
       * `front` template is delivered by the band-1 patrol, which is exactly
       * where a summed-level-5 party is — the narrative bends and the counter
       * does not.
       */
      {
        objectives: [
          { kind: 'kill', templates: ['orc_grunt'], count: 2 },
        ],
      },
    ],
    rewards: { xp: 130, gold: 170 },
  },

  /**
   * The second "go and meet somebody", and the pattern is deliberate: a caravan
   * master who needs a ford open does not know the fen, so she sends you to
   * somebody who does. The hermit's own two quests hang off this one.
   */
  the_ford_at_greywater: {
    id: 'the_ford_at_greywater',
    giver: 'caravan_master',
    unlockedBy: after(6, 'the_goblin_tithe'),
    stages: [
      {
        objectives: [{ kind: 'talk', npc: 'fen_hermit' }],
      },
      {
        objectives: [{ kind: 'clearPoi', poi: POIType.QuestSite, site: 'quest_greywater', count: 1 }],
      },
    ],
    rewards: { xp: 160, gold: 210 },
  },

  /**
   * The first of the three lair contracts.
   *
   * ### Why a lair needs a quest at all
   *
   * A lair door is one hex of 4,900, placed by `mapGenerator` from a shuffled
   * pool with nothing but "≥ 8 hexes from the city" constraining it, and nothing
   * on the map names it before you are standing on it. So the whole of the game's
   * middle — three bosses, three party slots, the gate on the Grand Quest — was
   * content the player found by accident or did not find at all. A quest turns
   * that into an address the guide arrow can hold.
   *
   * ### The single stage is load-bearing
   *
   * Both objectives sit on **one stage**, and that is what holds the arrow on
   * the door. `trackedQuestTarget` reads the current stage alone, and a stage
   * advances only once every objective in it is met — so the `reach` stays live
   * beside the unfinished kill, and the guide keeps pointing at the mouth of the
   * lair for the whole contract, including after the party has walked in once,
   * been driven out, and needs to find it again. Split into two stages, the
   * record would advance past the `reach` the moment the party stepped inside
   * and the arrow would go out exactly when the run began.
   *
   * `reach` is written first for legibility — it is the order the player does
   * them in — and *not* because the resolver requires it: a `kill` resolves to
   * no tile and falls through to the next objective rather than blocking it, so
   * the reverse order would still find the door. (`talk` is the one kind that
   * genuinely short-circuits, returning the city as its own fallback.) The
   * distinction is worth keeping straight, because a comment claiming a
   * mechanism that is not there is how the *next* quest gets written around a
   * rule that was never enforcing anything.
   *
   * ### They pay gear and supplies alongside xp and gold
   *
   * No `unlocksHero` on any of the three. The lair *itself* pays the party slot
   * (`BALANCE.PARTY_SLOTS_BASE` plus one per lair) and hero openings are the
   * recruitment curve, which is already the length it was meant to be — a lair
   * quest paying either would double-pay one of them for the same walk.
   *
   * Gates sit just under each lair's own `unlockLevel` in `locations/lairs.ts`
   * (8 / 22 / 39, the Warren, the Hollow, the ice lair), so the contract
   * arrives as the door becomes openable rather than pointing at one that
   * refuses to open.
   */
  the_warren_under_the_fields: {
    id: 'the_warren_under_the_fields',
    giver: 'gate_captain',
    unlockedBy: after(7, 'the_goblin_tithe'),
    stages: [
      {
        objectives: [
          { kind: 'reach', location: 'lair_warren', verb: 'find' },
          { kind: 'kill', templates: ['troll_chieftain'], count: 1 },
        ],
      },
    ],
    rewards: { xp: 240, gold: 360, gear: { slot: 'mainHand', rarity: Rarity.Rare } },
  },

  the_roadwardens: {
    id: 'the_roadwardens',
    giver: 'caravan_master',
    unlockedBy: after(8, 'the_warren_under_the_fields', 1),
    stages: [
      {
        objectives: [
          { kind: 'clearPoi', poi: POIType.QuestSite, count: 1 },
        ],
      },
      {
        objectives: [
          {
            kind: 'kill',
            templates: ['footpad', 'bandit', 'brigand_archer'],
            count: 6,
            group: 'brigands',
          },
          {
            kind: 'kill',
            templates: ['brigand_captain'],
            count: 1,
          },
        ],
      },
    ],
    rewards: { xp: 180, gold: 300, unlocksHero: true, gear: { slot: 'chest', rarity: Rarity.Rare } },
  },

  /**
   * The fen hermit's own errand, and the first the Thunder Herd is in (playtest
   * 2026-10-23, PT-07: it replaced What the Reeds Hide). Herd raiders are riding
   * down off the plains into the fen hamlets for hides to stretch their storm
   * drums. The trail is read in the fen; the drummers are hunted on the Herd's
   * own plains and highlands; the camp they ride out of sits on the plains
   * nearest her.
   */
  hoofprints_in_the_mud: {
    id: 'hoofprints_in_the_mud',
    giver: 'fen_hermit',
    unlockedBy: after(9, 'the_ford_at_greywater', 1),
    stages: [
      {
        objectives: [{ kind: 'investigate', site: 'quest_trampled_hamlet', verb: 'readHoofprints' }],
      },
      {
        objectives: [{ kind: 'kill', templates: ['storm_drummer'], count: 2 }],
      },
      {
        objectives: [{ kind: 'clearPoi', poi: POIType.QuestSite, site: 'quest_raider_camp', count: 1, verb: 'scatterRaiders' }],
      },
    ],
    rewards: { xp: 210, gold: 260, gear: { slot: 'chest', rarity: Rarity.Rare } },
  },

  /**
   * The third introduction, and the last one. The archivist reads the Empire's
   * ledgers, so she is the one who notices that a mine stopped filing returns —
   * which is a librarian's way of finding a man on a mountain.
   */
  word_from_the_high_workings: {
    id: 'word_from_the_high_workings',
    giver: 'archivist',
    unlockedBy: after(10, 'the_roadwardens', 1),
    stages: [
      {
        objectives: [
          { kind: 'talk', npc: 'prospector' },
        ],
      },
      {
        objectives: [
          { kind: 'reach', location: 'city', verb: 'returnTo' },
        ],
      },
    ],
    rewards: { xp: 230, gold: 280, gear: { slot: 'mainHand', rarity: Rarity.Rare } },
  },

  a_claim_worth_keeping: {
    id: 'a_claim_worth_keeping',
    giver: 'prospector',
    unlockedBy: after(12, 'word_from_the_high_workings'),
    stages: [
      {
        objectives: [{ kind: 'investigate', site: 'quest_claim', verb: 'examineStakes' }],
      },
      {
        objectives: [{ kind: 'collect', resource: ResourceType.Iron, count: 6 }],
      },
    ],
    rewards: { xp: 300, gold: 380, gear: { slot: 'neck', rarity: Rarity.Rare } },
  },

  the_bell_below: {
    id: 'the_bell_below',
    giver: 'prospector',
    unlockedBy: after(14, 'a_claim_worth_keeping'),
    stages: [
      {
        objectives: [{ kind: 'investigate', site: 'quest_bell', verb: 'examineBell' }],
      },
      {
        objectives: [{ kind: 'talk', npc: 'archivist', verb: 'showSeal' }],
      },
    ],
    rewards: { xp: 220, gold: 280 },
  },

  /**
   * The prospector chain's fight (PT-08: "one more POI quest in the mountains
   * with the delves, between the troll and the dragon").
   *
   * Ferrow's first three contracts are a talk, a reading and a clue; this is
   * where the Delve he has been arguing with finally stand in front of the
   * party. The bell was the drain's pressure warning, and the Delve are cutting
   * down toward that drain from above the old shaft — an overseer driving a
   * crew in shifts (`encounterWaves.ts`). The overseer's stamped pay tally is
   * the chain's answer: the Empire paid the Delve to keep the seam closed.
   *
   * Opens on the Bell's report and the first lair, like What the Cold Keeps,
   * at summed level 17 — one above it, since floors are staggered — and before
   * the Hollow's 20. Nothing waits on it: the
   * Hollow still needs only the High Workings, so it stays a side contract.
   */
  the_overseers_cut: {
    id: 'the_overseers_cut',
    giver: 'prospector',
    unlockedBy: after(17, 'the_bell_below', 1),
    stages: [
      {
        objectives: [{ kind: 'clearPoi', poi: POIType.QuestSite, site: 'quest_overseers_cut', count: 1, verb: 'breakDelveCrew' }],
      },
    ],
    rewards: { xp: 340, gold: 420, gear: { slot: 'head', rarity: Rarity.Rare } },
  },

  /**
   * The ice lair's lead, three contracts before its door, and the recruitment
   * curve's third hero.
   *
   * The Heart of Winter sealed the north, and the cold it keeps has held the
   * old dead asleep for longer than the Empire has kept books. The Legion is
   * draining it, the cold is going out of the ground, and the dead are walking.
   * Ivane works out why from the Empire's own ledgers — which is the answer
   * `the_door_in_the_barrow` sends the party north with. The crystal she reads
   * by grows in the frozen north (`mapGenerator`'s crystal pass), so the walk
   * for it is the party's first look at where the story goes.
   *
   * The id is the old Barrow quest's, kept with the lair's own (`lair_barrow`):
   * an id is never shown, and the quest art is filed under it.
   */
  what_the_barrow_keeps: {
    id: 'what_the_barrow_keeps',
    giver: 'archivist',
    unlockedBy: after(16, 'the_bell_below', 1),
    stages: [
      {
        objectives: [{ kind: 'collect', resource: ResourceType.Crystal, count: 6 }],
      },
      {
        objectives: [{ kind: 'talk', npc: 'huntsman', verb: 'askNorthernNews' }],
      },
    ],
    rewards: { xp: 320, gold: 480, unlocksHero: true },
  },

  /**
   * The second lair contract — see `the_warren_under_the_fields` for the rules
   * all three follow. The Hollow moved here from the end of the campaign when
   * the ice lair took its place, and its door moved onto red rock with it.
   */
  what_sleeps_in_the_hollow: {
    id: 'what_sleeps_in_the_hollow',
    // The hint is for the player who is about to commit: the fight asks for an answer to
    // Skyfire, and a party without one may have to come back with it
    giver: 'prospector',
    unlockedBy: after(20, 'word_from_the_high_workings', 1),
    stages: [
      {
        objectives: [
          { kind: 'reach', location: 'lair_wyrm', verb: 'find' },
          { kind: 'kill', templates: ['dragon'], count: 1 },
        ],
      },
    ],
    rewards: { xp: 650, gold: 950, gear: { slot: 'chest', rarity: Rarity.Epic } },
  },

  /**
   * The last lair contract, and the last thing asked before the castle.
   *
   * Deliberately *not* the same quest as `what_the_barrow_keeps` above, which
   * is a crystal delivery and northern-news contract and is finished out on open
   * ground. This one is about one glacier with a door in it. They share a giver
   * and a cause and nothing else, which is why they do not share a name. The
   * id is the old Barrow contract's, for that quest's reason.
   */
  the_door_in_the_barrow: {
    id: 'the_door_in_the_barrow',
    giver: 'archivist',
    unlockedBy: { kind: 'all', of: [after(36, 'what_the_barrow_keeps', 2), { kind: 'questDone', quest: 'northern_3_the_supply_trail' }] },
    stages: [
      {
        objectives: [
          { kind: 'reach', location: 'lair_barrow', verb: 'find' },
          { kind: 'kill', templates: ['heart_of_winter'], count: 1 },
        ],
      },
    ],
    rewards: { xp: 950, gold: 1450, gear: { slot: 'mainHand', rarity: Rarity.Epic }, resources: { [ResourceType.Crystal]: 8 } },
  },

  northern_1_the_silent_trapline: {
    id: 'northern_1_the_silent_trapline',
    giver: 'huntsman',
    unlockedBy: after(18, 'what_the_barrow_keeps', 1),
    stages: [
      {
        objectives: [{ kind: 'investigate', site: 'quest_trapline' }],
      },
      {
        objectives: [{ kind: 'talk', npc: 'huntsman', verb: 'reportTracks' }],
      },
    ],
    rewards: { xp: 260, gold: 280, resources: { [ResourceType.Wood]: 8 } },
  },
  northern_2_the_frozen_camp: {
    id: 'northern_2_the_frozen_camp',
    giver: 'huntsman',
    unlockedBy: after(22, 'northern_1_the_silent_trapline', 1),
    stages: [
      {
        objectives: [
          { kind: 'investigate', site: 'quest_frozen_camp' },
          { kind: 'clearPoi', poi: POIType.QuestSite, site: 'quest_frozen_camp', count: 1, verb: 'driveJarls' },
        ],
      },
      {
        objectives: [{ kind: 'talk', npc: 'huntsman', verb: 'bringCampPapers' }],
      },
    ],
    rewards: { xp: 420, gold: 500, gear: { slot: 'feet', rarity: Rarity.Epic } },
  },
  northern_3_the_supply_trail: {
    id: 'northern_3_the_supply_trail',
    giver: 'archivist',
    unlockedBy: after(28, 'northern_2_the_frozen_camp', 2),
    stages: [
      {
        objectives: [
          { kind: 'investigate', site: 'quest_supply_trail', verb: 'recoverManifest' },
          { kind: 'clearPoi', poi: POIType.QuestSite, site: 'quest_supply_trail', count: 1, verb: 'breakConvoy' },
        ],
      },
      {
        objectives: [{ kind: 'talk', npc: 'archivist', verb: 'bringManifest' }],
      },
    ],
    rewards: { xp: 500, gold: 650, resources: { [ResourceType.Crystal]: 6 } },
  },

  /**
   * The Grand Quest.
   *
   * Added to the log the moment the third lair falls, without being offered:
   * the player did not choose to be at war with the Empire — the tribute has
   * been arriving every week since the first one — so an Accept button would be
   * a lie about who is deciding. What changes at three lairs is not the war, it
   * is that the party is finally wide enough to go and finish it.
   *
   * Its giver is the archivist, who has been reading the Empire's own ledgers
   * throughout. She has no line that hands it over, because nobody hands it over.
   */
  the_obsidian_ledger: {
    id: 'the_obsidian_ledger',
    giver: 'archivist',
    unlockedBy: { kind: 'lairsCleared', count: 3 },
    autoAccept: true,
    stages: [
      {
        objectives: [
          { kind: 'reach', location: 'castle' },
        ],
      },
      {
        objectives: [
          { kind: 'kill', templates: ['aethelred'], count: 1 },
        ],
      },
    ],
    rewards: { xp: 1200, gold: 2000 },
  },

  /**
   * The first of the five orbs (the private project notes#the-five-orbs--story-spine`).
   *
   * Aethelred's red orb comes out of the castle with the party, and the ledger
   * hand-in is where Ivane sees it. She offers to take it the moment the book
   * is closed, in the same conversation: accepting hands it over (the talk is
   * already happening — `dialogueActions` reports it), and the payout node is
   * where she names four more and points at the green one in Jadeveil. Every
   * campaign gets the story; only an owner's gate opens on it, and the gate
   * waits on the Emperor rather than on this quest, so no post-Emperor save is
   * kept from the road by having skipped her.
   *
   * Her line leaves room for the late reveal that she kept them all: she says
   * they must be destroyed, never that she has destroyed one.
   */
  the_red_orb: {
    id: 'the_red_orb',
    giver: 'archivist',
    unlockedBy: { kind: 'questDone', quest: 'the_obsidian_ledger' },
    stages: [
      {
        objectives: [{ kind: 'talk', npc: 'archivist', verb: 'giveRedOrb' }],
      },
    ],
    rewards: { xp: 600 },
  },

  // ── Jadeveil: the green orb's road ────────────────────────────────────────
  //
  // Handed out and in at the foothill camp (`NpcDef.camp`), so every hand-in is
  // made standing in Jadeveil and provokes the range (+15 wrath, `claimQuest`).
  // The chain follows the shrines: each claim opens the band the next quest is
  // in, and the two lair contracts open with the band their door stands in.
  // See the private project notes, *Jadeveil*.

  /** Ivane's lead, carried to the camp: finding the monk she wrote to. */
  the_green_orb: {
    id: 'the_green_orb',
    giver: 'exile_monk',
    unlockedBy: { kind: 'questDone', quest: 'the_red_orb' },
    autoAccept: true,
    stages: [
      {
        objectives: [{ kind: 'talk', npc: 'exile_monk', verb: 'find' }],
      },
    ],
    rewards: { xp: 400 },
  },

  /** The first shrine: the Yokai's, and the pass into the terraces. */
  the_mossgate: {
    id: 'the_mossgate',
    giver: 'exile_monk',
    unlockedBy: afterOnRange(-20, 'the_green_orb'),
    stages: [
      {
        objectives: [{ kind: 'shrine', index: 1 }],
      },
    ],
    rewards: { xp: 700, gold: 600 },
  },

  /** Okiku's errand: the bamboo's yokai, who have been putting out her lamps. */
  lanterns_in_the_bamboo: {
    id: 'lanterns_in_the_bamboo',
    giver: 'lantern_keeper',
    unlockedBy: afterOnRange(-18, 'the_green_orb'),
    stages: [
      {
        objectives: [
          { kind: 'kill', templates: ['kodama', 'kappa', 'tanuki', 'onibi', 'kitsune'], count: 8, group: 'yokai' },
        ],
      },
    ],
    rewards: { xp: 800, gold: 700, gear: { slot: 'feet', rarity: Rarity.Epic } },
  },

  /** The Yokai lair, opened with the Mossgate's pass. */
  the_silk_hollow: {
    id: 'the_silk_hollow',
    giver: 'lantern_keeper',
    unlockedBy: afterOnRange(0, 'the_mossgate'),
    stages: [
      {
        objectives: [
          { kind: 'reach', location: 'lair_silk', verb: 'find' },
          { kind: 'kill', templates: ['jorogumo'], count: 1 },
        ],
      },
    ],
    rewards: { xp: 1100, gold: 1200, gear: { slot: 'head', rarity: Rarity.Epic } },
  },

  /** The Fallen Order, and the second shrine. */
  the_teaching_turned: {
    id: 'the_teaching_turned',
    giver: 'exile_monk',
    unlockedBy: afterOnRange(-10, 'the_mossgate'),
    stages: [
      {
        objectives: [
          {
            kind: 'kill',
            templates: ['order_novice', 'beetle_warden', 'mantis_adept', 'chain_sickle_monk', 'firefly_chanter', 'fallen_abbot', 'bell_keeper'],
            count: 6,
            group: 'fallenOrder',
          },
        ],
      },
      {
        objectives: [{ kind: 'shrine', index: 2 }],
      },
    ],
    rewards: { xp: 1200, gold: 1100, gear: { slot: 'legs', rarity: Rarity.Epic } },
  },

  /** The Fallen Order's lair, opened with the second shrine's pass. */
  the_silent_hall: {
    id: 'the_silent_hall',
    giver: 'exile_monk',
    unlockedBy: afterOnRange(8, 'the_teaching_turned'),
    stages: [
      {
        objectives: [
          { kind: 'reach', location: 'lair_hall', verb: 'find' },
          { kind: 'kill', templates: ['last_lesson'], count: 1 },
        ],
      },
    ],
    rewards: { xp: 1400, gold: 1500, gear: { slot: 'chest', rarity: Rarity.Epic } },
  },

  /** The Draconic Host's two shrines, and the way to the summit. */
  the_hosts_road: {
    id: 'the_hosts_road',
    giver: 'exile_monk',
    unlockedBy: afterOnRange(4, 'the_teaching_turned'),
    stages: [
      {
        objectives: [{ kind: 'shrine', index: 3 }],
      },
      {
        objectives: [{ kind: 'shrine', index: 4 }],
      },
    ],
    rewards: { xp: 1600, gold: 1800 },
  },

  /**
   * Jadeveil's grand quest, the green orb's (the private project notes). Lets itself
   * in once the Host's road is reported: the summit is open, and what stands between the
   * party and Kairen is the storm. The kill is counted only while this is in hand, so a
   * Storm Seal refight never reports it twice; Tōma's `summit` node hands it in.
   */
  the_cloud_crown: {
    id: 'the_cloud_crown',
    giver: 'exile_monk',
    unlockedBy: { kind: 'questDone', quest: 'the_hosts_road' },
    autoAccept: true,
    stages: [
      {
        objectives: [{ kind: 'kill', templates: ['kairen'], count: 1 }],
      },
    ],
    rewards: { xp: 2400, gold: 2500 },
  },

  /**
   * The second of the five orbs, carried home. Ivane offers to take it as the red one was
   * taken — accepting in that conversation hands it over (`dialogueActions` reports the
   * talk), and her payout closes Jadeveil's grand quest. Her line keeps the room the
   * finale needs: she says it must be destroyed, never that she destroyed one.
   */
  kairens_orb: {
    id: 'kairens_orb',
    giver: 'archivist',
    unlockedBy: { kind: 'questDone', quest: 'the_cloud_crown' },
    stages: [
      {
        objectives: [{ kind: 'talk', npc: 'archivist', verb: 'giveGreenOrb' }],
      },
    ],
    rewards: { xp: 900 },
  },
};

export const QUEST_IDS = Object.keys(QUESTS) as QuestId[];
