import { NpcId } from '@/quests/types';
import { DialogueChoice, DialogueNode, NpcDef } from '@/quests/dialogue';
import { NPCS } from '@/quests/npcData';
import { QuestContext, satisfies, questById } from '@/systems/quests/quests';

/**
 * Choosing what an NPC says. Pure, and therefore testable without a screen.
 *
 * Applying what a choice *does* lives in `systems/dialogueActions.ts`, because
 * that touches four stores and this touches none.
 */

export function npcById(id: NpcId): NpcDef {
  return NPCS[id];
}

/**
 * The line this person opens with, given the state of the world.
 *
 * First match wins, scanning in author order — which is why the most specific
 * state is written first and the last node carries no predicate.
 */
export function openingNode(npc: NpcDef, ctx: QuestContext): DialogueNode {
  const match = npc.nodes.find((node) => !node.requires || satisfies(node.requires, ctx));
  // Authoring guarantees a trailing unconditional node, and `dialogue.test.ts`
  // enforces it. Falling back to the last node rather than throwing means a bad
  // tree is a dull conversation in a shipped build, not a crash.
  return match ?? npc.nodes[npc.nodes.length - 1];
}

export function nodeById(npc: NpcDef, id: string): DialogueNode | undefined {
  return npc.nodes.find((n) => n.id === id);
}

/**
 * Choices the player may actually pick.
 *
 * Hidden rather than disabled: a greyed-out line still tells you a quest exists
 * and what it wants, which is information the state of the world is supposed to
 * be withholding.
 */
export function visibleChoices(node: DialogueNode, ctx: QuestContext): DialogueChoice[] {
  return node.choices.filter((c) => !c.requires || satisfies(c.requires, ctx));
}

/**
 * Whether this person is worth crossing the square for, and why.
 *
 * Derived from the line they would actually open with, rather than from a
 * separate scan of the quest log — so the mark over an NPC's head and the words
 * out of their mouth can never disagree. If the opening node has a choice that
 * hands out a quest, that is an offer; if it has one that closes a quest, that
 * is a turn-in. A held quest's current step done by talking to them is `talk`,
 * drawn in the offer's gold.
 */
export type NpcInterest = 'offer' | 'turnIn' | 'talk' | null;

export function npcInterest(npc: NpcDef, ctx: QuestContext): NpcInterest {
  const choices = visibleChoices(openingNode(npc, ctx), ctx);
  if (choices.some((c) => c.action?.kind === 'claimQuest')) return 'turnIn';
  if (Object.entries(ctx.active).some(([id, record]) => {
    if (!record) return false;
    return questById(id as import('@/quests/types').QuestId).stages[record.stage]?.objectives.some((o, i) =>
      o.kind === 'talk' && o.npc === npc.id && (record.progress[i] ?? 0) < 1);
  })) return 'talk';
  if (choices.some((c) => c.action?.kind === 'acceptQuest')) return 'offer';
  return null;
}
