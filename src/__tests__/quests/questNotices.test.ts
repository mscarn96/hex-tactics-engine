import {
  QuestLogSnapshot, QuestNotice, noticesForChange, drainQuestNotices, pushQuestNotice,
  questNoticeText, resetQuestNotices, subscribeQuestNotices,
} from '@/systems/quests/questNotices';
import { DEFAULT_LOCALE, setLocale } from '@/i18n';
import { QuestId } from '@/quests/types';
import { QuestRecord } from '@/systems/quests/quests';
import { npcName, npcWhere } from '@/quests/npcText';
import { QUESTS } from '@/quests/questData';
import { questStageSummary, questTitle } from '@/quests/questText';

/**
 * The log, saying something out loud.
 *
 * Two quests carry these cases. `wolves_at_the_gate` is one stage and one
 * counter — the shape of "kill five wolves", which is where the whole complaint
 * started — and `the_goblin_tithe` is the only shape that can prove a stage
 * advance is announced as an advance rather than as two more numbers.
 */

const WOLVES: QuestId = 'wolves_at_the_gate';
const TITHE: QuestId = 'the_goblin_tithe';

/**
 * Finished is a **stage index past the last stage**, not full counters —
 * `advanceStages` bumps it, and `isFinished` reads only that. Spelled out here
 * because writing the obvious `{ stage: 0, progress: [5] }` produces a record
 * the game can never actually hold, and a suite built on one measures nothing.
 */
const FINISHED_WOLVES: QuestRecord = { stage: 1, progress: [5] };

const snapshot = (
  active: Partial<Record<QuestId, QuestRecord>>,
  completed: QuestId[] = [],
): QuestLogSnapshot => ({ active, completed });

const texts = (before: QuestLogSnapshot, after: QuestLogSnapshot) =>
  noticesForChange(before, after).map(questNoticeText);

/** A counter notice standing for the `n`th thing queued. */
const counter = (n: number): QuestNotice => ({ kind: 'progress', quest: WOLVES, stage: 0, objective: 0, have: n, need: 99 });

const kinds = (before: QuestLogSnapshot, after: QuestLogSnapshot) =>
  noticesForChange(before, after).map((n) => n.kind);

describe('quest notices', () => {
  describe('what is worth saying', () => {
    it('announces a quest arriving, by name', () => {
      const out = noticesForChange(
        snapshot({}),
        snapshot({ [WOLVES]: { stage: 0, progress: [0] } }),
      );
      expect(out.map((n) => n.kind)).toEqual(['accepted']);
      expect(questNoticeText(out[0])).toContain(questTitle(WOLVES));
    });

    it('says nothing when nothing moved', () => {
      const record: QuestRecord = { stage: 0, progress: [3] };
      expect(noticesForChange(snapshot({ [WOLVES]: record }), snapshot({ [WOLVES]: record })))
        .toEqual([]);
    });

    /**
     * A `collect` counter is a stock read off the bag, so it falls when the
     * items are spent. A notice reading "Crystals 4/8" because four were sold is
     * the log reporting a loss as progress.
     */
    it('says nothing when a counter went down', () => {
      expect(
        noticesForChange(
          snapshot({ [WOLVES]: { stage: 0, progress: [4] } }),
          snapshot({ [WOLVES]: { stage: 0, progress: [2] } }),
        ),
      ).toEqual([]);
    });

    it('announces a stage advance as an advance, not as a counter', () => {
      const out = noticesForChange(
        snapshot({ [TITHE]: { stage: 0, progress: [5] } }),
        snapshot({ [TITHE]: { stage: 1, progress: [0] } }),
      );
      expect(out.map((n) => n.kind)).toEqual(['stage']);
      expect(questNoticeText(out[0])).toContain(questStageSummary(TITHE, 1));
    });

    /**
     * The one notice that asks for something. A quest whose last counter is full
     * pays out nowhere but at the person who set it — the log cannot claim — so
     * the notice has to name them and where they stand, or it is an instruction
     * to go and search for a building.
     */
    it('names who to hand a finished quest back to, and where', () => {
      const out = noticesForChange(
        snapshot({ [WOLVES]: { stage: 0, progress: [4] } }),
        snapshot({ [WOLVES]: FINISHED_WOLVES }),
      );
      expect(out.map((n) => n.kind)).toEqual(['ready']);
      const giver = QUESTS[WOLVES].giver;
      expect(questNoticeText(out[0])).toContain(npcName(giver));
      expect(questNoticeText(out[0])).toContain(npcWhere(giver));
    });

    /**
     * "Wolves 5/5" and "the quest is done" are one event, and saying both is the
     * log talking over itself at the exact moment it has something to say.
     */
    it('does not also report the counter that finished the quest', () => {
      expect(
        kinds(
          snapshot({ [WOLVES]: { stage: 0, progress: [4] } }),
          snapshot({ [WOLVES]: FINISHED_WOLVES }),
        ),
      ).toEqual(['ready']);
    });

    it('reports nothing further about a quest already finished', () => {
      expect(
        noticesForChange(
          snapshot({ [WOLVES]: FINISHED_WOLVES }),
          snapshot({ [WOLVES]: { stage: 1, progress: [7] } }),
        ),
      ).toEqual([]);
    });

    /**
     * Claiming is the one transition with the player already standing in front
     * of the answer. A toast telling them what just visibly happened is noise.
     */
    it('says nothing when a quest is claimed', () => {
      expect(
        noticesForChange(snapshot({ [WOLVES]: FINISHED_WOLVES }), snapshot({}, [WOLVES])),
      ).toEqual([]);
    });

    it('reports each quest that moved, when several did', () => {
      const out = kinds(
        snapshot({ [WOLVES]: { stage: 0, progress: [1] }, [TITHE]: { stage: 0, progress: [1] } }),
        snapshot({ [WOLVES]: { stage: 0, progress: [2] }, [TITHE]: { stage: 0, progress: [2] } }),
      );
      expect(out).toEqual(['progress', 'progress']);
    });
  });

  describe('the queue', () => {
    beforeEach(() => resetQuestNotices());

    it('hands everything over once and empties', () => {
      pushQuestNotice(counter(1));
      pushQuestNotice(counter(2));
      expect(drainQuestNotices()).toEqual([counter(1), counter(2)]);
      expect(drainQuestNotices()).toEqual([]);
    });

    /**
     * Past a handful the player is reading a wall rather than a notice, and the
     * *oldest* is the one that explains the rest — a long fight against a quest
     * target can move a counter, finish a stage and finish the quest.
     */
    it('keeps the oldest when a fight floods it', () => {
      for (let i = 0; i < 12; i++) pushQuestNotice(counter(i));
      const out = drainQuestNotices();
      expect(out.length).toBeLessThanOrEqual(5);
      expect(out[0]).toEqual(counter(0));
    });

    it('tells a listener something arrived, and stops on unsubscribe', () => {
      let calls = 0;
      const off = subscribeQuestNotices(() => { calls++; });
      pushQuestNotice(counter(1));
      expect(calls).toBe(1);
      off();
      pushQuestNotice(counter(2));
      expect(calls).toBe(1);
    });

    it('drops everything on a load', () => {
      pushQuestNotice(counter(1));
      resetQuestNotices();
      expect(drainQuestNotices()).toEqual([]);
    });
  });
});
