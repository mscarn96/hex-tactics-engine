import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { NPCS } from '@/quests/npcData';
import { npcName } from '@/quests/npcText';
import { QuestId } from '@/quests/types';
import { lairsOf } from '@/locations/lairs';
import {
  autoAcceptable, isAvailable, isFinished, objectiveLines, questContext, startRecord, advanceStages,
} from '@/systems/quests/quests';
import { campaignGoal } from '@/systems/quests/campaignGoal';
import { npcInterest } from '@/systems/quests/dialogue';
import { SHRINE_COUNT } from '@/systems/world/shrines';
import { shrineName, summitName } from '@/systems/world/rangeSites';
import { useQuestStore } from '@/stores/questStore';
import { useAscentStore } from '@/stores/ascentStore';
import { ensureAutoQuests } from '@/systems/quests/questEvents';

/**
 * Jadeveil's quests (the private project notes, *Jadeveil*): Ivane's
 * lead lets itself in, every one is given and handed in at the foothill camp,
 * the shrine contracts read the chain the map gates on, and the two lair
 * contracts name their own lair and its boss.
 */
const JADEVEIL: QuestId[] = QUEST_IDS.filter((id) => NPCS[QUESTS[id].giver].camp === 'jadeveil');
const ctx = (completed: QuestId[], shrines = 0, level = 99) =>
  ({ ...questContext(level, { active: {}, completed }, 3), shrines });

describe('the green orb’s road', () => {
  it('is all given at the foothill camp, and opens with Ivane’s lead', () => {
    expect(JADEVEIL).toEqual([
      'the_green_orb', 'the_mossgate', 'lanterns_in_the_bamboo', 'the_silk_hollow',
      'the_teaching_turned', 'the_silent_hall', 'the_hosts_road', 'the_cloud_crown',
    ]);
    expect(autoAcceptable(ctx(['the_red_orb']))).toContain('the_green_orb');
    expect(autoAcceptable(ctx([]))).not.toContain('the_green_orb');
  });

  it('asks for every shrine in order, once each', () => {
    const shrines = JADEVEIL.flatMap((id) => QUESTS[id].stages.flatMap((s) => s.objectives))
      .flatMap((o) => (o.kind === 'shrine' ? [o.index] : []));
    expect(shrines).toEqual([1, 2, 3, 4]);
  });

  it('names each Jadeveil lair and its own boss in its contract', () => {
    for (const spec of lairsOf('jadeveil')) {
      const contract = JADEVEIL.find((id) => QUESTS[id].stages.some((s) =>
        s.objectives.some((o) => o.kind === 'reach' && o.location === spec.id)));
      expect({ lair: spec.id, contract: !!contract }).toEqual({ lair: spec.id, contract: true });
      const kills = QUESTS[contract!].stages.flatMap((s) => s.objectives)
        .flatMap((o) => (o.kind === 'kill' ? o.templates : []));
      expect(kills).toContain(spec.boss);
    }
  });

  it('opens a lair contract only once the shrine below its band can have been claimed', () => {
    // The Silk Hollow (band 2) follows the Mossgate; the Silent Hall (band 3) the Green Terraces
    expect(isAvailable('the_silk_hollow', ctx(['the_green_orb']))).toBe(false);
    expect(isAvailable('the_silk_hollow', ctx(['the_green_orb', 'the_mossgate']))).toBe(true);
    expect(isAvailable('the_silent_hall', ctx(['the_green_orb', 'the_mossgate']))).toBe(false);
    expect(isAvailable('the_silent_hall', ctx(['the_green_orb', 'the_mossgate', 'the_teaching_turned']))).toBe(true);
  });

  it('points Okiku at Tōma until his lead is done', () => {
    expect(npcInterest(NPCS.lantern_keeper, ctx(['the_red_orb']))).toBeNull();
    expect(npcInterest(NPCS.lantern_keeper, ctx(['the_red_orb', 'the_green_orb']))).toBe('offer');
  });
});

describe('the goal it shows', () => {
  const cleared = lairsOf('empire').map((s) => s.id);
  const PLAYING = { unentered: [], banded: ['jadeveil' as const], finished: [] };

  it('walks from Tōma up the shrines to the summit', () => {
    // Ivane's hand-in of the green orb is the road's end, though she gives it in the city
    const done: QuestId[] = QUEST_IDS.filter((id) => !JADEVEIL.includes(id) && id !== 'kairens_orb');
    expect(campaignGoal(ctx(done), cleared, PLAYING).nextStep).toContain(npcName('exile_monk'));
    const started = [...done, 'the_green_orb' as QuestId];
    for (let claimed = 0; claimed < SHRINE_COUNT; claimed++) {
      expect(campaignGoal(ctx(started, claimed), cleared, PLAYING).title).toBe(shrineName(claimed + 1));
    }
    expect(campaignGoal(ctx(started, SHRINE_COUNT), cleared, PLAYING).title).toBe(summitName());
  });
});

describe('a claim moves the log', () => {
  beforeEach(() => {
    useQuestStore.setState({ active: {}, completed: [], tracked: null });
    useAscentStore.getState().reset();
  });

  it('finishes a shrine contract the moment the shrine is claimed', () => {
    useQuestStore.setState({ active: { the_mossgate: startRecord(QUESTS.the_mossgate) } });
    ensureAutoQuests();
    expect(isFinished(QUESTS.the_mossgate, useQuestStore.getState().active.the_mossgate!)).toBe(false);
    useAscentStore.getState().claimShrine(1);
    ensureAutoQuests();
    expect(isFinished(QUESTS.the_mossgate, useQuestStore.getState().active.the_mossgate!)).toBe(true);
  });
});
