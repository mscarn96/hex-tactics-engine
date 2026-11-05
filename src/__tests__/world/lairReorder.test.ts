import { objectiveLabel } from '@/systems/quests/objectiveLabel';
import { getLocation, placeName } from '@/locations';
import { EMPIRE_LAIRS as LAIR_SPECS } from '@/locations/lairs';
import { generateMap, onSite } from '@/systems/world/mapGenerator';
import { planEncounter } from '@/systems/world/encounterGenerator';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { factionMembers } from '@/data/templates/factions';
import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { questStageSummary, questSummary, questTitle } from '@/quests/questText';
import { NPCS } from '@/quests/npcData';
import { dialogueChoice, dialogueLine, npcName, npcTitle, npcWhere } from '@/quests/npcText';
import { MapTile, POIType, TileType } from '@/models/types';
import { LocationId } from '@/locations/types';
import { QuestId } from '@/quests/types';
import { questLevelFloor } from '@/systems/quests/questLeads';

/**
 * The lair reorder (the private project notes): the Warren,
 * then the Wyrm's Hollow at mid-game on red rock under the Sandscourge, then the
 * ice lair in the frozen north under the Hoarfrost and the Heart of Winter, and
 * the castle after all three. The Barrow and its Lich left the game.
 *
 * Measured on the seeds the frozen-north suite uses, because a door is placed
 * against the ground that suite generates.
 */

const SEEDS = [1, 7, 42, 99, 1234, 4242, 90210, 777, 31337, 1471934286];

const doorOf = (tiles: MapTile[], id: LocationId) =>
  tiles.find((t) => t.poi === POIType.BossTile && t.encounterId === id);

const spec = (id: LocationId) => LAIR_SPECS.find((s) => s.id === id)!;

/** The strength floor still applies when the offer also requires a story milestone. */
const gate = (id: QuestId) => questLevelFloor(id) || Infinity;

/** The contract whose first objective is the walk to a lair's door. */
const contractFor = (lair: LocationId) =>
  QUEST_IDS.find((id) => QUESTS[id].stages.some((s) =>
    s.objectives.some((o) => o.kind === 'reach' && o.location === lair)))!;

describe('the campaign order', () => {
  it('runs the Warren, the Hollow, then the ice lair', () => {
    expect(LAIR_SPECS.map((s) => s.id)).toEqual(['lair_warren', 'lair_wyrm', 'lair_barrow']);
    expect(LAIR_SPECS.map((s) => s.boss)).toEqual(['troll_chieftain', 'dragon', 'heart_of_winter']);
  });

  it('opens each contract before its lair, and the Hollow’s before the ice lair’s', () => {
    for (const s of LAIR_SPECS) {
      expect(gate(contractFor(s.id))).toBeLessThanOrEqual(s.unlockLevel);
    }
    expect(gate(contractFor('lair_wyrm'))).toBeLessThan(gate(contractFor('lair_barrow')));
    // And the ice lair's contract after the Hollow's lair itself has opened:
    // the second contract is not still pending when the third is offered
    expect(gate(contractFor('lair_barrow'))).toBeGreaterThan(spec('lair_wyrm').unlockLevel);
  });

  it('still opens the Grand Quest on the third lair', () => {
    expect(QUESTS.the_obsidian_ledger.unlockedBy).toEqual({ kind: 'lairsCleared', count: 3 });
    expect(LAIR_SPECS.length).toBe(3);
  });
});

describe('the Wyrm’s Hollow', () => {
  it('stands its door on red rock, outside the frozen north, on every seed', () => {
    const astray = SEEDS.flatMap((seed) => {
      const door = doorOf(generateMap(seed), 'lair_wyrm');
      if (!door) return [`${seed}: no door`];
      const red = (door.type === TileType.Desert || door.type === TileType.Highlands) && !door.frost;
      return red ? [] : [`${seed}: ${door.type}${door.frost ? ' (frozen)' : ''}`];
    });
    expect(astray).toEqual([]);
  });

  it('is guarded by the Sandscourge in every fight but the boss’s', () => {
    const roster = new Set<string>(factionMembers('sandscourge'));
    for (const suffix of ['_1', '_2', '_chest']) {
      const plan = planEncounter(`lair_wyrm${suffix}`);
      expect(plan.factionId).toBe('sandscourge');
      expect(plan.enemies.filter((e) => !roster.has(e))).toEqual([]);
    }
  });
});

describe('the ice lair', () => {
  it('stands its door inside the frozen north, on every seed', () => {
    const astray = SEEDS.flatMap((seed) => {
      const door = doorOf(generateMap(seed), 'lair_barrow');
      if (!door) return [`${seed}: no door`];
      return door.frost ? [] : [`${seed}: ${door.type}, not frozen`];
    });
    expect(astray).toEqual([]);
  });

  it('is guarded by the Hoarfrost, under the Heart of Winter', () => {
    const roster = new Set<string>(factionMembers('hoarfrost'));
    for (const suffix of ['_1', '_2', '_chest']) {
      const plan = planEncounter(`lair_barrow${suffix}`);
      expect(plan.factionId).toBe('hoarfrost');
      expect(plan.enemies.filter((e) => !roster.has(e))).toEqual([]);
    }
    expect(planEncounter('lair_barrow_boss').enemies).toEqual(['heart_of_winter']);
  });

  /** The plan's "five or six rooms instead of four", and the floor to show for it. */
  it('is the largest lair: five or six rooms, and the most floor', () => {
    const rooms = spec('lair_barrow').topology.rooms.length;
    expect(rooms).toBeGreaterThanOrEqual(5);
    expect(rooms).toBeLessThanOrEqual(6);
    const floor = (id: LocationId) => getLocation(id).tiles.filter((t) => !t.blocked).length;
    for (const other of LAIR_SPECS.filter((s) => s.id !== 'lair_barrow')) {
      expect(floor('lair_barrow')).toBeGreaterThan(floor(other.id));
    }
  });
});

describe('a door’s site', () => {
  const tile = (over: Partial<MapTile>): MapTile =>
    ({ coord: { q: 0, r: 0 }, type: TileType.Plains, zone: 'haunted', explored: false, ...over }) as MapTile;

  it('accepts anything for a lair with no site, and holds terrain and the north apart', () => {
    expect(onSite(tile({}), undefined)).toBe(true);
    const red = { terrain: [TileType.Desert, TileType.Highlands], frozen: false };
    expect(onSite(tile({ type: TileType.Desert }), red)).toBe(true);
    expect(onSite(tile({ type: TileType.Plains }), red)).toBe(false);
    expect(onSite(tile({ type: TileType.Highlands, frost: true }), red)).toBe(false);
    expect(onSite(tile({ type: TileType.Tundra, frost: true }), { frozen: true })).toBe(true);
    expect(onSite(tile({ type: TileType.Plains }), { frozen: true })).toBe(false);
  });
});

/**
 * What a player reads. The Lich left the game with the Barrow, the Barrow
 * became the ice lair, and the Hollow stopped breathing warm air "in
 * midwinter" when it moved onto desert rock — so none of the three may survive
 * in anything a quest or a person says.
 */
describe('nothing stale is said', () => {
  const STALE = /\b(lich|barrow|barrows|midwinter)\b/i;

  it('keeps the Lich out of the roster, and every lair boss a template', () => {
    const ids = new Set(enemyTemplates.map((t) => t.id as string));
    expect(ids.has('lich')).toBe(false);
    expect(LAIR_SPECS.filter((s) => !ids.has(s.boss)).map((s) => s.boss)).toEqual([]);
  });

  it('names no stale lair, boss or season in any lair', () => {
    expect(LAIR_SPECS.map((s) => placeName(s.id)).filter((name) => STALE.test(name))).toEqual([]);
  });

  it('says none of it in a quest', () => {
    const said = QUEST_IDS.flatMap((id) => {
      const q = QUESTS[id];
      return [questTitle(id), questSummary(id), ...q.stages.flatMap((s, i) => [questStageSummary(id, i), ...s.objectives.map(objectiveLabel)])]
        .filter((text) => STALE.test(text))
        .map((text) => `${id}: ${text}`);
    });
    expect(said).toEqual([]);
  });

  it('says none of it in a conversation', () => {
    const said = Object.values(NPCS).flatMap((npc) =>
      [npcName(npc.id), npcTitle(npc.id), npcWhere(npc.id), ...npc.nodes.flatMap((n) => [dialogueLine(npc.id, n.id), ...n.choices.map((c) => dialogueChoice(npc.id, n, c))])]
        .filter((text) => STALE.test(text))
        .map((text) => `${npc.id}: ${text.slice(0, 80)}`));
    expect(said).toEqual([]);
  });
});
