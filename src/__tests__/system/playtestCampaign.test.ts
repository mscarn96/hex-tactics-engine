import { averagePartyLevel, awardedXp, catchupXpMultiplier } from '@/systems/progression/leveling';
import { AfflictionType, TileType } from '@/models/types';
import { charge } from '@/data/skills/skillData';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { hexDistance } from '@/utils/hexUtils';
import { noTargetsMessage, rootedRefusal, nothingInRange } from '@/systems/combat/skillAvailability';
import { usePartyStore } from '@/stores/partyStore';
import { useCityStore } from '@/stores/cityStore';
import { makeHero, makeUnit } from '../support/fixtures';
import { useQuestStore } from '@/stores/questStore';
import { useHuntStore } from '@/stores/huntStore';
import { planForEncounter, eligibleHuntPlans, huntQuarry } from '@/systems/world/encounterGenerator';
import { npcInterest } from '@/systems/quests/dialogue';
import { NPCS } from '@/quests/npcData';
import { currentQuestContext } from '@/systems/quests/questEvents';
import { townPortalTile } from '@/systems/world/townPortal';
import { getLocation } from '@/locations';
import { triggerKey } from '@/locations/types';
import { rememberTravelDestination, resumeTravelAfterVictory, takeTravelResume } from '@/utils/travelIntent';

beforeEach(() => {
  useQuestStore.getState().reset(); useHuntStore.getState().reset();
});
it('ends the travel intention at a victory rather than resuming it', () => {
  rememberTravelDestination({ q: 3, r: 0 }); resumeTravelAfterVictory();
  expect(takeTravelResume()).toBeNull();
});
it('explains rooted Charge without disabling adjacent attacks', () => {
  const caster = makeUnit({ id: 'hero', position: { q: 0, r: 0 }, activeEffects: [{ type: AfflictionType.Root, magnitude: 1, duration: 2 }] });
  const distant = makeUnit({ id: 'enemy', isPlayer: false, position: { q: 3, r: 0 } });
  expect(getValidSkillTargetHexes(charge, caster, [caster, distant])).toEqual([]);
  expect(noTargetsMessage(charge, caster, [caster, distant])).toBe(rootedRefusal());
  const adjacent = { ...distant, position: { q: 1, r: 0 } };
  expect(getValidSkillTargetHexes(charge, caster, [caster, adjacent])).toContainEqual(adjacent.position);
  expect(noTargetsMessage(charge, caster, [caster])).toBe(nothingInRange());
});
it('uses the exact average and starts catch-up at two levels below it', () => {
  expect(catchupXpMultiplier(8, 10)).toBe(1.5);
  expect(catchupXpMultiplier(7, 10)).toBe(1.75);
  expect(catchupXpMultiplier(6, 10)).toBe(2);
  expect(catchupXpMultiplier(8.01, 10)).toBe(1);
  const average = averagePartyLevel([{ level: 10 }, { level: 10 }, { level: 5 }]);
  expect(awardedXp(100, 5, average, 0)).toBe(183);
  expect(awardedXp(100, 10, average, 0)).toBe(100);
  expect(catchupXpMultiplier(1, 30)).toBe(8.25);
  expect(awardedXp(100, 8, 10, 1)).toBe(165);
});
it('guarantees a legal wolf fight after two eligible misses, and resets on progress', () => {
  useQuestStore.getState().accept('wolves_at_the_gate');
  const first = planForEncounter('random_danger', 0, TileType.Forest, Infinity);
  expect(first.hunt).toBeDefined();
  const key = first.hunt!.key;
  useHuntStore.getState().won(key, false); useHuntStore.getState().won(key, false);
  for (let n = 0; n < 30; n++) {
    const guaranteed = planForEncounter('random_danger', 0, TileType.Forest, Infinity);
    expect(guaranteed.enemies).toEqual(['wolf_pup', 'wolf_pup']);
  }
  expect(eligibleHuntPlans(0, TileType.Plains, Infinity, ['goblin_shaman'])).toEqual([]);
  expect(planForEncounter('quest_thicket', 0, TileType.Plains, Infinity).hunt).toBeUndefined();
  useHuntStore.getState().won(key, true);
  expect(useHuntStore.getState().streak.misses).toBe(0);
});
it('guarantees the named unit a stage asks for, not just its faction (PT-14)', () => {
  // The Roadwardens' second stage wants six of any brigand *and* the captain.
  useQuestStore.setState({ active: { the_roadwardens: { stage: 1, progress: [0, 0] } }, tracked: 'the_roadwardens' });
  expect(huntQuarry(useQuestStore.getState().active, 'the_roadwardens')[0]).toEqual(['brigand_captain']);
  const first = planForEncounter('random_danger', 2, TileType.Plains, Infinity);
  expect(first.hunt?.targets).toContain('brigand_captain');
  useHuntStore.setState({ streak: { key: first.hunt!.key, misses: 2 } });
  for (let n = 0; n < 30; n++) {
    const guaranteed = planForEncounter('random_danger', 2, TileType.Plains, Infinity);
    expect(guaranteed.factionId).toBe('brigands');
    expect(guaranteed.enemies).toContain('brigand_captain');
  }
  // Where the captain cannot stand, the faction-wide objective is the fallback.
  const low = planForEncounter('random_danger', 1, TileType.Plains, Infinity);
  useHuntStore.setState({ streak: { key: low.hunt!.key, misses: 2 } });
  for (let n = 0; n < 30; n++) {
    const fallback = planForEncounter('random_danger', 1, TileType.Plains, Infinity);
    expect(fallback.enemies.some(e => ['footpad', 'bandit', 'brigand_archer'].includes(e))).toBe(true);
  }
});
it('marks Ivane for the unfinished intermediate talk step and clears it afterwards', () => {
  useQuestStore.setState({ active: { the_bell_below: { stage: 1, progress: [0] } } });
  expect(npcInterest(NPCS.archivist, currentQuestContext())).toBe('talk');
  useQuestStore.setState({ active: { the_bell_below: { stage: 2, progress: [] } } });
  expect(npcInterest(NPCS.archivist, currentQuestContext())).toBeNull();
});
it('opens the lair town portal only after its boss falls, and the castle portal after a clear', () => {
  const boss = getLocation('lair_warren').lair!.bossAt;
  expect(townPortalTile('lair_warren', new Set(), false)).toBeUndefined();
  expect(townPortalTile('lair_warren', new Set([triggerKey('lair_warren', boss)]), false)?.coord).toEqual(boss);
  expect(townPortalTile('castle', new Set(), false)).toBeUndefined();
  const portal = townPortalTile('castle', new Set(), true);
  expect(portal).toBeDefined();
  // Beside the gate on free ground, never on the gate itself (playtest 2026-10-23)
  expect(portal!.trigger).toBeUndefined();
  expect(portal!.blocked).toBeFalsy();
  expect(portal!.prop).toBeUndefined();
  const gate = getLocation('castle').tiles.find((t) => t.trigger?.kind === 'castleGate')!;
  expect(hexDistance(portal!.coord, gate.coord)).toBe(1);
});

it('makes a reward batch independent of recipient order even when the first hero levels up', () => {
  useCityStore.getState().reset();
  const initial = [makeHero({ id: 'high', level: 10 }), makeHero({ id: 'low', level: 5 })];
  const average = averagePartyLevel(initial);
  const award = (order: string[]) => {
    usePartyStore.setState({ heroes: initial });
    for (const id of order) usePartyStore.getState().gainXp(id, 8000, average);
    return usePartyStore.getState().heroes.map(h => ({ id: h.id, xp: h.xp, level: h.level }));
  };
  expect(award(['high', 'low'])).toEqual(award(['low', 'high']));
});
