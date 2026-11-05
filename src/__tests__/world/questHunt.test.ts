import { createRNG } from '@/utils/rng';
import { generateForBand, generateEncounterEnemies, planForEncounter } from '@/systems/world/encounterGenerator';
import { useQuestStore } from '@/stores/questStore';
import { currentQuestContext, huntedTemplates } from '@/systems/quests/questEvents';
import { QUESTS } from '@/quests/questData';
import { TileType } from '@/models/types';
import { useHuntStore } from '@/stores/huntStore';
import { huntGround } from '@/systems/quests/questHints';
import { type ThreatBand } from '@/systems/world/threat';

/**
 * The world noticing what the player is hunting.
 *
 * A playtest spent four in-game weeks looking for wolves for the first quest in
 * the game, and the arithmetic says that was not bad luck: Beasts are one of
 * three factions at band 0 and terrain-weighted *against* on plains, so the
 * pack the gate captain is worried about turned up in roughly one fight in
 * seven, on top of the fights themselves being scarce. These pin the two halves
 * of the fix — which faction turns up, and which of its members fill the slots.
 */

const WOLVES = ['wolf_pup', 'wolf', 'dire_wolf'];
const BRIGANDS = ['footpad', 'bandit', 'brigand_archer', 'brigand_captain'];
const ROLLS = 3000;

// Repeatable samples: rate assertions should measure the weighting, not fresh random luck.
beforeEach(() => jest.spyOn(Math, 'random').mockImplementation(createRNG(42).next));
afterEach(() => jest.restoreAllMocks());

/** How many of `ROLLS` band-`band` encounters contained one of `kind`. */
function rate(band: 0 | 1 | 2, terrain: TileType, hunted: string[], kind: string[]): number {
  let hits = 0;
  for (let i = 0; i < ROLLS; i++) {
    const ids = generateForBand(band, terrain, Infinity, hunted);
    if (ids.some((id) => kind.includes(id))) hits++;
  }
  return hits / ROLLS;
}
const wolfRate = (band: 0 | 1 | 2, terrain: TileType, hunted: string[]) => rate(band, terrain, hunted, WOLVES);

describe('hunted templates bias random encounters', () => {
  it('makes the hunted faction markedly more common on its own crowded ground', () => {
    // Band-2 plains is shared by the Greenskins, the Brigands and the Thunder
    // Herd, each at home, so the Brigands hold three entries of ten
    const idle = rate(2, TileType.Plains, [], BRIGANDS);
    const hunting = rate(2, TileType.Plains, BRIGANDS, BRIGANDS);
    expect(hunting).toBeGreaterThan(idle * 1.8);
  });

  it('gives a roamer no extra weight off its own ground', () => {
    // The Brigands may wander into a swamp; a quest for them must not make that common
    const idle = rate(2, TileType.Swamp, [], BRIGANDS);
    const hunting = rate(2, TileType.Swamp, BRIGANDS, BRIGANDS);
    expect(Math.abs(hunting - idle)).toBeLessThan(0.03);
  });

  it('cannot field a locked faction off its ground at all', () => {
    // The wolf quest of the first hour: Beasts are the forest's, and nowhere else
    expect(wolfRate(0, TileType.Plains, WOLVES)).toBe(0);
    expect(wolfRate(0, TileType.Swamp, WOLVES)).toBe(0);
  });

  it('still leaves room for everyone else — a quest does not empty the world', () => {
    const hunting = wolfRate(0, TileType.Forest, WOLVES);
    expect(hunting).toBeLessThan(0.95);
  });

  it('fills a hunted faction\'s slots with the hunted member', () => {
    // `front` for Beasts is wolf / dire_wolf / giant_spider. Rolling a Beast
    // warband and then getting all spiders would leave the counter untouched
    // despite the roll going the player's way — which reads as the same bug.
    const spiders: string[] = [];
    for (let i = 0; i < ROLLS; i++) {
      const ids = generateForBand(1, TileType.Forest, Infinity, WOLVES);
      if (ids.includes('giant_spider')) spiders.push(ids.join(','));
    }
    expect(spiders).toEqual([]);
  });

  it('leaves the roster alone when nothing is hunted', () => {
    let spiders = 0;
    for (let i = 0; i < ROLLS; i++) {
      if (generateForBand(1, TileType.Forest).includes('giant_spider')) spiders++;
    }
    expect(spiders).toBeGreaterThan(0);
  });

  it('never touches curated fights', () => {
    // A lair boss does not change species because somebody wants wolf pelts
    const plain = generateEncounterEnemies('boss_0', 4, TileType.Forest);
    const hunted = generateEncounterEnemies('boss_0', 4, TileType.Forest, Infinity, WOLVES);
    expect(hunted).toEqual(plain);
  });
});

describe('huntedTemplates', () => {
  beforeEach(() => {
    useQuestStore.setState({ active: {}, completed: [], tracked: null });
  });

  it('reports nothing when no quest is running', () => {
    expect(huntedTemplates()).toEqual([]);
  });

  it('reports the templates of an unfinished kill objective', () => {
    useQuestStore.getState().accept('wolves_at_the_gate');
    expect(huntedTemplates().sort()).toEqual([...WOLVES].sort());
  });

  it('stops reporting once the counter is full', () => {
    const store = useQuestStore.getState();
    store.accept('wolves_at_the_gate');
    const need = QUESTS.wolves_at_the_gate.stages[0].objectives[0];
    if (need.kind !== 'kill') throw new Error('fixture changed');
    // The next stage may want something else entirely, so a satisfied counter
    // must stop bending the world toward what it already has
    useQuestStore.getState().report(
      { kind: 'kill', template: 'wolf', count: need.count },
      currentQuestContext(),
    );
    expect(huntedTemplates()).toEqual([]);
  });
});

describe('hunt fights on the quarry\'s own ground (PT-01, PT-09)', () => {
  // Hoofprints in the Mud's drummers: the Thunder Herd, locked to the plains and
  // highlands from band 2. It replaced What the Reeds Hide (playtest 2026-10-23,
  // PT-07), whose Fenfolk were the swamp's own version of the same rule
  const DRUMMER = 'storm_drummer';
  const FIGHTS = 2000;

  beforeEach(() => {
    useQuestStore.setState({ active: { hoofprints_in_the_mud: { stage: 1, progress: [0] } }, completed: [], tracked: 'hoofprints_in_the_mud' });
    useHuntStore.getState().reset();
  });

  /** How many of `FIGHTS` wandering fights here held at least one Storm Drummer. */
  function huntRate(band: ThreatBand, terrain: TileType): number {
    let hits = 0;
    for (let i = 0; i < FIGHTS; i++) {
      const plan = planForEncounter('random_danger', band, terrain, Infinity);
      if (plan.enemies.includes(DRUMMER)) hits++;
    }
    return hits / FIGHTS;
  }

  it.each([2, 3, 4] as const)('fields the quarry in most plains and highland fights at band %i', (band) => {
    // No misses recorded, so this is the chance alone, not the miss guarantee
    for (const terrain of [TileType.Plains, TileType.Highlands]) {
      const rate = huntRate(band, terrain);
      expect(rate).toBeGreaterThan(0.78);
      expect(rate).toBeLessThan(0.99);
    }
  });

  it('never fields the quarry off its ground, nor below its bands', () => {
    for (const band of [0, 1, 2, 3, 4] as const) {
      for (const terrain of [TileType.Swamp, TileType.Forest, TileType.Desert]) {
        expect(huntRate(band, terrain)).toBe(0);
      }
    }
    for (const band of [0, 1] as const) expect(huntRate(band, TileType.Plains)).toBe(0);
  });

  it('paints the plains and highland bands the hunt can field the quarry in', () => {
    expect(huntGround({ kind: 'kill', templates: [DRUMMER], count: 2 })).toMatchObject({
      terrain: [TileType.Plains, TileType.Highlands], locked: true, bands: [2, 4],
    });
  });
});
