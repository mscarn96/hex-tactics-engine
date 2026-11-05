import { DialogueAction } from '@/quests/dialogue';
import { acceptQuest, claimQuest, reportTalk, syncQuests } from '@/systems/quests/questEvents';
import { QUESTS } from '@/quests/questData';
import { LevelUpEvent } from '@/stores/partyStore';
import { trackQuestOnMap } from '@/systems/quests/questTracking';
import { isLairContract } from '@/systems/quests/campaignGoal';

/**
 * Turning a chosen line into something that happened.
 *
 * The whole reason `DialogueAction` exists: the conversation names an intent,
 * and it is applied here through the *same* functions the rest of the game uses
 * — `acceptQuest`, `claimQuest`. Nothing in the dialogue layer writes to a
 * store directly, so a quest accepted at an NPC and one accepted from the log
 * are the same event, not two implementations that have to agree.
 *
 * This layer only *names* what happened. Showing a reward, opening a door and
 * deciding what is on screen next all stay with the caller.
 */

/**
 * What an action did to the conversation it was chosen in.
 *
 * A boolean answered this for a long time, and a boolean can only say "the talk
 * is over" — so handing one quest back to a person holding three *ended the
 * conversation*, and the other two took a walk away and a walk back each. Four
 * of the six NPCs hold two or more. The distinction the boolean had no room for
 * is between an action that finished the business and one that only changed the
 * world the speaker is answering about.
 */
export type DialogueContinuation =
  /** Nothing further here. Whatever the conversation banked is delivered now. */
  | 'end'
  /**
   * The world moved under the conversation. The speaker has a new opening line
   * and the player has not said they are leaving, so the talk stays open and
   * re-derives what it is asking about.
   */
  | 'continue';

export interface DialogueOutcome {
  conversation: DialogueContinuation;
  /** Reward lines to show, if a quest was handed in. */
  rewardLines?: string[];
  levelUps?: LevelUpEvent[];
}

export function applyDialogueAction(action: DialogueAction): DialogueOutcome {
  switch (action.kind) {
    case 'acceptQuest':
      acceptQuest(action.quest);
      // A lair contract is the road the campaign is on, so taking it tracks it and turns
      // the map's guide to it. A separate "track on map" answer at its chase line confused
      // players (playtest 2026-10-22); a side errand still leaves the tracked quest alone.
      if (isLairContract(action.quest)) trackQuestOnMap(action.quest);
      // Taken on in a conversation with its giver, so a first stage that asks
      // the player to talk to that giver is answered by this very talk — the
      // red orb is handed over in the breath it is asked for, not on a walk away
      // and back. A talk to the giver was already reported when the conversation
      // opened, so nothing else in the log moves twice.
      reportTalk(QUESTS[action.quest].giver);
      // A `collect` objective reads the bag rather than counting pickups, so a
      // quest taken on while the party is already carrying what it asks for is
      // finished the instant it is accepted — and nothing *reports* that, which
      // makes the sweep the only thing that can move the stage on. Without it
      // the giver's very next line is the chase line for a quest that could be
      // handed back in the same breath, which is exactly the state the player
      // would then have to walk away and return to clear.
      syncQuests();
      return { conversation: 'continue' };

    case 'claimQuest': {
      const result = claimQuest(action.quest);
      return {
        conversation: 'continue',
        rewardLines: result.lines,
        levelUps: result.levelUps,
      };
    }

    case 'end':
      return { conversation: 'end' };
  }
}
