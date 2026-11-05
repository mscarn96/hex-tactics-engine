import { BALANCE } from '@/data/balanceConstants';
import type { WorldId } from '@/data/worlds';
import { crossingFree, crossingsOpened, effectiveLevelCap, highestLevelCap, levelCap, setLevelCapInputs, worldBand } from '@/data/levelCap';
import { itemTemplates } from '@/data/items/itemTemplates';
import { isItemLevel, maxItemLevel } from '@/data/items/itemLevel';
import { Rarity } from '@/models/types';
import { usePartyStore } from '@/stores/partyStore';
import { pointsEarnedByLevel } from '@/systems/progression/mastery';
import { isMaxLevel, totalXpToLevel } from '@/systems/progression/leveling';
import { canUpgrade, itemDisplayName, upgradeSteps, upgraded } from '@/systems/progression/upgrades';
import { acquisitionLevel, itemAtLevel, mintItem } from '@/systems/economy/itemFactory';
import { castleItemLevel, partyItemLevel } from '@/systems/economy/itemLevelSources';
import { nextStatLevel } from '@/systems/economy/forge';
import { recruitLevel } from '@/systems/progression/recruiting';
import { itemName } from '@/data/items/itemText';

/**
 * One effective cap (`data/levelCap.ts`): 20, plus 5 per crossing opened, and
 * every level-linked rule reads that one number, so hero levels, mastery points
 * and item levels agree in each state.
 */

const STATES = [
  { name: 'an unowned campaign', owned: [], emperor: true, finished: [], cap: 20 },
  { name: 'an owner before Aethelred falls', owned: ['jadeveil'], emperor: false, finished: [], cap: 20 },
  { name: 'an owner after Aethelred falls', owned: ['jadeveil'], emperor: true, finished: [], cap: 25 },
  { name: 'an owner of two worlds, the first finished', owned: ['jadeveil', 'archipelago'], emperor: true, finished: ['archipelago'], cap: 30 },
] as { name: string; owned: WorldId[]; emperor: boolean; finished: WorldId[]; cap: number }[];

const legendary = itemTemplates.find((t) => t.rarity === Rarity.Legendary)!;
const common = itemTemplates.find((t) => t.rarity === Rarity.Common && t.id === 'long_sword_iron')!;

afterEach(() => setLevelCapInputs({ owned: [], emperorDefeated: false, banded: [], finished: [] }));

describe('crossings opened', () => {
  const two: WorldId[] = ['jadeveil', 'archipelago'];
  const cap = (owned: WorldId[], emperorDefeated: boolean, finished: WorldId[] = []) =>
    effectiveLevelCap({ owned, emperorDefeated, finished });

  it('stays at the base cap unowned, and for an owner before Aethelred', () => {
    expect(cap([], false)).toBe(20);
    expect(cap([], true)).toBe(20);
    expect(cap(['jadeveil'], false)).toBe(20);
    expect(cap(two, false, ['jadeveil'])).toBe(20);
  });

  it('opens one road when Aethelred falls, however many worlds are owned', () => {
    expect(cap(['jadeveil'], true)).toBe(25);
    expect(cap(two, true)).toBe(25);
  });

  it('opens the next on an orb boss’s first kill, only while a world is left to enter', () => {
    expect(cap(two, true, ['jadeveil'])).toBe(30);
    expect(cap(['jadeveil'], true, ['jadeveil'])).toBe(25);
    expect(cap(two, true, ['jadeveil', 'archipelago'])).toBe(30);
  });

  it('never opens more than four, and the highest cap is 40', () => {
    const five = ['a', 'b', 'c', 'd', 'e'] as unknown as WorldId[];
    expect(crossingsOpened({ owned: five, emperorDefeated: true, finished: five })).toBe(BALANCE.MAX_WORLD_CROSSINGS);
    expect(highestLevelCap()).toBe(40);
    expect(highestLevelCap()).toBe(effectiveLevelCap({ owned: five, emperorDefeated: true, finished: five }));
  });

  it('falls back to the base cap when ownership cannot be read', () => {
    expect(effectiveLevelCap({ owned: [], emperorDefeated: true, finished: ['jadeveil'] })).toBe(20);
  });

  it('frees a crossing until a world takes it, and again when its orb boss falls', () => {
    const state = { owned: two, emperorDefeated: true, banded: [] as WorldId[], finished: [] as WorldId[] };
    expect(crossingFree(state)).toBe(true);
    const onTheRoad = { ...state, banded: ['archipelago'] as WorldId[] };
    expect(crossingFree(onTheRoad)).toBe(false);
    expect(crossingFree({ ...onTheRoad, finished: ['archipelago'] })).toBe(true);
  });

  it('reads each world’s band off the pushed ledger, in the order they were taken', () => {
    setLevelCapInputs({ banded: ['archipelago', 'jadeveil'] });
    try {
      expect(worldBand('archipelago')).toBe(1);
      expect(worldBand('jadeveil')).toBe(2);
      expect(worldBand('empire')).toBeNull();
    } finally {
      setLevelCapInputs({ banded: [] });
    }
  });
});

describe.each(STATES)('in $name', ({ owned, emperor, finished, cap }) => {
  beforeEach(() => setLevelCapInputs({ owned, emperorDefeated: emperor, finished }));

  it(`caps heroes at ${cap}`, () => {
    expect(levelCap()).toBe(cap);
    usePartyStore.getState().reset();
    usePartyStore.getState().addHero('warrior');
    const id = usePartyStore.getState().heroes[0].id;
    usePartyStore.getState().gainXp(id, totalXpToLevel(40), 1);
    const hero = usePartyStore.getState().heroes[0];
    expect(hero.level).toBe(cap);
    expect(hero.xp).toBe(0);
    expect(isMaxLevel(hero.level)).toBe(true);
    // One mastery point per level past the unlock level, 21–25 included
    expect(hero.masteryPoints).toBe(pointsEarnedByLevel(cap));
    expect(pointsEarnedByLevel(cap)).toBe(cap - BALANCE.MASTERY_UNLOCK_LEVEL);
  });

  it('mints, rewards and raises items against the same cap', () => {
    expect(acquisitionLevel(Rarity.Legendary)).toBe(cap);
    expect(mintItem(legendary, () => 0.5).itemLevel).toBe(cap);
    expect(castleItemLevel(BALANCE.MAX_SEAL_TIER)).toBe(cap);
    expect(maxItemLevel(Rarity.Legendary)).toBe(cap + BALANCE.MAX_UPGRADE_LEVEL);
    expect(maxItemLevel(Rarity.Common)).toBe(cap);
    expect(partyItemLevel([{ level: 40 }])).toBe(cap);
    expect(recruitLevel(99)).toBeLessThanOrEqual(cap);
    expect(upgradeSteps({ rarity: Rarity.Legendary, itemLevel: cap + 2 })).toBe(2);
  });
});

describe('when the cap rises after Aethelred', () => {
  it('reads an old +2 as an ordinary legendary below the new drop, with Crystals left to spend', () => {
    setLevelCapInputs({ owned: ['jadeveil'], emperorDefeated: false });
    const old = itemAtLevel(mintItem(legendary, () => 0.5), BALANCE.MAX_LEVEL + 2);
    expect(itemDisplayName(old)).toMatch(/\+2$/);

    setLevelCapInputs({ emperorDefeated: true });
    expect(itemDisplayName(old)).toBe(itemName(old));
    expect(canUpgrade(old)).toBe(true);
    // Its stats are its own level's, untouched by the cap moving under it
    const reread = itemAtLevel(old, old.itemLevel);
    expect(reread.modifiers).toEqual(old.modifiers);
    const raised = upgraded(old);
    expect(raised.itemLevel).toBe(old.itemLevel + 1);
  });
});

describe('when the cap falls back (ownership unreadable)', () => {
  it('never makes an item weaker', () => {
    const every = ['a', 'b', 'c', 'd'] as unknown as WorldId[];
    setLevelCapInputs({ owned: every, emperorDefeated: true, finished: every });
    const top = itemAtLevel(mintItem(legendary, () => 0.5), highestLevelCap() + 2);
    const sword = itemAtLevel(mintItem(common, () => 0.5), highestLevelCap());
    expect(sword.itemLevel).toBe(highestLevelCap());

    setLevelCapInputs({ owned: [] });
    expect(canUpgrade(top)).toBe(false);
    expect(upgraded(top)).toBe(top);
    expect(itemAtLevel(sword, sword.itemLevel + 1)).toBe(sword);
    expect(nextStatLevel(sword, 40)).toBeNull();
  });

  it('keeps every mastery point a hero earned above it', () => {
    setLevelCapInputs({ owned: [], emperorDefeated: true });
    expect(pointsEarnedByLevel(highestLevelCap())).toBe(highestLevelCap() - BALANCE.MASTERY_UNLOCK_LEVEL);
  });

  it('keeps hero and item levels above the cap in force through a save check', () => {
    setLevelCapInputs({ owned: [], emperorDefeated: true });
    const item = itemAtLevel(mintItem(common, () => 0.5), 1);
    expect(isItemLevel(35, item.rarity, highestLevelCap())).toBe(true);
    expect(isItemLevel(41, item.rarity, highestLevelCap())).toBe(false);
  });
});
