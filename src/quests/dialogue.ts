import { NpcId, QuestId, QuestPredicate } from './types';
import type { WorldId } from '@/data/worlds';

/**
 * Branching, quest-state-aware conversation.
 *
 * **Dialogue never mutates game state.** A choice emits a `DialogueAction`, and
 * the same handlers the rest of the game already uses apply it. That single rule
 * is what keeps this a content format instead of a second, parallel way for
 * things to happen — the alternative is a narrative engine with its own copy of
 * every rule, drifting out of step with the real one.
 *
 * A conversation is only a conversation: it has no action that opens a
 * building. The market and the library had "About the market…" shortcuts here,
 * and the talk screen was cut back to just the talk (PT-11) — every building
 * has its own door in the city square.
 */

export type DialogueAction =
  | { kind: 'acceptQuest'; quest: QuestId }
  | { kind: 'claimQuest'; quest: QuestId }
  | { kind: 'end' };

/**
 * A line of dialogue and its answers carry no words: they live in the `npcs`
 * catalog under `<npcId>.<nodeId>.text` and `<npcId>.<nodeId>.choice.<n>`, read
 * through `dialogueLine` and `dialogueChoice` (`src/quests/npcText.ts`).
 */
export interface DialogueChoice {
  /** Node to move to. Omitted with an action means the action ends the talk. */
  goto?: string;
  action?: DialogueAction;
  /** Hidden entirely when this fails — not greyed out. */
  requires?: QuestPredicate;
}

export interface DialogueNode {
  id: string;
  /**
   * When this node may be the *opening* line.
   *
   * Nodes are scanned in order and the first match wins, so the most specific
   * state goes first and the last node should have no predicate at all —
   * otherwise an NPC can be walked up to and have nothing to say, which reads as
   * a broken trigger rather than as a quiet person.
   */
  requires?: QuestPredicate;
  /** Whether the speaker also says which roads are open (`ivaneRoadsLine`): Ivane, when an orb changes hands. */
  roads?: true;
  choices: DialogueChoice[];
}

/**
 * A person who can be talked to. Their name, title, `where` (a phrase that
 * finishes a sentence) and `place` (a short label) live in the `npcs` catalog,
 * read through `npcName`, `npcTitle`, `npcWhere` and `npcPlace`
 * (`src/quests/npcText.ts`).
 */
export interface NpcDef {
  id: NpcId;
  /** Key into `WORLD_PROP_DEFS`. */
  prop: string;
  /**
   * The world whose camp they live at. They stand on a hex inside the camp
   * (`locations/jadeveil/foothillCamp.ts`), and the guide points at the camp's
   * gate on the world map.
   */
  camp?: WorldId;
  nodes: DialogueNode[];
}
