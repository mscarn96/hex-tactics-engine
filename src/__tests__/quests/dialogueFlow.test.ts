import { Hero, HeroClass, ResourceType } from '@/models/types';
import { DialogueAction, DialogueChoice } from '@/quests/dialogue';
import { NpcId } from '@/quests/types';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { npcById, nodeById, openingNode, visibleChoices } from '@/systems/quests/dialogue';
import { DialogueOutcome, applyDialogueAction } from '@/systems/quests/dialogueActions';
import { currentQuestContext } from '@/systems/quests/questEvents';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useCityStore } from '@/stores/cityStore';
import { useQuestStore } from '@/stores/questStore';
import { QUESTS } from '@/quests/questData';
import { NPCS } from '@/quests/npcData';
import { dialogueChoice, dialogueLine } from '@/quests/npcText';
import { templateName } from '@/data/templates/unitText';

/**
 * A conversation that survives its own hand-offs.
 *
 * Handing a quest back used to end the talk, because the outcome had one
 * boolean and it could only say "close". Four of the six NPCs hold two quests
 * or more and the trees are written payouts → offers → chases, so the person
 * who had just been paid had the next contract queued behind a modal that was
 * already gone: the player walked away and walked back, once per quest.
 *
 * Driven through the pure halves — `openingNode` / `visibleChoices` decide what
 * is said, `applyDialogueAction` decides what it did — so this runs in the node
 * environment with no React Native anywhere near it. `DialogueModal.pick` is a
 * transcription of `step` below; the rules are here, the pixels are there.
 */

const TEMPLATE = heroTemplates[0];

/**
 * One hero at level 10, which is the summed party level every gate in this
 * suite is read against. Built rather than cast because `claimQuest` pays XP
 * through the real `gainXp`.
 */
function plainHero(): Hero {
  const baseStats = calculateStatsForLevel(TEMPLATE, 10);
  return {
    id: 'h1',
    templateId: TEMPLATE.id,
    name: templateName(TEMPLATE.id),
    heroClass: TEMPLATE.heroClass as HeroClass,
    level: 10,
    xp: 0,
    baseStats,
    currentHp: baseStats.maxHp,
    currentMana: baseStats.maxMana,
    skills: [],
    equipment: {},
    masteryPath: null,
    masteryPoints: 0,
    masteryNodes: {},
  };
}

/**
 * The modal with the screen taken off it.
 *
 * Every line here has a counterpart in `DialogueModal`: the context is held and
 * replaced *deliberately* at the moment an action lands rather than re-derived
 * per read, rewards are banked rather than delivered, and `finish` is the one
 * exit. Anything the two disagree about is a bug in one of them.
 */
function conversation(npcId: NpcId) {
  const def = npcById(npcId);
  let ctx = currentQuestContext();
  let nodeId = openingNode(def, ctx).id;
  const banked: string[] = [];
  let closedWith: DialogueOutcome | null = null;

  const choices = (): DialogueChoice[] => visibleChoices(nodeById(def, nodeId)!, ctx);

  const step = (choice: DialogueChoice) => {
    const outcome: DialogueOutcome = choice.action
      ? applyDialogueAction(choice.action)
      : { conversation: 'end' };

    if (outcome.rewardLines?.length) banked.push(...outcome.rewardLines);

    if (outcome.conversation === 'continue') ctx = currentQuestContext();

    if (choice.goto && nodeById(def, choice.goto)) {
      nodeId = choice.goto;
      return;
    }
    if (outcome.conversation === 'continue') {
      nodeId = openingNode(def, ctx).id;
      return;
    }
    closedWith = { conversation: 'end', rewardLines: [...banked] };
  };

  return {
    /** Which line is on screen. */
    node: () => nodeId,
    /** The outcome `onClose` would have been handed, or `null` while open. */
    closed: (): DialogueOutcome | null => closedWith,
    open: () => closedWith === null,
    banked: () => [...banked],
    /** The modal's ✕: `finish` with whatever is banked. */
    leave() {
      closedWith = { conversation: 'end', rewardLines: [...banked] };
    },
    /** Takes the first visible choice carrying this action. */
    pick(kind: DialogueAction['kind']) {
      const choice = choices().find((c) => c.action?.kind === kind);
      if (!choice) throw new Error(`"${nodeId}" offers no ${kind}`);
      step(choice);
    },
  };
}

beforeEach(() => {
  usePartyStore.getState().reset();
  useInventoryStore.getState().reset();
  useCityStore.getState().reset();
  useQuestStore.getState().reset();
  usePartyStore.setState({ heroes: [plainHero()] });
});

describe('what an action does to the conversation', () => {
  it('keeps the talk open when it only changed the world', () => {
    expect(applyDialogueAction({ kind: 'acceptQuest', quest: 'snares_and_stakes' }).conversation)
      .toBe('continue');
    expect(applyDialogueAction({ kind: 'claimQuest', quest: 'snares_and_stakes' }).conversation)
      .toBe('continue');
  });

  /** A goodbye is what genuinely finishes a talk: "another time" means it. */
  it('ends it on a goodbye', () => {
    expect(applyDialogueAction({ kind: 'end' }).conversation).toBe('end');
  });
});

describe('the trapper, take and give in one conversation', () => {
  /** Guards the walk below: it is only a test of two quests if he holds two. */
  it('holds two quests of his own', () => {
    const his = ['snares_and_stakes', 'the_thing_in_the_thicket'] as const;
    expect(his.map((id) => QUESTS[id].giver)).toEqual(['huntsman', 'huntsman']);
  });

  it('takes a quest back and offers the next without closing', () => {
    // Eight timber already in the bag. A `collect` objective is a stock, so
    // this quest is finishable the moment it is accepted — which nothing
    // reports, and which is why `acceptQuest` sweeps.
    useInventoryStore.getState().addResource(ResourceType.Wood, 8);
    useQuestStore.setState({ completed: ['a_word_with_the_trapper'] });

    const talk = conversation('huntsman');
    expect(talk.node()).toBe('offer_snares');

    talk.pick('acceptQuest');
    expect(talk.open()).toBe(true);
    expect(talk.node()).toBe('ready_snares');

    talk.pick('claimQuest');
    expect(talk.open()).toBe(true);
    // The payout is behind us and the next contract is on screen — this is the
    // walk away and walk back the whole change exists to delete.
    expect(talk.node()).toBe('offer_thicket');
    expect(useQuestStore.getState().completed).toContain('snares_and_stakes');

    talk.pick('acceptQuest');
    expect(talk.open()).toBe(true);
    expect(talk.node()).toBe('thicket_waiting');
    expect(useQuestStore.getState().active.the_thing_in_the_thicket).toBeDefined();

    talk.pick('end');
    expect(talk.open()).toBe(false);
    // A quest completed and another taken on, in one approach
    expect(useQuestStore.getState().completed).toEqual(['a_word_with_the_trapper', 'snares_and_stakes']);
    expect(Object.keys(useQuestStore.getState().active)).toEqual(['the_thing_in_the_thicket']);
  });
});

describe('rewards from a conversation that paid out twice', () => {
  /**
   * The captain holds four, and two of them can be ready at once. Firing a
   * reward dialog per hand-off would put it over the conversation it is the
   * point to keep open, and the second payout would replace the first — so the
   * lines accumulate and leave with the real close.
   */
  const both = () => {
    useQuestStore.setState({
      active: {
        wolves_at_the_gate: { stage: QUESTS.wolves_at_the_gate.stages.length, progress: [] },
        a_word_with_the_trapper: {
          stage: QUESTS.a_word_with_the_trapper.stages.length,
          progress: [],
        },
      },
    });
  };

  it('banks both payouts and delivers them once, at the end', () => {
    both();
    const talk = conversation('gate_captain');
    expect(talk.node()).toBe('ready');
    expect(talk.banked()).toEqual([]);

    talk.pick('claimQuest');
    const afterFirst = talk.banked();
    expect(afterFirst.length).toBeGreaterThan(0);
    expect(talk.open()).toBe(true);
    expect(talk.node()).toBe('ready_trapper');
    // Nothing has been handed to the caller yet — a toast here would land on
    // top of the line the captain is in the middle of saying
    expect(talk.closed()).toBeNull();

    talk.pick('claimQuest');
    expect(talk.open()).toBe(true);
    // Accumulated, not replaced: the first payout's lines are still the prefix
    expect(talk.banked().slice(0, afterFirst.length)).toEqual(afterFirst);
    expect(talk.banked().length).toBeGreaterThan(afterFirst.length);

    const everything = talk.banked();
    // The next offer has only its agreement (playtest 2026-10-14), so the ✕ is the way out
    talk.leave();
    expect(talk.closed()?.rewardLines).toEqual(everything);
    expect(useQuestStore.getState().completed).toEqual([
      'wolves_at_the_gate',
      'a_word_with_the_trapper',
    ]);
  });
});
