import { createStore as create } from 'zustand/vanilla';
import { Building, BuildingType, GemId, Item } from '@/models/types';
import { emptyGemStock, GemStock, isGemId } from '@/data/items/gems';
import { buildingData } from '@/data/templates/buildingData';
import { ExpeditionMeal, mealTier, mealPrice } from '@/systems/economy/expeditionMeals';
import { useCalendarStore } from './calendarStore';
import { nextLevelCost, raisedBuilding, sackBuilding, sackedUntil } from '@/systems/economy/sacking';
import { ResourceType } from '@/models/types';
import { useInventoryStore } from './inventoryStore';

interface CityState {
  buildings: Building[];
  /**
   * Openings earned, each one the right to hold one more hero.
   *
   * A count rather than a list of classes: which class arrives is the player's
   * choice, made at the tavern, and storing a name here is what made the
   * Warrior everyone's first recruit. See `systems/recruiting.ts`.
   */
  recruitsEarned: number;
  /**
   * The party size the "a new hero can join" notice was last shown for, so it
   * is said once per opening (`recruitNoticeDue`); 0 before the first.
   */
  recruitNoticeShownFor: number;
  /**
   * Items left in the city, and the only ones a defeat cannot touch.
   *
   * Losing a fight strips the bag of everything unequipped and takes gold with
   * it. That is the stake the world map is played for, and it stays — what it
   * should not do is make finding a legendary four days from home a reason not
   * to go. The stash is where that legendary waits.
   *
   * Lives on `cityStore` rather than `inventoryStore` for the same reason Seals
   * do on `empireStore`: the wipe is written in terms of "the bag", and a store
   * the wipe does not know about cannot be wiped by accident later.
   */
  stash: Item[];
  /** Stackable gems protected alongside equipment on the city shelf. */
  gemStash: GemStock;
  meal: ExpeditionMeal | null;
  /**
   * The first day the town no longer looks sacked; 0 if it never was
   * (`systems/economy/sacking.ts`).
   */
  sackedUntilDay: number;

  getBuilding: (type: BuildingType) => Building;
  getBuildingLevel: (type: BuildingType) => number;
  upgradeBuilding: (type: BuildingType) => boolean;
  earnRecruit: () => void;
  /** The recruit notice has been shown for a party of `size`. */
  markRecruitNotice: (size: number) => void;
  /** Moves an item out of the bag and into the city. */
  deposit: (item: Item) => void;
  /** Takes one back out. No-op if it is not there. */
  withdraw: (itemId: string) => Item | undefined;
  depositGem: (gem: GemId, amount: number) => boolean;
  withdrawGem: (gem: GemId, amount: number) => boolean;
  buyMeal: (summedLevel: number) => boolean;
  /** A lost siege: every service to level 0 (each remembering its level for a half-price rebuild), and the town sacked from `today`. */
  sack: (today: number) => void;
  reset: () => void;
}

const defaultBuildings = (): Building[] => [
  { type: BuildingType.Barracks, level: 0 },
  { type: BuildingType.Shop, level: 0 },
  { type: BuildingType.Forge, level: 0 },
  { type: BuildingType.Tavern, level: 0 },
  { type: BuildingType.Library, level: 0 },
  { type: BuildingType.Market, level: 0 },
];

export const useCityStore = create<CityState>((set, get) => ({
  buildings: defaultBuildings(),
  recruitsEarned: 0,
  recruitNoticeShownFor: 0,
  stash: [],
  gemStash: emptyGemStock(),
  meal: null,
  sackedUntilDay: 0,

  getBuilding: (type) => {
    return get().buildings.find((b) => b.type === type) ?? { type, level: 0 };
  },

  getBuildingLevel: (type) => {
    return get().buildings.find((b) => b.type === type)?.level ?? 0;
  },

  upgradeBuilding: (type) => {
    const building = get().getBuilding(type);
    const data = buildingData.find((b) => b.type === type);
    if (!data) return false;

    const costs = nextLevelCost(data, building);
    if (!costs) return false;

    const canAfford = useInventoryStore.getState().canAfford(costs);
    if (!canAfford) return false;

    useInventoryStore.getState().spendResources(costs);
    set((s) => ({
      buildings: s.buildings.map((b) =>
        b.type === type ? raisedBuilding(b) : b
      ),
    }));
    return true;
  },

  sack: (today) => set((s) => ({
    buildings: s.buildings.map(sackBuilding),
    sackedUntilDay: sackedUntil(today),
  })),

  earnRecruit: () => set((s) => ({ recruitsEarned: s.recruitsEarned + 1 })),
  markRecruitNotice: (size) => set((s) => ({ recruitNoticeShownFor: Math.max(s.recruitNoticeShownFor, size) })),

  deposit: (item) => {
    // Idempotent on id: a double tap must not put two of the same instance on
    // the shelf, which would then withdraw as two items sharing one id
    if (get().stash.some((i) => i.id === item.id)) return;
    set((s) => ({ stash: [...s.stash, item] }));
  },

  withdraw: (itemId) => {
    const item = get().stash.find((i) => i.id === itemId);
    if (!item) return undefined;
    set((s) => ({ stash: s.stash.filter((i) => i.id !== itemId) }));
    return item;
  },

  depositGem: (gem, amount) => {
    if (!isGemId(gem) || !Number.isSafeInteger(amount) || amount <= 0) return false;
    if (!useInventoryStore.getState().spendGem(gem, amount)) return false;
    set((s) => ({ gemStash: { ...s.gemStash, [gem]: s.gemStash[gem] + amount } }));
    return true;
  },

  withdrawGem: (gem, amount) => {
    if (!isGemId(gem) || !Number.isSafeInteger(amount) || amount <= 0 || get().gemStash[gem] < amount) return false;
    set((s) => ({ gemStash: { ...s.gemStash, [gem]: s.gemStash[gem] - amount } }));
    useInventoryStore.getState().addGem(gem, amount);
    return true;
  },

  buyMeal: (summedLevel) => {
    const clock = useCalendarStore.getState();
    const tier = get().getBuildingLevel(BuildingType.Tavern);
    if (tier < 1 || tier <= mealTier(get().meal, clock.weekNumber)) return false;
    const price = mealPrice(tier, summedLevel, clock.totalHours);
    if (!useInventoryStore.getState().spendResources({ [ResourceType.Gold]: price })) return false;
    set({ meal: { tier, week: clock.weekNumber } });
    return true;
  },

  reset: () =>
    set({
      buildings: defaultBuildings(),
      recruitsEarned: 0,
      recruitNoticeShownFor: 0,
      stash: [],
      gemStash: emptyGemStock(),
      meal: null,
      sackedUntilDay: 0,
    }),
}));
