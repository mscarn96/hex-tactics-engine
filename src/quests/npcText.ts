import { entryText } from '@/i18n/dataText';
import type { NpcId } from './types';
import type { DialogueChoice, DialogueNode } from './dialogue';

/**
 * Display text for the people who can be talked to, read from the `npcs`
 * catalog when shown (see the private project notes, "Data tables keep
 * ids"). A component that calls these must call `useT()` or `useLocale()`.
 */

/** "Captain Aldris". */
export const npcName = (id: NpcId) => entryText('npcs', id, 'name');

/** One line under the name while talking — who this person is. */
export const npcTitle = (id: NpcId) => entryText('npcs', id, 'title');

/**
 * Where to find them, in the player's own words — "at the city gate", "in the
 * reeds south of the fords".
 *
 * Load-bearing since the log stopped handing quests out. A rumour you cannot
 * act on from the log is only useful if it says who to go and see, and the
 * three people who live on the map are somewhere the player has very likely
 * not walked yet.
 */
export const npcWhere = (id: NpcId) => entryText('npcs', id, 'where');

/**
 * The same place as a name short enough for a label — "City gate", "The reeds".
 *
 * The quest log's rows read "place · person", and `where` is a phrase built to
 * finish a sentence ("Speak to Rell Ashcroft — at his camp on the forest edge,
 * east of the city"), which is a whole row on its own. Authored beside it
 * rather than cut out of it, because no rule shortens "where the ground gives"
 * into a name.
 */
export const npcPlace = (id: NpcId) => entryText('npcs', id, 'place');

/** What a person says at one node of their conversation. */
export const dialogueLine = (npc: NpcId, node: string) => entryText('npcs', npc, `${node}.text`);

/**
 * The words of one answer. Keyed by the answer's index among its node's
 * authored choices, so it is the same whichever choices a quest state hides.
 */
export function dialogueChoice(npc: NpcId, node: DialogueNode, choice: DialogueChoice): string {
  return entryText('npcs', npc, `${node.id}.choice.${node.choices.indexOf(choice)}`);
}
