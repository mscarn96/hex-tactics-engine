import { EMPIRE_LAIRS as LAIR_SPECS } from '@/locations/lairs';
import { LocationId, triggerKey } from '@/locations/types';
import { getLocation, placeName } from '@/locations';
import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { NPCS } from '@/quests/npcData';
import { npcName } from '@/quests/npcText';
import { QuestId } from '@/quests/types';
import { activeLairAtGiver, campaignGoal, ivaneRoadsLine, lairContract } from '@/systems/quests/campaignGoal';
import { worldName, type WorldId } from '@/data/worlds';
import { questContext, startRecord } from '@/systems/quests/quests';
import { openingNode, visibleChoices } from '@/systems/quests/dialogue';
import { applyDialogueAction } from '@/systems/quests/dialogueActions';
import { trackedQuestTarget, ensureAutoQuests } from '@/systems/quests/questEvents';
import { useQuestStore } from '@/stores/questStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { useLocationStore } from '@/stores/locationStore';
import { useGameStore } from '@/stores/gameStore';
import { MapTile, POIType, TileType } from '@/models/types';
import { hexKey } from '@/utils/hexUtils';

beforeEach(() => {
  useQuestStore.getState().reset();
  useLocationStore.getState().reset();
  useWorldMapStore.getState().reset();
  useGameStore.getState().setGuide('off');
});

describe('the goal past the ledger', () => {
  const after = (extra: QuestId[]) => questContext(99, { active: {}, completed: [...QUEST_IDS.filter(id => id !== 'the_red_orb'), ...extra] }, 3);
  const cleared = LAIR_SPECS.map(s => s.id);

  it('sends every campaign to Ivane with the red orb', () => {
    for (const roads of [{ unentered: ['jadeveil' as const], banded: [], finished: [] }, undefined]) {
      const goal = campaignGoal(after([]), cleared, roads);
      expect(goal.quest).toBe('the_red_orb');
      expect(goal.nextStep).toContain(npcName('archivist'));
    }
  });

  // Every open road the party has not taken, each with its next step
  const roadsGoal = (unentered: WorldId[], banded: WorldId[] = [], finished: WorldId[] = []) => {
    const beforeCamp = after(['the_red_orb']);
    beforeCamp.completed = beforeCamp.completed.filter((id) => !NPCS[QUESTS[id].giver].camp && id !== 'kairens_orb');
    return campaignGoal(beforeCamp, cleared, { unentered, banded, finished });
  };

  it('points at another world’s orb boss while that world is being played', () => {
    const goal = roadsGoal([], ['archipelago']);
    expect(goal.title).toBe(worldName('archipelago'));
    expect(goal.nextStep).toContain('Captain Varr');
    expect(goal.quest).toBeNull();
  });
});

describe('each lair from offer through repeat attempts to hand-in', () => {
  it('the third lair still auto-accepts the Grand Quest without replacing a side-quest choice', () => {
    const side = 'a_word_with_the_trapper';
    useQuestStore.setState({ active: { [side]: startRecord(QUESTS[side]) }, tracked: side });
    useLocationStore.setState({ spentTriggers: new Set(LAIR_SPECS.map(s =>
      triggerKey(s.id, getLocation(s.id).lair!.bossAt))) });
    ensureAutoQuests();
    expect(useQuestStore.getState().active.the_obsidian_ledger).toBeDefined();
    expect(useQuestStore.getState().tracked).toBe(side);
    expect(useGameStore.getState().guide).toBe('off');
  });

  it.each(LAIR_SPECS)('$id is prominent and accepting it tracks it', spec => {
    const id = lairContract(spec.id)!;
    const quest = QUESTS[id];
    const npc = NPCS[quest.giver];
    const side: QuestId = spec.id === 'lair_warren' ? 'a_word_with_the_trapper'
      : spec.id === 'lair_wyrm' ? 'a_claim_worth_keeping' : 'word_from_the_high_workings';
    const ctx = questContext(99, { active: {}, completed: QUEST_IDS.filter(q => q !== id) }, LAIR_SPECS.indexOf(spec));
    const offer = openingNode(npc, ctx);
    expect(visibleChoices(offer, ctx).some(c => c.action?.kind === 'acceptQuest' && c.action.quest === id)).toBe(true);
    // Other available work must not bury the lair at its own giver.
    ctx.completed = ctx.completed.filter(q => QUESTS[q].giver !== quest.giver);
    ctx.completed = [...ctx.completed, ...QUEST_IDS.filter(q => QUESTS[q].giver === quest.giver && q !== id && q !== side)];
    expect(visibleChoices(openingNode(npc, ctx), ctx).some(c => c.action?.kind === 'acceptQuest' && c.action.quest === id)).toBe(true);
    useQuestStore.setState({ active: { [side]: startRecord(QUESTS[side]) }, tracked: side });
    useGameStore.setState({ guide: 'off' });
    // Taken from its giver, the lair replaces the side errand on the strip and the guide follows it.
    applyDialogueAction({ kind: 'acceptQuest', quest: id });
    ensureAutoQuests();
    expect(useQuestStore.getState().tracked).toBe(id);
    expect(useGameStore.getState().guide).toBe('quest');
    const active = questContext(1, useQuestStore.getState(), 0);
    expect(activeLairAtGiver(quest.giver, active)).toEqual({ id, name: placeName(spec.id) });
    expect(activeLairAtGiver('huntsman', active)).toBeNull();
    const chase = npc.nodes.find(n => n.requires?.kind === 'questActive' && n.requires.quest === id)!;
    // The chase line has one answer: no "track on map" beside "keep my trail" (playtest 2026-10-22).
    expect(visibleChoices(chase, active).map(c => c.action?.kind)).toEqual(['end']);
    const city = { q: 0, r: 0 }, giver = { q: 2, r: 1 }, door = { q: 9, r: -4 };
    const tiles = new Map<string, MapTile>();
    for (const [coord, poi, extra] of [
      [city, POIType.City, {}], [giver, POIType.Wayside, { npcId: 'prospector' }],
      [door, POIType.BossTile, { encounterId: spec.id }],
    ] as const) tiles.set(hexKey(coord), { coord, poi, type: TileType.Plains, explored: false, height: 0, ...extra } as MapTile);
    useWorldMapStore.setState({ partyPosition: city, poiCoords: [...tiles.values()].map(t => t.coord) });
    expect(trackedQuestTarget(tiles)).toEqual(door);
    useQuestStore.setState({ active: { [id]: { stage: 0, progress: [1, 0] } } });
    // Entered, retreated, and returned: the boss is still alive and the entrance stays the target.
    expect(trackedQuestTarget(tiles)).toEqual(door);
    useQuestStore.setState({ active: { [id]: { stage: quest.stages.length, progress: [] } } });
    expect(trackedQuestTarget(tiles)).toEqual(quest.giver === 'prospector' ? giver : city);
    const ready = questContext(1, useQuestStore.getState());
    expect(visibleChoices(openingNode(npc, ready), ready).some(c => c.action?.kind === 'claimQuest' && c.action.quest === id)).toBe(true);
  });
});
