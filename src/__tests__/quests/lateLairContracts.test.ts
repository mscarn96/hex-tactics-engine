import { LAIR_SPECS, getLocation } from '@/locations';
import { triggerKey } from '@/locations/types';
import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { useQuestStore } from '@/stores/questStore';
import { useLocationStore } from '@/stores/locationStore';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { acceptQuest, syncQuests, claimQuest } from '@/systems/quests/questEvents';
import { startRecord } from '@/systems/quests/quests';
import { MapTile, POIType, ResourceType, TileType } from '@/models/types';

afterEach(() => {
  useQuestStore.getState().reset();
  useLocationStore.getState().reset();
  usePartyStore.getState().reset();
  useInventoryStore.getState().reset();
  useWorldMapStore.setState({ tiles: new Map() });
});

it('keeps Roadwardens finishable when every one-shot waypoint was cleared before the offer', () => {
  useQuestStore.getState().reset();
  useLocationStore.getState().reset();
  const tile = (q: number, poi: POIType, defeated: boolean): MapTile => ({
    coord: { q, r: 0 }, type: TileType.Plains, zone: 'haunted', explored: true, height: 0.5, poi, defeated,
  });
  useWorldMapStore.setState({ tiles: new Map([
    ['0,0', tile(0, POIType.QuestSite, false)], ['1,0', tile(1, POIType.BossTile, true)],
  ]) });
  acceptQuest('the_roadwardens');
  expect(useQuestStore.getState().active.the_roadwardens!.stage).toBe(0);
  useWorldMapStore.setState({ tiles: new Map([0, 1, 2].map(q => [`${q},0`, tile(q, POIType.QuestSite, true)])) });
  syncQuests();
  expect(useQuestStore.getState().active.the_roadwardens).toEqual({ stage: 1, progress: [0, 0] });
  syncQuests();
  expect(useQuestStore.getState().active.the_roadwardens).toEqual({ stage: 1, progress: [0, 0] });
  useQuestStore.getState().reset();
  acceptQuest('the_roadwardens');
  expect(useQuestStore.getState().active.the_roadwardens!.stage).toBe(1);
});

it.each(LAIR_SPECS)('credits a late $name contract only from that lair’s saved boss victory', spec => {
  const id = QUEST_IDS.find(id => QUESTS[id].stages.some(s => s.objectives.some(o => o.kind === 'reach' && o.location === spec.id)))!;
  useQuestStore.getState().reset();
  usePartyStore.getState().reset();
  useInventoryStore.getState().reset();
  const other = LAIR_SPECS.find(s => s.id !== spec.id)!;
  const bossKey = (lair: typeof spec) => triggerKey(lair.id, getLocation(lair.id).lair!.bossAt);
  const guard = getLocation(spec.id).tiles.find(tile => tile.trigger?.kind === 'encounter'
    && tile.trigger.encounterId === spec.encounters[0])!;
  // Different lair, and this lair's guard room, provide no boss proof.
  useLocationStore.setState({ spentTriggers: new Set([bossKey(other), triggerKey(spec.id, guard.coord)]) });
  acceptQuest(id);
  expect(useQuestStore.getState().active[id]).toEqual(startRecord(QUESTS[id]));

  useLocationStore.setState({ spentTriggers: new Set([bossKey(spec)]) });
  syncQuests();
  expect(useQuestStore.getState().readyToClaim()).toContain(id);
  const completed = useQuestStore.getState().active[id];
  syncQuests();
  expect(useQuestStore.getState().active[id]).toBe(completed);

  // A fresh acceptance after the victory is also immediately ready.
  useQuestStore.getState().reset();
  acceptQuest(id);
  expect(useQuestStore.getState().readyToClaim()).toContain(id);
  const before = useInventoryStore.getState().resources[ResourceType.Gold] ?? 0;
  claimQuest(id);
  claimQuest(id);
  expect((useInventoryStore.getState().resources[ResourceType.Gold] ?? 0) - before).toBe(QUESTS[id].rewards.gold);
});

it('does not turn unrelated ordinary hunt objectives into past kill credit', () => {
  useQuestStore.getState().reset();
  useLocationStore.setState({ spentTriggers: new Set(LAIR_SPECS.map(spec => triggerKey(spec.id, getLocation(spec.id).lair!.bossAt))) });
  acceptQuest('wolves_at_the_gate');
  expect(useQuestStore.getState().active.wolves_at_the_gate).toEqual(startRecord(QUESTS.wolves_at_the_gate));
});
