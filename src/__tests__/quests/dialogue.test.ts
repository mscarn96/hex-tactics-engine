import { NPCS, NPC_IDS } from '@/quests/npcData';
import { dialogueLine, npcName, npcWhere } from '@/quests/npcText';
import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { QuestId } from '@/quests/types';
import { npcById, nodeById, openingNode, visibleChoices } from '@/systems/quests/dialogue';
import { QuestContext, QuestRecord, questById, satisfies, startRecord } from '@/systems/quests/quests';

/**
 * Dialogue trees, walked without a screen.
 *
 * The failure mode these guard is quiet rather than loud: an NPC whose nodes are
 * ordered wrong does not crash, it just says the wrong thing forever — offering
 * a quest you already finished, or having nothing to say at all.
 */

const ctx = (
  partyLevel: number,
  completed: QuestId[] = [],
  active: Partial<Record<QuestId, QuestRecord>> = {},
  lairsCleared = 0,
): QuestContext => ({ partyLevel, completed, active, lairsCleared, held: {}, shrines: 0 });

/** A record parked on the last stage with everything done. */
function finished(id: QuestId): QuestRecord {
  const quest = questById(id);
  return { stage: quest.stages.length, progress: [] };
}

describe('every NPC', () => {
  /**
   * Playtest 2026-10-14: an offer's second answer ("Find someone else") did
   * nothing the ✕ does not, so it read as a choice that was not one. An offer
   * is its agreement alone; leaving without taking it is the ✕.
   */
  it('offers a quest with its agreement alone, no decline beside it', () => {
    const declines = NPC_IDS.flatMap((id) => NPCS[id].nodes
      .filter((n) => n.choices.some((c) => c.action?.kind === 'acceptQuest'))
      .filter((n) => n.choices.length > 1)
      .map((n) => `${id}:${n.id}`));
    expect(declines).toEqual([]);
  });

  /**
   * The rule the whole first-match-wins scheme rests on. Without a trailing
   * unconditional node an NPC can be walked up to in some state and have nothing
   * to say, which reads as a broken trigger rather than as a quiet person.
   */
  it('ends its tree with a line that always applies', () => {
    const silent = NPC_IDS.filter((id) => {
      const nodes = NPCS[id].nodes;
      return nodes.length === 0 || nodes[nodes.length - 1].requires !== undefined;
    });
    expect(silent).toEqual([]);
  });

  it('always has something to say, in any state of the game', () => {
    const states: QuestContext[] = [
      ctx(1),
      ctx(40),
      ctx(40, QUEST_IDS),
      ...QUEST_IDS.map((id) => ctx(40, [], { [id]: startRecord(questById(id)) })),
      ...QUEST_IDS.map((id) => ctx(40, [], { [id]: finished(id) })),
    ];
    const mute = NPC_IDS.flatMap((id) =>
      states
        .filter((state) => !dialogueLine(id, openingNode(NPCS[id], state).id).trim())
        .map(() => id),
    );
    expect(mute).toEqual([]);
  });

  it('offers a way out of every node it can reach', () => {
    const stuck = NPC_IDS.flatMap((id) =>
      NPCS[id].nodes.filter((n) => n.choices.length === 0).map((n) => `${id}:${n.id}`),
    );
    expect(stuck).toEqual([]);
  });

  it('never points a choice at a node that does not exist', () => {
    const dangling = NPC_IDS.flatMap((id) =>
      NPCS[id].nodes.flatMap((n) =>
        n.choices
          .filter((c) => c.goto && !nodeById(NPCS[id], c.goto))
          .map((c) => `${id}:${n.id} → ${c.goto}`),
      ),
    );
    expect(dangling).toEqual([]);
  });

  it('gives every node a distinct id', () => {
    const clashes = NPC_IDS.filter((id) => {
      const ids = NPCS[id].nodes.map((n) => n.id);
      return ids.length !== new Set(ids).size;
    });
    expect(clashes).toEqual([]);
  });

  it('has a prop to stand in', () => {
    const faceless = NPC_IDS.filter((id) => !NPCS[id].prop || !npcName(id).trim());
    expect(faceless).toEqual([]);
  });

  /**
   * The generalisation of the gate captain's one ordering rule below, applied
   * to every tree at once.
   *
   * A finished record satisfies `questActive` as well as `questReady`, so a
   * chase line written above a payout line means a finished quest can never be
   * handed in — and since the log stopped paying anything out, that is now a
   * quest that can never be finished at all. One NPC holding three quests
   * makes this easy to get wrong by adding a node in the wrong place, which is
   * exactly why it is measured rather than remembered.
   */
  it('puts every payout line above the chase line for the same quest', () => {
    const inverted: string[] = [];
    for (const npcId of NPC_IDS) {
      const nodes = NPCS[npcId].nodes;
      for (const quest of QUEST_IDS) {
        const ready = nodes.findIndex(
          (n) => n.requires?.kind === 'questReady' && n.requires.quest === quest,
        );
        const chase = nodes.findIndex(
          (n) =>
            (n.requires?.kind === 'questActive' || n.requires?.kind === 'questStage') &&
            n.requires.quest === quest,
        );
        if (ready >= 0 && chase >= 0 && chase < ready) inverted.push(`${npcId}:${quest}`);
      }
    }
    expect(inverted).toEqual([]);
  });

  /**
   * The log points at people now instead of handing quests over, so a person
   * with no `where` is a name the player walks the map looking for.
   */
  it('says where it can be found', () => {
    const placeless = NPC_IDS.filter((id) => !npcWhere(id).trim());
    expect(placeless).toEqual([]);
  });
});

describe('every quest has a giver who can give it', () => {
  it('names a giver that exists', () => {
    const orphans = QUEST_IDS.filter((id) => !NPCS[QUESTS[id].giver]);
    expect(orphans).toEqual([]);
  });

  /**
   * A quest reachable only through the log is half-built content: the giver is
   * authored, placed and says nothing about the thing they are for.
   */
  it('offers it somewhere in the giver’s tree', () => {
    const missing = QUEST_IDS.filter((id) => {
      // An auto-accepted quest is never handed over — see `Quest.autoAccept`.
      // The Grand Quest arrives because the world changed, not because somebody
      // asked, so requiring an offer line for it would be requiring a lie.
      if (QUESTS[id].autoAccept) return false;
      const npc = NPCS[QUESTS[id].giver];
      return !npc.nodes.some((n) =>
        n.choices.some((c) => c.action?.kind === 'acceptQuest' && c.action.quest === id),
      );
    });
    expect(missing).toEqual([]);
  });

  it('takes it back in when it is done', () => {
    const missing = QUEST_IDS.filter((id) => {
      const npc = NPCS[QUESTS[id].giver];
      return !npc.nodes.some((n) =>
        n.choices.some((c) => c.action?.kind === 'claimQuest' && c.action.quest === id),
      );
    });
    expect(missing).toEqual([]);
  });
});

describe('the gate captain, through a whole quest', () => {
  const npc = npcById('gate_captain');
  const quest: QuestId = 'wolves_at_the_gate';

  it('opens by offering, when nothing has happened yet', () => {
    const node = openingNode(npc, ctx(1));
    expect(node.id).toBe('offer');
    expect(visibleChoices(node, ctx(1)).some((c) => c.action?.kind === 'acceptQuest')).toBe(true);
  });

  it('chases while the quest is in flight, and does not re-offer it', () => {
    const state = ctx(1, [], { [quest]: startRecord(questById(quest)) });
    expect(openingNode(npc, state).id).toBe('waiting');
  });

  it('pays out once every stage is done', () => {
    const state = ctx(1, [], { [quest]: finished(quest) });
    const node = openingNode(npc, state);
    expect(node.id).toBe('ready');
    expect(visibleChoices(node, state).some((c) => c.action?.kind === 'claimQuest')).toBe(true);
  });

  it('falls back to small talk afterwards', () => {
    expect(openingNode(npc, ctx(1, [quest])).id).toBe('idle');
  });

  // The one ordering bug that matters: `questReady` must be checked before the
  // broader `questActive`, or a finished quest can never be handed in
  it('prefers the payout line over the chase line', () => {
    const state = ctx(1, [], { [quest]: finished(quest) });
    expect(satisfies({ kind: 'questActive', quest }, state)).toBe(true);
    expect(satisfies({ kind: 'questReady', quest }, state)).toBe(true);
    expect(npc.nodes.findIndex((n) => n.id === 'ready'))
      .toBeLessThan(npc.nodes.findIndex((n) => n.id === 'waiting'));
  });
});

describe('the predicate vocabulary', () => {
  const quest: QuestId = 'the_roadwardens';

  it('reads the stage a quest is sitting on', () => {
    const state = ctx(20, [], { [quest]: { stage: 1, progress: [0, 0] } });
    expect(satisfies({ kind: 'questStage', quest, stage: 1 }, state)).toBe(true);
    expect(satisfies({ kind: 'questStage', quest, stage: 0 }, state)).toBe(false);
  });

  it('reports a quest unavailable once it is running', () => {
    const state = ctx(20, [], { [quest]: startRecord(questById(quest)) });
    expect(satisfies({ kind: 'questAvailable', quest }, state)).toBe(false);
  });

  it('composes with not and all', () => {
    const state = ctx(20, ['wolves_at_the_gate']);
    expect(satisfies({ kind: 'not', of: { kind: 'questDone', quest } }, state)).toBe(true);
    expect(
      satisfies(
        {
          kind: 'all',
          of: [
            { kind: 'questDone', quest: 'wolves_at_the_gate' },
            { kind: 'partyLevel', total: 20 },
          ],
        },
        state,
      ),
    ).toBe(true);
  });
});
