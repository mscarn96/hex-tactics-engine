import { bagFrom } from '@/data/items/bag';
import { BALANCE } from '@/data/balanceConstants';
import {
  emptyGemStock, gemBonus, GEM_IDS, GEM_KINDS, rollSocketCapacity,
} from '@/data/items/gems';
import { itemTemplates } from '@/data/items/itemTemplates';
import { formatItemModifiers, socketLines } from '@/data/display/itemDisplay';
import { Hero, HeroClass, Item, Rarity, ResourceType } from '@/models/types';
import { mintItem, itemAtLevel } from '@/systems/economy/itemFactory';
import { rollRewardGem } from '@/systems/economy/gemRewards';
import { effectiveModifiers } from '@/systems/progression/itemStats';
import { upgraded } from '@/systems/progression/upgrades';
import { rerollSetBonus } from '@/data/items/setBonus';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { createPlayerUnits } from '@/systems/combat/unitFactory';
import { isLoadable, SAVE_VERSION, SaveData } from '@/systems/save/saveFormat';
import { useInventoryStore, selectGear, selectGems } from '@/stores/inventoryStore';
import { useCityStore } from '@/stores/cityStore';
import { makeStats } from '@/__tests__/support/fixtures';

const template = (rarity: Rarity) => itemTemplates.find((item) => item.rarity === rarity)!;
const hero = (item: Item): Hero => ({
  id: 'gem_hero', templateId: 'warrior', name: 'Gem hero', heroClass: HeroClass.Warrior,
  level: 12, xp: 0, baseStats: makeStats(), currentHp: 100, currentMana: 50,
  skills: [], equipment: { chest: item.id }, masteryPath: null, masteryPoints: 0,
  masteryNodes: {},
});

beforeEach(() => {
  useInventoryStore.getState().reset();
  useCityStore.getState().reset();
});

describe('socket rolls and persistence', () => {
  it('uses the exact zero/one/two distribution for every rarity', () => {
    const expected: Record<Rarity, number[]> = {
      common: [100, 0, 0], rare: [75, 25, 0],
      epic: [50, 35, 15], legendary: [30, 50, 20], mythic: [30, 50, 20],
    };
    for (const rarity of Object.values(Rarity)) {
      const counts = [0, 0, 0];
      for (let i = 0; i < 100; i++) counts[rollSocketCapacity(rarity, () => i / 100)]++;
      expect(counts).toEqual(expected[rarity]);
    }
  });

  it('keeps capacity and duplicate gems through levels, Crystal upgrades and reload', () => {
    const legendary = mintItem(template(Rarity.Legendary), () => 0.99);
    expect(legendary.sockets).toEqual([null, null]);
    const filled = { ...legendary, sockets: ['ruby_cut', 'ruby_cut'] as Item['sockets'] };
    let raised: Item = filled;
    for (let i = 0; i < BALANCE.MAX_UPGRADE_LEVEL; i++) raised = upgraded(raised);
    expect(raised.sockets).toEqual(filled.sockets);
    expect(rerollSetBonus(raised).sockets).toEqual(filled.sockets);
    const epic = mintItem(template(Rarity.Epic), () => 0.99, 7);
    expect(itemAtLevel(epic, 16).sockets).toEqual(epic.sockets);
    const stored = JSON.parse(JSON.stringify(raised)) as Item;
    const stock = emptyGemStock();
    const save = {
      version: SAVE_VERSION,
      game: { difficulty: 'medium', hardcore: false, achievementVictories: [] },
      worldMap: { current: 'empire', worlds: { empire: { seed: 1, explored: [], defeated: [], partyPosition: { q: 0, r: 0 }, activeEncounterTiles: [], usedMagicWells: [], finds: [], merchants: [], day: 1, week: 1 } }, wardUntil: 0, villageBuff: null },
      worldBands: { bands: {}, finished: [] },
      mythicKills: 0,
      ascent: { wrath: { value: 0, at: 0, floor: 0, windowUntil: 0 }, vows: [null, null, null, null], shrines: 0, summit: { slain: false, seals: [0, 0, 0, 0, 0], highestTier: 0 }, forge: { ink: 0, patterns: [] } },
      empire: { winterSeals: [0, 0, 0, 0, 0], heartTier: 0 },
      inventory: { bag: bagFrom({ gear: [stored] }) },
      city: { stash: [epic], gemStash: stock, meal: null, sackedUntilDay: 0, recruitNoticeShownFor: 0 },
    } as unknown as SaveData;
    expect(isLoadable(save)).toBe(true);
    expect(stored.sockets).toEqual(['ruby_cut', 'ruby_cut']);
    expect(isLoadable({ ...save, inventory: { ...save.inventory, bag: bagFrom({ gear: [{ ...stored, sockets: undefined }] }) } })).toBe(false);
    expect(isLoadable({ ...save, inventory: { ...save.inventory, bag: bagFrom({ gear: [{ ...stored, sockets: ['ruby_cut', 'bogus'] as never }] }) } })).toBe(false);
    expect(isLoadable({ ...save, city: { ...save.city, gemStash: undefined } })).toBe(false);
    expect(isLoadable({ ...save, inventory: { ...save.inventory, bag: bagFrom({ gear: [{ ...stored, rarity: 'unknown' as never }] }) } })).toBe(false);
  });
});

describe('fixed bonuses in one equipment stat path', () => {
  it('maps each kind to one stat and makes Brilliant stronger than Cut', () => {
    expect(GEM_KINDS.map((kind) => gemBonus(`${kind}_cut`).stat))
      .toEqual(['attack', 'magic', 'maxHpPercent', 'speed']);
    for (const kind of GEM_KINDS) {
      expect(gemBonus(`${kind}_brilliant`).value).toBeGreaterThan(gemBonus(`${kind}_cut`).value);
    }
  });

  it('makes Jade a percentage of the whole health bar, applied last (playtest 2026-10-14)', () => {
    const chest = { ...mintItem(template(Rarity.Epic), () => 0.99, 12), id: 'jade_chest', sockets: ['jade_brilliant'] as Item['sockets'] };
    const bare = { ...chest, sockets: [null] as Item['sockets'] };
    const withJade = getEffectiveStats(hero(chest), [chest]);
    const without = getEffectiveStats(hero(bare), [bare]);
    expect(withJade.maxHp).toBe(Math.round(without.maxHp * (1 + gemBonus('jade_brilliant').value / 100)));
    expect(socketLines(chest)).toEqual([`Socket 1: Brilliant Jade · +${gemBonus('jade_brilliant').value}% HP`]);
  });

  it('adds each embedded gem after item scaling, including identical gems', () => {
    const chest = template(Rarity.Epic);
    const low = { ...mintItem(chest, () => 0.99, 5), id: 'gem_chest', sockets: ['ruby_cut', 'ruby_cut'] as Item['sockets'] };
    const high = itemAtLevel(low, BALANCE.MAX_LEVEL);
    for (const item of [low, high]) {
      expect((effectiveModifiers(item).attack ?? 0) - (item.modifiers.attack ?? 0))
        .toBe(2 * gemBonus('ruby_cut').value);
      const body = hero(item);
      const naked = getEffectiveStats({ ...body, equipment: {} }, []);
      const sheet = getEffectiveStats(body, [item]);
      useInventoryStore.setState({ bag: bagFrom({ gear: [item] }) });
      const [combat] = createPlayerUnits([body], [{ q: 0, r: 0 }]);
      expect(sheet.attack - naked.attack).toBe(effectiveModifiers(item).attack);
      expect(combat.stats.attack - naked.attack).toBe(effectiveModifiers(item).attack);
      expect(formatItemModifiers(item)).toContain('Attack');
      expect(socketLines(item)).toEqual([
        `Socket 1: Cut Ruby · +${gemBonus('ruby_cut').value} Attack`,
        `Socket 2: Cut Ruby · +${gemBonus('ruby_cut').value} Attack`,
      ]);
    }
    const legendary = mintItem(template(Rarity.Legendary), () => 0.99);
    const socketed = { ...legendary, sockets: ['jade_brilliant', null] as Item['sockets'] };
    const raised = upgraded(socketed);
    expect(gemBonus('jade_brilliant').stat).toBe('maxHpPercent');
    expect((effectiveModifiers(raised).maxHpPercent ?? 0) - (raised.modifiers.maxHpPercent ?? 0))
      .toBe(gemBonus('jade_brilliant').value);
  });
});

describe('loose gems and forge actions', () => {
  it('keeps gem rewards independent of equipment rolls and allows all eight stacks', () => {
    expect(rollRewardGem(false, 'empire', (() => { const rolls = [0, 0.5]; return () => rolls.shift()!; })()))
      .toBe('jade_cut');
    expect(rollRewardGem(false, 'empire', () => 0.99)).toBeNull();
    expect(rollRewardGem(true, 'empire', (() => { const rolls = [0, 0, 0]; return () => rolls.shift()!; })()))
      .toBe('ruby_brilliant');
    for (const gem of GEM_IDS) useInventoryStore.getState().addGem(gem, 2);
    expect(Object.values(selectGems(useInventoryStore.getState()))).toEqual(Array(GEM_IDS.length).fill(2));
  });

  it('transfers stack counts to the stash and preserves them through a bag wipe', () => {
    const bag = useInventoryStore.getState();
    bag.addGem('amber_cut', 3);
    expect(useCityStore.getState().depositGem('amber_cut', 2)).toBe(true);
    expect(selectGems(useInventoryStore.getState()).amber_cut).toBe(1);
    bag.clearResources();
    expect(selectGems(useInventoryStore.getState()).amber_cut).toBe(0);
    expect(useCityStore.getState().gemStash.amber_cut).toBe(2);
    expect(useCityStore.getState().withdrawGem('amber_cut', 1)).toBe(true);
    expect(selectGems(useInventoryStore.getState()).amber_cut).toBe(1);
  });

  it('buys Cut gems for gold without changing equipment and saves stack counts', () => {
    const inventory = useInventoryStore.getState();
    const item = mintItem(template(Rarity.Rare), () => 0.9);
    inventory.addItem(item);
    expect(inventory.buyGem('amber_cut')).toBe(true);
    expect(inventory.buyGem('amber_brilliant')).toBe(false);
    expect(selectGems(useInventoryStore.getState()).amber_cut).toBe(1);
    expect(selectGear(useInventoryStore.getState())).toHaveLength(1);
    expect(inventory.buyGem('ruby_cut')).toBe(false);
    expect(useCityStore.getState().depositGem('amber_cut', 1)).toBe(true);
    const stock = JSON.parse(JSON.stringify(useCityStore.getState().gemStash));
    expect(stock.amber_cut).toBe(1);
    const save = {
      version: SAVE_VERSION,
      game: { difficulty: 'medium', hardcore: false, achievementVictories: [] },
      worldMap: { current: 'empire', worlds: { empire: { seed: 1, explored: [], defeated: [], partyPosition: { q: 0, r: 0 }, activeEncounterTiles: [], usedMagicWells: [], finds: [], merchants: [], day: 1, week: 1 } }, wardUntil: 0, villageBuff: null },
      worldBands: { bands: {}, finished: [] },
      mythicKills: 0,
      ascent: { wrath: { value: 0, at: 0, floor: 0, windowUntil: 0 }, vows: [null, null, null, null], shrines: 0, summit: { slain: false, seals: [0, 0, 0, 0, 0], highestTier: 0 }, forge: { ink: 0, patterns: [] } },
      empire: { winterSeals: [0, 0, 0, 0, 0], heartTier: 0 },
      inventory: { bag: useInventoryStore.getState().bag },
      city: { stash: [], gemStash: stock, meal: null, sackedUntilDay: 0, recruitNoticeShownFor: 0 },
    } as unknown as SaveData;
    expect(isLoadable(JSON.parse(JSON.stringify(save)))).toBe(true);
  });

  it('cuts, fills, recovers and refills two sockets without changing the item', () => {
    const inventory = useInventoryStore.getState();
    const item = { ...mintItem(template(Rarity.Epic), () => 0.99), id: 'two_sockets' };
    expect(item.sockets).toEqual([null, null]);
    inventory.addItem(item);
    const storedId = selectGear(useInventoryStore.getState())[0].id;
    inventory.addGem('sapphire_cut', 4);
    inventory.addResource(ResourceType.Gold, 1000);
    expect(inventory.mergeGem('sapphire', 'brilliant')).toBe(true);
    expect(selectGems(useInventoryStore.getState()).sapphire_brilliant).toBe(1);
    expect(inventory.socketGem(storedId, 0, 'sapphire_cut')).toBe(true);
    expect(inventory.socketGem(storedId, 1, 'sapphire_cut')).toBe(true);
    expect(useInventoryStore.getState().getItem(storedId)?.sockets).toEqual(['sapphire_cut', 'sapphire_cut']);
    expect(inventory.recoverGem(storedId, 0)).toBe(true);
    expect(inventory.socketGem(storedId, 0, 'sapphire_brilliant')).toBe(true);
    const after = useInventoryStore.getState().getItem(storedId)!;
    expect(after.sockets).toEqual(['sapphire_brilliant', 'sapphire_cut']);
    expect(after.itemLevel).toBe(item.itemLevel);
    expect(after.affixes).toEqual(item.affixes);
    expect(after.modifiers).toEqual(item.modifiers);
    expect(after.sockets).toHaveLength(2);
  });

  it('leaves every state field unchanged on invalid and short-gold actions', () => {
    const inventory = useInventoryStore.getState();
    const item = { ...mintItem(template(Rarity.Epic), () => 0.99), id: 'blocked' };
    inventory.addItem(item);
    const id = selectGear(useInventoryStore.getState())[0].id;
    inventory.addGem('ruby_cut');
    inventory.spendResources({ [ResourceType.Gold]: 100 });
    const before = JSON.stringify(useInventoryStore.getState());
    expect(inventory.mergeGem('ruby', 'brilliant')).toBe(false);
    expect(inventory.recoverGem(id, 0)).toBe(false);
    expect(inventory.socketGem(id, 2, 'ruby_cut')).toBe(false);
    expect(inventory.spendGem('ruby_cut', 2)).toBe(false);
    expect(useCityStore.getState().depositGem('ruby_cut', 2)).toBe(false);
    expect(JSON.stringify(useInventoryStore.getState())).toBe(before);

    // Setting is free, so even a purse that cannot take the gem back out may set it
    expect(inventory.socketGem(id, 0, 'ruby_cut')).toBe(true);
    const withGem = JSON.stringify(useInventoryStore.getState());
    expect(inventory.recoverGem(id, 0)).toBe(false);
    expect(JSON.stringify(useInventoryStore.getState())).toBe(withGem);
  });
});
