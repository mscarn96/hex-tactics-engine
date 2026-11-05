import { createStore as create } from 'zustand/vanilla';
import { reportAchievement } from '@/utils/achievementBus';
import * as Crypto from '@/platform/uuid';
import { BagEntry, GemId, GemKind, GemTier, Item, ResourceType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useAscentStore } from '@/stores/ascentStore';
import { gemMergeGold, gemMergeSource, GemStock, gemTierOpen, isGemId, GEM_KINDS } from '@/data/items/gems';
import { worldBand } from '@/data/levelCap';
import { bagKindCap } from '@/data/items/bagKinds';
import {
  bagGear, bagGemStock, isStackEntry, stackCount, StackKey, startingBag, withGear, withStack,
} from '@/data/items/bag';

type Resources = Record<ResourceType, number>;

const RATION: StackKey = { kind: 'ration' };
const PORTAL: StackKey = { kind: 'townPortal' };
const INCENSE: StackKey = { kind: 'incense' };
const gemKey = (gem: GemId): StackKey => ({ kind: 'gem', gem });

interface InventoryState {
  /**
   * Everything the party carries, as one list of entries with a kind — gear,
   * gems, trail rations, the town portal and warding incense
   * (`data/items/bagKinds.ts` declares each). Persisted as it stands.
   *
   * Gear readers do not walk it: they read `selectGear` (or `gear()`), which
   * hands back the pieces alone, so equipment, the forge, salvage, the stash,
   * the market and the stat code never meet a stack. The stacks have their own
   * selectors (`selectGems`, `selectRations`, `selectTownPortal`,
   * `selectWards`).
   *
   * This reverses the old rule that food was "deliberately not an item". That
   * held while an item could only be a piece of gear, so every screen listing
   * the bag would have grown a special case for the one entry that was a stack.
   * With each kind declared once, the bag lists a ration like any other entry
   * and its panel offers Eat, while every gear screen still sees only gear.
   * Food is still not a `ResourceType`: it is bought at a counter, not mined,
   * and not traded at the Market's weekly rate.
   */
  bag: BagEntry[];
  resources: Resources;
  /** The gear in the bag (`selectGear`). Socketed gems belong to their piece. */
  gear: () => Item[];
  /** Packs one town portal for `TOWN_PORTAL_GOLD`; refused while one is carried or the gold is short. */
  buyTownPortal: () => boolean;
  spendTownPortal: () => boolean;
  /** Packs one warding incense for `WARD_GOLD`, up to `WARD_CARRY`. Lit from the bag. */
  /** Packs one incense stick for `price` gold (the city's own price unless a village's discount lowers it). */
  buyWard: (price?: number) => boolean;
  spendWard: () => boolean;
  /** Stores the item under a fresh id, and returns that id. A Jadeveil piece teaches the forge its pattern. */
  addItem: (item: Item) => string;
  removeItem: (itemId: string) => void;
  /** Edits an item in place, keeping its id so equipment references survive. */
  updateItem: (itemId: string, patch: Partial<Item>) => void;
  getItem: (itemId: string) => Item | undefined;
  /**
   * One forge action on an item already held: replace it with `next` and pay
   * `cost`, in a single write, or change nothing and return false. The item keeps
   * its id, so worn equipment stays worn. What the bench previewed is `next`
   * itself, so the committed piece cannot differ from the one shown.
   */
  applyForgeWork: (itemId: string, next: Item, cost: Partial<Resources>) => boolean;
  /** Drops every gear piece whose id is not in `keep`; the stacks stay (a lost fight's bag). */
  keepGear: (keep: ReadonlySet<string>) => void;
  addGem: (gem: GemId, amount?: number) => void;
  buyGem: (gem: GemId) => boolean;
  spendGem: (gem: GemId, amount?: number) => boolean;
  /**
   * The Forge's merge: `GEM_CUT_INPUT` gems of a kind at `tier`'s source
   * (`gemMergeSource`) into one at `tier`, for `gemMergeGold(tier)` — two cut into
   * a brilliant, two brilliants into a Spirit gem. Refused for a tier whose world
   * has no band yet (`gemTierOpen`, Spirit before the first crossing into Jadeveil)
   * and for Cut.
   */
  mergeGem: (kind: GemKind, tier: GemTier) => boolean;
  /** Sets a loose gem in an empty socket of a carried piece, worn or not. Free, anywhere (the bag). */
  socketGem: (itemId: string, socket: number, gem: GemId) => boolean;
  /** Takes a set gem back into the bag, for `GEM_RECOVER_GOLD` (the Forge's Gems tab). */
  recoverGem: (itemId: string, socket: number) => boolean;
  addResource: (type: ResourceType, amount: number) => void;
  spendResources: (costs: Partial<Resources>) => boolean;
  canAfford: (costs: Partial<Resources>) => boolean;
  /**
   * Puts rations in the pack. The pack's cap (`rationCap`, the ration kind's
   * `cap`) is asked by the counter that sells them; an amount below one does
   * nothing.
   */
  addRations: (amount: number) => void;
  /**
   * Eats exactly one ration, or reports that there was none to eat.
   *
   * Singular on purpose: a meal is one ration and the rule in
   * `systems/economy/rations.ts` prices one heal, so an `amount` parameter would
   * be a second place that could decide how many a hero eats at a sitting.
   */
  spendRation: () => boolean;
  /**
   * Strips the treasury to nothing — every resource, gold included — and every
   * stack in the bag with it: gems, rations, the portal and incense. Gear stays
   * (the lost fight already took what was not worn).
   *
   * Distinct from `reset`, which restores the *starting* purse. A sacked city is
   * left with zero, not with a new game's hundred gold.
   *
   * The stacks are cleared here rather than by the caller because this is the
   * only thing that fires it — the siege loss in `applyDefeat`, which also
   * flattens every building to level 0. A pack of food or a stick of incense
   * surviving that would be the one thing left standing after the city is
   * taken, which reads as an oversight because it would be one.
   */
  clearResources: () => void;
  reset: () => void;
}

const defaultResources = (): Resources => ({
  [ResourceType.Gold]: 100,
  [ResourceType.Wood]: 0,
  [ResourceType.Stone]: 0,
  [ResourceType.Iron]: 0,
  [ResourceType.Crystal]: 0,
});

type BagHolder = { bag: readonly BagEntry[] };
const gearCache = new WeakMap<readonly BagEntry[], Item[]>();
const gemCache = new WeakMap<readonly BagEntry[], GemStock>();

/**
 * The gear in the bag — what every gear reader reads. The same array for the
 * same bag, so it is safe as a hook selector (`useInventoryStore(selectGear)`).
 */
export function selectGear(state: BagHolder): Item[] {
  let gear = gearCache.get(state.bag);
  if (!gear) { gear = bagGear(state.bag); gearCache.set(state.bag, gear); }
  return gear;
}

/** The loose gems as a full stock; the same object for the same bag. */
export function selectGems(state: BagHolder): GemStock {
  let stock = gemCache.get(state.bag);
  if (!stock) { stock = bagGemStock(state.bag); gemCache.set(state.bag, stock); }
  return stock;
}

export const selectRations = (state: BagHolder): number => stackCount(state.bag, RATION);
export const selectTownPortal = (state: BagHolder): boolean => stackCount(state.bag, PORTAL) > 0;
/** Warding incense in the pack. */
export const selectWards = (state: BagHolder): number => stackCount(state.bag, INCENSE);

const pay = (resources: Resources, gold: number): Resources => ({ ...resources, gold: resources.gold - gold });

export const useInventoryStore = create<InventoryState>((set, get) => ({
  bag: startingBag(BALANCE.STARTING_RATIONS),
  resources: defaultResources(),
  gear: () => selectGear(get()),

  buyTownPortal: () => {
    const state = get();
    if (stackCount(state.bag, PORTAL) >= (bagKindCap('townPortal', 0) ?? Infinity)
      || state.resources.gold < BALANCE.TOWN_PORTAL_GOLD) return false;
    set({ bag: withStack(state.bag, PORTAL, 1), resources: pay(state.resources, BALANCE.TOWN_PORTAL_GOLD) });
    return true;
  },
  spendTownPortal: () => {
    if (stackCount(get().bag, PORTAL) <= 0) return false;
    set((s) => ({ bag: withStack(s.bag, PORTAL, -1) }));
    return true;
  },
  buyWard: (price = BALANCE.WARD_GOLD) => {
    const state = get();
    if (stackCount(state.bag, INCENSE) >= (bagKindCap('incense', 0) ?? Infinity)
      || state.resources.gold < price) return false;
    set({ bag: withStack(state.bag, INCENSE, 1), resources: pay(state.resources, price) });
    return true;
  },
  spendWard: () => {
    if (stackCount(get().bag, INCENSE) <= 0) return false;
    set((s) => ({ bag: withStack(s.bag, INCENSE, -1) }));
    return true;
  },

  addItem: (item) => {
    const newItem = { ...item, id: Crypto.randomUUID() };
    set((s) => ({ bag: [...s.bag, { kind: 'gear', item: newItem }] }));
    // Every route into the bag passes here, so it is where the forge learns a
    // Jadeveil motif's pattern: a piece held once is a recipe for good
    // (`ascentStore.learnPattern`, which ignores the Empire's motifs).
    useAscentStore.getState().learnPattern(newItem.motif);
    reportAchievement({ kind: 'item', rarity: newItem.rarity });
    return newItem.id;
  },

  removeItem: (itemId) => {
    set((s) => ({ bag: s.bag.filter((e) => e.kind !== 'gear' || e.item.id !== itemId) }));
  },

  /**
   * Edits an item in place, keeping its id.
   *
   * The id has to survive: heroes reference equipment by id, so a Crystal
   * applied to a worn weapon must not silently unequip it — which is exactly
   * what remove-then-add would do.
   */
  updateItem: (itemId, patch) => {
    set((s) => ({ bag: withGear(s.bag, itemId, (item) => ({ ...item, ...patch })) }));
  },

  getItem: (itemId) => selectGear(get()).find((i) => i.id === itemId),

  applyForgeWork: (itemId, next, cost) => {
    const state = get();
    if (!state.getItem(itemId) || !state.canAfford(cost)) return false;
    set((s) => {
      const resources = { ...s.resources };
      for (const [type, amount] of Object.entries(cost) as [ResourceType, number][]) resources[type] -= amount;
      return { bag: withGear(s.bag, itemId, () => ({ ...next, id: itemId })), resources };
    });
    return true;
  },

  keepGear: (keep) => {
    set((s) => ({ bag: s.bag.filter((e) => e.kind !== 'gear' || keep.has(e.item.id)) }));
  },

  addGem: (gem, amount = 1) => {
    if (!isGemId(gem) || !Number.isSafeInteger(amount) || amount <= 0) return;
    set((s) => ({ bag: withStack(s.bag, gemKey(gem), amount) }));
  },

  buyGem: (gem) => {
    const state = get();
    if (!isGemId(gem) || !gem.endsWith('_cut') || state.resources.gold < BALANCE.GEM_SHOP_PRICE) return false;
    set((s) => ({ bag: withStack(s.bag, gemKey(gem), 1), resources: pay(s.resources, BALANCE.GEM_SHOP_PRICE) }));
    return true;
  },

  spendGem: (gem, amount = 1) => {
    if (!isGemId(gem) || !Number.isSafeInteger(amount) || amount <= 0 || stackCount(get().bag, gemKey(gem)) < amount) return false;
    set((s) => ({ bag: withStack(s.bag, gemKey(gem), -amount) }));
    return true;
  },

  mergeGem: (kind, tier) => {
    const source = gemMergeSource(tier);
    if (!GEM_KINDS.includes(kind) || !source || !gemTierOpen(tier, (world) => worldBand(world) !== null)) return false;
    const from: GemId = `${kind}_${source}`;
    const to: GemId = `${kind}_${tier}`;
    const gold = gemMergeGold(tier);
    const state = get();
    if (stackCount(state.bag, gemKey(from)) < BALANCE.GEM_CUT_INPUT || state.resources.gold < gold) return false;
    set((s) => ({
      bag: withStack(withStack(s.bag, gemKey(from), -BALANCE.GEM_CUT_INPUT), gemKey(to), 1),
      resources: pay(s.resources, gold),
    }));
    return true;
  },

  socketGem: (itemId, socket, gem) => {
    const state = get();
    const item = state.getItem(itemId);
    if (!item || !isGemId(gem) || !Number.isInteger(socket) || socket < 0 || socket >= (item.sockets?.length ?? 0)
      || item.sockets?.[socket] !== null || stackCount(state.bag, gemKey(gem)) < 1) return false;
    set((s) => ({
      bag: withStack(
        withGear(s.bag, itemId, (piece) => ({ ...piece, sockets: piece.sockets!.map((held, index) => index === socket ? gem : held) })),
        gemKey(gem), -1),
    }));
    return true;
  },

  recoverGem: (itemId, socket) => {
    const state = get();
    const item = state.getItem(itemId);
    const gem = Number.isInteger(socket) && socket >= 0 ? item?.sockets?.[socket] : null;
    if (!gem || state.resources.gold < BALANCE.GEM_RECOVER_GOLD) return false;
    set((s) => ({
      bag: withStack(
        withGear(s.bag, itemId, (piece) => ({ ...piece, sockets: piece.sockets!.map((held, index) => index === socket ? null : held) })),
        gemKey(gem), 1),
      resources: pay(s.resources, BALANCE.GEM_RECOVER_GOLD),
    }));
    return true;
  },

  addResource: (type, amount) => {
    set((s) => ({
      resources: { ...s.resources, [type]: s.resources[type] + amount },
    }));
  },

  spendResources: (costs) => {
    const state = get();
    for (const [type, amount] of Object.entries(costs) as [ResourceType, number][]) {
      if ((state.resources[type] ?? 0) < amount) return false;
    }
    set((s) => {
      const newResources = { ...s.resources };
      for (const [type, amount] of Object.entries(costs) as [ResourceType, number][]) {
        newResources[type as ResourceType] -= amount;
      }
      return { resources: newResources };
    });
    return true;
  },

  canAfford: (costs) => {
    const state = get();
    for (const [type, amount] of Object.entries(costs) as [ResourceType, number][]) {
      if ((state.resources[type] ?? 0) < amount) return false;
    }
    return true;
  },

  addRations: (amount) => {
    if (!Number.isSafeInteger(amount) || amount <= 0) return;
    set((s) => ({ bag: withStack(s.bag, RATION, amount) }));
  },

  spendRation: () => {
    if (stackCount(get().bag, RATION) <= 0) return false;
    set((s) => ({ bag: withStack(s.bag, RATION, -1) }));
    return true;
  },

  clearResources: () => {
    set((s) => ({
      resources: Object.fromEntries(
        Object.keys(defaultResources()).map((k) => [k, 0]),
      ) as Resources,
      bag: s.bag.filter((e) => !isStackEntry(e)),
    }));
  },

  reset: () => {
    // A new campaign's pack, like its purse: `STARTING_RATIONS`, so the first
    // hurt hero can eat from the map before the tavern is ever visited.
    set({ bag: startingBag(BALANCE.STARTING_RATIONS), resources: defaultResources() });
  },
}));
