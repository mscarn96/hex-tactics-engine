import { NpcId } from './types';
import { NpcDef } from './dialogue';

/**
 * Everybody who can be talked to.
 *
 * Three keep the city; three live out on the map, on a `POIType.Wayside` tile
 * that `mapGenerator` places on ground that suits them. Nothing here knows the
 * difference — a conversation is a conversation, and the only thing that varies
 * is which scene fired the trigger.
 *
 * Each person is written as a small state machine over the quests they hold: not
 * offered yet, offered, in progress, ready to hand in, done. The `requires` on
 * each node is what picks the line, so nobody says "go and kill wolves" to
 * somebody who already did.
 *
 * ### Node order is the whole scheme
 *
 * First match wins, so the file order *is* the priority order, and it runs:
 * **payouts → offers → chases → small talk.** Two rules fall out of that and
 * both are pinned by `dialogue.test.ts`:
 *
 * - `questReady` must sit above `questActive` for the same quest, or a finished
 *   quest can never be handed in — a finished record satisfies both.
 * - The last node of every tree carries **no predicate**. A person you can walk
 *   up to who has nothing to say reads as a broken trigger rather than as a
 *   quiet person.
 *
 * Somebody holding two quests therefore hands one in before offering the next,
 * which is also the order a player wants them in.
 */
export const NPCS: Record<NpcId, NpcDef> = {
  gate_captain: {
    id: 'gate_captain',
    prop: 'npc_captain',
    nodes: [
      {
        id: 'ready',
        requires: { kind: 'questReady', quest: 'wolves_at_the_gate' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'wolves_at_the_gate' } },
        ],
      },
      {
        id: 'ready_trapper',
        requires: { kind: 'questReady', quest: 'a_word_with_the_trapper' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'a_word_with_the_trapper' } },
        ],
      },
      {
        id: 'ready_tithe',
        requires: { kind: 'questReady', quest: 'the_goblin_tithe' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'the_goblin_tithe' } },
        ],
      },
      {
        id: 'ready_warren',
        requires: { kind: 'questReady', quest: 'the_warren_under_the_fields' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'the_warren_under_the_fields' } },
        ],
      },
      {
        id: 'offer_warren',
        requires: { kind: 'questAvailable', quest: 'the_warren_under_the_fields' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'the_warren_under_the_fields' } },
        ],
      },
      {
        id: 'offer',
        requires: { kind: 'questAvailable', quest: 'wolves_at_the_gate' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'wolves_at_the_gate' } },
        ],
      },
      {
        id: 'offer_trapper',
        requires: { kind: 'questAvailable', quest: 'a_word_with_the_trapper' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'a_word_with_the_trapper' } },
        ],
      },
      {
        id: 'offer_tithe',
        requires: { kind: 'questAvailable', quest: 'the_goblin_tithe' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'the_goblin_tithe' } },
        ],
      },
      {
        id: 'waiting',
        requires: { kind: 'questActive', quest: 'wolves_at_the_gate' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'tithe_tally',
        requires: { kind: 'questStage', quest: 'the_goblin_tithe', stage: 1 },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'waiting_tithe',
        requires: { kind: 'questActive', quest: 'the_goblin_tithe' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'waiting_trapper',
        requires: { kind: 'questActive', quest: 'a_word_with_the_trapper' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'waiting_warren',
        requires: { kind: 'questActive', quest: 'the_warren_under_the_fields' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'idle',
        choices: [{ action: { kind: 'end' } }],
      },
    ],
  },

  caravan_master: {
    id: 'caravan_master',
    prop: 'npc_merchant',
    nodes: [
      {
        id: 'ready',
        requires: { kind: 'questReady', quest: 'the_roadwardens' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'the_roadwardens' } },
        ],
      },
      {
        id: 'ready_ford',
        requires: { kind: 'questReady', quest: 'the_ford_at_greywater' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'the_ford_at_greywater' } },
        ],
      },
      {
        id: 'offer_ford',
        requires: { kind: 'questAvailable', quest: 'the_ford_at_greywater' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'the_ford_at_greywater' } },
        ],
      },
      {
        id: 'offer',
        requires: { kind: 'questAvailable', quest: 'the_roadwardens' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'the_roadwardens' } },
        ],
      },
      {
        id: 'stage2',
        requires: { kind: 'questStage', quest: 'the_roadwardens', stage: 1 },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'ford_stage2',
        requires: { kind: 'questStage', quest: 'the_ford_at_greywater', stage: 1 },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'stage1',
        requires: { kind: 'questActive', quest: 'the_roadwardens' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'ford_stage1',
        requires: { kind: 'questActive', quest: 'the_ford_at_greywater' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'idle',
        choices: [{ action: { kind: 'end' } }],
      },
    ],
  },

  archivist: {
    id: 'archivist',
    prop: 'npc_archivist',
    nodes: [
      {
        id: 'ledger_done',
        requires: { kind: 'questReady', quest: 'the_obsidian_ledger' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'the_obsidian_ledger' } },
        ],
      },
      {
        id: 'orb_done',
        roads: true,
        requires: { kind: 'questReady', quest: 'the_red_orb' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'the_red_orb' } },
        ],
      },
      {
        id: 'orb_offer',
        requires: { kind: 'questAvailable', quest: 'the_red_orb' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'the_red_orb' } },
        ],
      },
      {
        id: 'green_done',
        roads: true,
        requires: { kind: 'questReady', quest: 'kairens_orb' },
        choices: [{ action: { kind: 'claimQuest', quest: 'kairens_orb' } }],
      },
      {
        id: 'green_offer',
        requires: { kind: 'questAvailable', quest: 'kairens_orb' },
        choices: [{ action: { kind: 'acceptQuest', quest: 'kairens_orb' } }],
      },
      {
        id: 'ready_supply',
        requires: { kind: 'questReady', quest: 'northern_3_the_supply_trail' },
        choices: [{ action: { kind: 'claimQuest', quest: 'northern_3_the_supply_trail' } }],
      },
      {
        id: 'ready',
        requires: { kind: 'questReady', quest: 'what_the_barrow_keeps' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'what_the_barrow_keeps' } },
        ],
      },
      {
        id: 'ready_workings',
        requires: { kind: 'questReady', quest: 'word_from_the_high_workings' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'word_from_the_high_workings' } },
        ],
      },
      {
        id: 'ready_door',
        requires: { kind: 'questReady', quest: 'the_door_in_the_barrow' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'the_door_in_the_barrow' } },
        ],
      },
      {
        id: 'offer_door',
        requires: { kind: 'questAvailable', quest: 'the_door_in_the_barrow' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'the_door_in_the_barrow' } },
        ],
      },
      {
        id: 'offer_supply',
        requires: { kind: 'questAvailable', quest: 'northern_3_the_supply_trail' },
        choices: [{ action: { kind: 'acceptQuest', quest: 'northern_3_the_supply_trail' } }],
      },
      {
        id: 'offer_workings',
        requires: { kind: 'questAvailable', quest: 'word_from_the_high_workings' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'word_from_the_high_workings' } },
        ],
      },
      {
        id: 'offer',
        requires: { kind: 'questAvailable', quest: 'what_the_barrow_keeps' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'what_the_barrow_keeps' } },
        ],
      },
      {
        id: 'ledger_open',
        requires: { kind: 'questActive', quest: 'the_obsidian_ledger' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'stage2',
        requires: { kind: 'questStage', quest: 'what_the_barrow_keeps', stage: 1 },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'workings_stage2',
        requires: { kind: 'questStage', quest: 'word_from_the_high_workings', stage: 1 },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'stage1',
        requires: { kind: 'questActive', quest: 'what_the_barrow_keeps' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'workings_stage1',
        requires: { kind: 'questActive', quest: 'word_from_the_high_workings' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'door_waiting',
        requires: { kind: 'questActive', quest: 'the_door_in_the_barrow' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'waiting_supply',
        requires: { kind: 'questActive', quest: 'northern_3_the_supply_trail' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'bell_reading',
        requires: { kind: 'questReady', quest: 'the_bell_below' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'green_after',
        roads: true,
        requires: { kind: 'questDone', quest: 'kairens_orb' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'orb_after',
        roads: true,
        requires: { kind: 'questDone', quest: 'the_red_orb' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'idle',
        choices: [{ action: { kind: 'end' } }],
      },
    ],
  },

  /**
   * The first person the game puts outside the walls.
   *
   * He carries the level 3–4 stretch on his own, which is exactly the stretch
   * that used to be forty identical wolves — so the captain sends you to him at
   * level 2 rather than leaving him to be stumbled into.
   */
  huntsman: {
    id: 'huntsman',
    // His own figure: the fur hat, the pale mantle and the pack on one shoulder.
    prop: 'npc_huntsman',
    nodes: [
      {
        id: 'ready_trapline',
        requires: { kind: 'questReady', quest: 'northern_1_the_silent_trapline' },
        choices: [{ action: { kind: 'claimQuest', quest: 'northern_1_the_silent_trapline' } }],
      },
      {
        id: 'ready_camp',
        requires: { kind: 'questReady', quest: 'northern_2_the_frozen_camp' },
        choices: [{ action: { kind: 'claimQuest', quest: 'northern_2_the_frozen_camp' } }],
      },
      {
        id: 'ready_snares',
        requires: { kind: 'questReady', quest: 'snares_and_stakes' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'snares_and_stakes' } },
        ],
      },
      {
        id: 'ready_thicket',
        requires: { kind: 'questReady', quest: 'the_thing_in_the_thicket' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'the_thing_in_the_thicket' } },
        ],
      },
      {
        id: 'offer_trapline',
        requires: { kind: 'questAvailable', quest: 'northern_1_the_silent_trapline' },
        choices: [{ action: { kind: 'acceptQuest', quest: 'northern_1_the_silent_trapline' } }],
      },
      {
        id: 'offer_camp',
        requires: { kind: 'questAvailable', quest: 'northern_2_the_frozen_camp' },
        choices: [{ action: { kind: 'acceptQuest', quest: 'northern_2_the_frozen_camp' } }],
      },
      {
        id: 'offer_snares',
        requires: { kind: 'questAvailable', quest: 'snares_and_stakes' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'snares_and_stakes' } },
        ],
      },
      {
        id: 'offer_thicket',
        requires: { kind: 'questAvailable', quest: 'the_thing_in_the_thicket' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'the_thing_in_the_thicket' } },
        ],
      },
      {
        id: 'sent_by_aldris',
        requires: { kind: 'questReady', quest: 'a_word_with_the_trapper' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'snares_waiting',
        requires: { kind: 'questActive', quest: 'snares_and_stakes' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'thicket_waiting',
        requires: { kind: 'questActive', quest: 'the_thing_in_the_thicket' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'waiting_trapline',
        requires: { kind: 'questActive', quest: 'northern_1_the_silent_trapline' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'camp_papers',
        requires: { kind: 'questStage', quest: 'northern_2_the_frozen_camp', stage: 1 },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'waiting_camp',
        requires: { kind: 'questActive', quest: 'northern_2_the_frozen_camp' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'cold_news',
        requires: { kind: 'questReady', quest: 'what_the_barrow_keeps' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'idle',
        choices: [{ action: { kind: 'end' } }],
      },
    ],
  },

  fen_hermit: {
    id: 'fen_hermit',
    // Her own figure: the drooping hood, the pale shawl and the lamp she reads
    // the water by at night.
    prop: 'npc_fen_hermit',
    nodes: [
      {
        id: 'ready_hoofprints',
        requires: { kind: 'questReady', quest: 'hoofprints_in_the_mud' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'hoofprints_in_the_mud' } },
        ],
      },
      {
        id: 'offer_hoofprints',
        requires: { kind: 'questAvailable', quest: 'hoofprints_in_the_mud' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'hoofprints_in_the_mud' } },
        ],
      },
      {
        id: 'ford_told',
        requires: { kind: 'questStage', quest: 'the_ford_at_greywater', stage: 1 },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'hoofprints_camp',
        requires: { kind: 'questStage', quest: 'hoofprints_in_the_mud', stage: 2 },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'hoofprints_drummers',
        requires: { kind: 'questStage', quest: 'hoofprints_in_the_mud', stage: 1 },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'hoofprints_waiting',
        requires: { kind: 'questActive', quest: 'hoofprints_in_the_mud' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'idle',
        choices: [{ action: { kind: 'end' } }],
      },
    ],
  },

  prospector: {
    id: 'prospector',
    // His own figure: the brimmed hat, the grey beard and the digging bar.
    prop: 'npc_prospector',
    nodes: [
      {
        id: 'ready_claim',
        requires: { kind: 'questReady', quest: 'a_claim_worth_keeping' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'a_claim_worth_keeping' } },
        ],
      },
      {
        id: 'ready_bell',
        requires: { kind: 'questReady', quest: 'the_bell_below' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'the_bell_below' } },
        ],
      },
      {
        id: 'ready_cut',
        requires: { kind: 'questReady', quest: 'the_overseers_cut' },
        choices: [{ action: { kind: 'claimQuest', quest: 'the_overseers_cut' } }],
      },
      {
        id: 'ready_hollow',
        requires: { kind: 'questReady', quest: 'what_sleeps_in_the_hollow' },
        choices: [
          { action: { kind: 'claimQuest', quest: 'what_sleeps_in_the_hollow' } },
        ],
      },
      {
        id: 'offer_hollow',
        requires: { kind: 'questAvailable', quest: 'what_sleeps_in_the_hollow' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'what_sleeps_in_the_hollow' } },
        ],
      },
      {
        id: 'offer_claim',
        requires: { kind: 'questAvailable', quest: 'a_claim_worth_keeping' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'a_claim_worth_keeping' } },
        ],
      },
      {
        id: 'offer_bell',
        requires: { kind: 'questAvailable', quest: 'the_bell_below' },
        choices: [
          { action: { kind: 'acceptQuest', quest: 'the_bell_below' } },
        ],
      },
      {
        id: 'offer_cut',
        requires: { kind: 'questAvailable', quest: 'the_overseers_cut' },
        choices: [{ action: { kind: 'acceptQuest', quest: 'the_overseers_cut' } }],
      },
      {
        id: 'workings_found',
        requires: { kind: 'questStage', quest: 'word_from_the_high_workings', stage: 1 },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'claim_waiting',
        requires: { kind: 'questActive', quest: 'a_claim_worth_keeping' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'bell_waiting',
        requires: { kind: 'questActive', quest: 'the_bell_below' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'cut_waiting',
        requires: { kind: 'questActive', quest: 'the_overseers_cut' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'hollow_waiting',
        requires: { kind: 'questActive', quest: 'what_sleeps_in_the_hollow' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'idle',
        choices: [{ action: { kind: 'end' } }],
      },
    ],
  },
  // ── Jadeveil's foothill camp ─────────────────────────────────────────────
  // Standing inside the camp (`camp: 'jadeveil'`, `locations/jadeveil/foothillCamp.ts`),
  // never on a world-map hex.

  exile_monk: {
    id: 'exile_monk',
    camp: 'jadeveil',
    // His own figure: the slate travelling robe, the beads and the staff with
    // his bundle tied to it — never the Order's cream and red.
    prop: 'npc_exile_monk',
    nodes: [
      {
        id: 'ready_green',
        requires: { kind: 'questReady', quest: 'the_green_orb' },
        choices: [{ action: { kind: 'claimQuest', quest: 'the_green_orb' } }],
      },
      {
        id: 'ready_hosts',
        requires: { kind: 'questReady', quest: 'the_hosts_road' },
        choices: [{ action: { kind: 'claimQuest', quest: 'the_hosts_road' } }],
      },
      {
        id: 'ready_hall',
        requires: { kind: 'questReady', quest: 'the_silent_hall' },
        choices: [{ action: { kind: 'claimQuest', quest: 'the_silent_hall' } }],
      },
      {
        id: 'ready_teaching',
        requires: { kind: 'questReady', quest: 'the_teaching_turned' },
        choices: [{ action: { kind: 'claimQuest', quest: 'the_teaching_turned' } }],
      },
      {
        id: 'ready_mossgate',
        requires: { kind: 'questReady', quest: 'the_mossgate' },
        choices: [{ action: { kind: 'claimQuest', quest: 'the_mossgate' } }],
      },
      {
        id: 'offer_mossgate',
        requires: { kind: 'questAvailable', quest: 'the_mossgate' },
        choices: [{ action: { kind: 'acceptQuest', quest: 'the_mossgate' } }],
      },
      {
        id: 'offer_teaching',
        requires: { kind: 'questAvailable', quest: 'the_teaching_turned' },
        choices: [{ action: { kind: 'acceptQuest', quest: 'the_teaching_turned' } }],
      },
      {
        id: 'offer_hall',
        requires: { kind: 'questAvailable', quest: 'the_silent_hall' },
        choices: [{ action: { kind: 'acceptQuest', quest: 'the_silent_hall' } }],
      },
      {
        id: 'offer_hosts',
        requires: { kind: 'questAvailable', quest: 'the_hosts_road' },
        choices: [{ action: { kind: 'acceptQuest', quest: 'the_hosts_road' } }],
      },
      {
        id: 'chase_hall',
        requires: { kind: 'questActive', quest: 'the_silent_hall' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'chase_mossgate',
        requires: { kind: 'questActive', quest: 'the_mossgate' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'chase_teaching',
        requires: { kind: 'questActive', quest: 'the_teaching_turned' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'chase_hosts',
        requires: { kind: 'questActive', quest: 'the_hosts_road' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        // Jadeveil's grand quest handed in: Kairen is dead, and the orb goes on to Ivane
        id: 'summit',
        requires: { kind: 'questReady', quest: 'the_cloud_crown' },
        choices: [{ action: { kind: 'claimQuest', quest: 'the_cloud_crown' } }],
      },
      {
        id: 'chase_summit',
        requires: { kind: 'questActive', quest: 'the_cloud_crown' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'after_summit',
        requires: { kind: 'questDone', quest: 'the_cloud_crown' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'idle',
        choices: [{ action: { kind: 'end' } }],
      },
    ],
  },

  lantern_keeper: {
    id: 'lantern_keeper',
    camp: 'jadeveil',
    // Her own figure: the indigo kimono and the lantern on its pole.
    prop: 'npc_lantern_keeper',
    nodes: [
      {
        id: 'ready_silk',
        requires: { kind: 'questReady', quest: 'the_silk_hollow' },
        choices: [{ action: { kind: 'claimQuest', quest: 'the_silk_hollow' } }],
      },
      {
        id: 'ready_lanterns',
        requires: { kind: 'questReady', quest: 'lanterns_in_the_bamboo' },
        choices: [{ action: { kind: 'claimQuest', quest: 'lanterns_in_the_bamboo' } }],
      },
      {
        id: 'before_toma',
        requires: { kind: 'not', of: { kind: 'questDone', quest: 'the_green_orb' } },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'offer_lanterns',
        requires: { kind: 'questAvailable', quest: 'lanterns_in_the_bamboo' },
        choices: [{ action: { kind: 'acceptQuest', quest: 'lanterns_in_the_bamboo' } }],
      },
      {
        id: 'offer_silk',
        requires: { kind: 'questAvailable', quest: 'the_silk_hollow' },
        choices: [{ action: { kind: 'acceptQuest', quest: 'the_silk_hollow' } }],
      },
      {
        id: 'chase_silk',
        requires: { kind: 'questActive', quest: 'the_silk_hollow' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'chase_lanterns',
        requires: { kind: 'questActive', quest: 'lanterns_in_the_bamboo' },
        choices: [{ action: { kind: 'end' } }],
      },
      {
        id: 'idle',
        choices: [{ action: { kind: 'end' } }],
      },
    ],
  },
};

export const NPC_IDS = Object.keys(NPCS) as NpcId[];

/**
 * The figure a person stands in, by id — `null` for anything that is not an NPC.
 *
 * Exists so `data/display/terrainDisplay.ts` can put a wayside's occupant on the
 * map without importing the whole quest layer to do it, and so `MapTile.npcId`
 * can stay a plain `string` (see the note on that field).
 */
export function npcPropKey(id: string | undefined): string | null {
  if (!id) return null;
  return NPCS[id as NpcId]?.prop ?? null;
}
