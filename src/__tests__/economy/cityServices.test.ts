import { BuildingType, Rarity } from '@/models/types';
import {
  buildingMaxLevel, levelPerk, nextLevelHint, recruitCost, restCost, retrainCost,
  shopPrice, shopRarities, shopStock, shopStockCount,
} from '@/systems/economy/cityServices';
import { previewItem } from '@/systems/economy/itemFactory';
import { BALANCE } from '@/data/balanceConstants';
import { marketSpread } from '@/systems/economy/market';
import { maxForgeRarity } from '@/systems/economy/forge';
import { deploymentPerk } from '@/systems/combat/deployment';
import { buildingData } from '@/data/templates/buildingData';

/**
 * What a city building's levels buy, and the sentence that says so.
 *
 * A playtest found three of the six were dishonest about their own levels. The
 * rule this file is really pinning is the one that keeps them honest from here
 * on: **every level of every building must buy something, and the hint the modal
 * shows must be derived from the behaviour rather than written beside it.** A
 * parallel table of level descriptions is the bug being guarded against — the
 * strings are what a player decides on, and nothing at runtime can ever notice
 * one going stale.
 */

const BUILDINGS = buildingData.map((b) => b.type);
const LEVELS = (type: BuildingType) =>
  Array.from({ length: buildingMaxLevel(type) + 1 }, (_, i) => i);

describe('every level buys something', () => {
  /**
   * The finding that started this: the Tavern's only mechanical effect was
   * `recruitCost = 50 + level * 25`, so upgrading it made the one thing it sold
   * *dearer*. An upgrade is allowed to be a poor deal; it is not allowed to be
   * a downgrade.
   */
  it('never makes a building worse to have upgraded', () => {
    const regressions: string[] = [];
    for (const level of [1, 2, 3]) {
      if (restCost(level, 20) > restCost(level - 1, 20)) regressions.push(`rest at ${level}`);
      if (recruitCost(level) > recruitCost(level - 1)) regressions.push(`recruit at ${level}`);
      if (shopStockCount(level) < shopStockCount(level - 1)) regressions.push(`shop at ${level}`);
      if (marketSpread(level) > marketSpread(level - 1)) regressions.push(`market at ${level}`);
    }
    expect(regressions).toEqual([]);
  });

  /**
   * A level that says exactly what the level below it says is a level that buys
   * nothing — the same defect the Barracks, Library and Tavern were sent back
   * for, caught by asking each building to describe itself.
   *
   * **The Forge was the last outstanding instance and is fixed.**
   * `maxForgeRarity` read `>= 3 → Epic`, `>= 2 → Rare`, else Common, so levels
   * 0 and 1 crafted exactly the same tier: the forge's first upgrade cost 60
   * gold, 10 wood, 20 stone and 10 iron and changed nothing a player could do.
   * The gate moved down a rung, which left level 3 with nothing of its own to
   * say — so the top rung is where mastery sets and the bench that re-aims their
   * skill bonus now live.
   *
   * The exception list is empty and pinned as an exact set, so a *new* mute
   * building fails this too.
   */
  it('says something different at every level, in every building', () => {
    const mute: string[] = [];
    for (const type of BUILDINGS) {
      const said = LEVELS(type).map((l) => levelPerk(type, l));
      if (new Set(said).size !== said.length) mute.push(type);
    }
    expect(mute).toEqual([]);
  });

  /**
   * The forge specifically, because it is the one whose fix was a balance
   * decision rather than a wording one: every rung has to move the ceiling or
   * add a bench, and the ceiling has to open at the *bottom* of the scale
   * rather than the top.
   */
  it('opens a craftable tier at each of the forge’s first three rungs', () => {
    expect(maxForgeRarity(0)).toBe(Rarity.Common);
    expect(maxForgeRarity(1)).toBe(Rarity.Rare);
    expect(maxForgeRarity(2)).toBe(Rarity.Epic);
    // The top rung is not a rarity at all — it is the legendary bench
    expect(levelPerk(BuildingType.Forge, 3)).not.toBe(levelPerk(BuildingType.Forge, 2));
  });
});

describe('the tavern finally has a reason to be upgraded', () => {
  it('keeps service prices independent of level', () => {
    expect(restCost(3, 20)).toBe(restCost(0, 20));
    expect(recruitCost(3)).toBe(recruitCost(0));
  });

  it('prices the bed off the party, so it bites early and not late', () => {
    expect(restCost(0, 40)).toBeGreaterThan(restCost(0, 4));
  });

  /** A fully-upgraded tavern with a tiny party must not round the bed to free. */
  it('never gives the room away', () => {
    const free = [0, 1, 2, 3].filter((level) => restCost(level, 1) < 1);
    expect(free).toEqual([]);
  });
});

describe('the shop rack', () => {
  it('adds families without opening higher rarities', () => {
    expect(shopRarities(0)).toEqual([Rarity.Common, Rarity.Rare]);
    expect(shopRarities(3)).toEqual(shopRarities(0));
    expect(shopStock(3).length).toBeGreaterThan(shopStock(0).length);
  });

  it('does not rack nothing but swords', () => {
    // Evenly spaced rather than a prefix — the item library is generated form
    // by form, so a prefix stocks one silhouette
    const slots = new Set(shopStock(2).map((t) => t.slot));
    expect(slots.size).toBeGreaterThan(1);
  });

  it('asks more than it pays', () => {
    const item = previewItem(shopStock(1)[0]);
    expect(shopPrice(item)).toBeGreaterThan(item.sellPrice);
  });
});

describe('the hint is derived, never written twice', () => {
  it('names the level it is describing', () => {
    for (const type of BUILDINGS) {
      expect(nextLevelHint(type, 0)).toContain('Level 1');
    }
  });

  it('stops at the top', () => {
    const overrun = BUILDINGS.filter((t) => nextLevelHint(t, buildingMaxLevel(t)) !== null);
    expect(overrun).toEqual([]);
  });

  /**
   * The assertion the whole module exists for: the hint's numbers are read back
   * out of the functions the buildings actually run on, so retuning a level
   * moves the promise with it.
   */
  it('quotes the same numbers the buildings run on', () => {
    expect(nextLevelHint(BuildingType.Barracks, 0))
      .toContain(deploymentPerk(1));
    expect(nextLevelHint(BuildingType.Shop, 1))
      .toContain(String(shopStockCount(2)));
    expect(nextLevelHint(BuildingType.Market, 1))
      .toContain(marketSpread(2).toFixed(2));
    // Level 2 rather than 3: the top rung is the legendary bench and names no
    // craftable tier at all, so the rarity it quotes is the last one that does
    expect(levelPerk(BuildingType.Forge, 2).toLowerCase())
      .toContain(maxForgeRarity(2));
  });

  it('is concrete enough to decide on', () => {
    // "Improves the shop" tells a player nothing they can weigh against a
    // price. Every perk has to name either a quantity or a tier — the forge and
    // the tavern legitimately trade in the latter.
    const TIER_WORDS = /no expedition meal|common|rares|epics|legendaries|full price/;
    const vague = BUILDINGS
      .flatMap((t) => LEVELS(t).map((l) => [t, levelPerk(t, l)] as const))
      .filter(([, said]) => !/\d/.test(said) && !TIER_WORDS.test(said))
      .map(([t, said]) => `${t}: ${said}`);
    expect(vague).toEqual([]);
  });
});

// ─── Unlearning: what it costs ───────────────────────────────────────────────

describe('retrain cost', () => {
  /**
   * Per point spent, so the price tracks the size of the mistake rather than
   * the fact of undoing one. A flat fee would make unpicking a single tier-1
   * node as expensive as rebuilding a capstone chain.
   */
  it('scales with how much was spent', () => {
    expect(retrainCost(0, 2)).toBeLessThan(retrainCost(0, 10));
    expect(retrainCost(0, 10)).toBeLessThan(retrainCost(0, BALANCE.MASTERY_POINTS_AT_CAP));
  });

  /** Free for a no-op, so a caller can price an empty tree honestly. */
  it('charges nothing when there is nothing to give back', () => {
    expect(retrainCost(0, 0)).toBe(0);
    expect(retrainCost(3, 0)).toBe(0);
  });

  it('falls with the barracks level, and never to nothing', () => {
    const full = retrainCost(0, BALANCE.MASTERY_POINTS_AT_CAP);
    const cheap = retrainCost(buildingMaxLevel(BuildingType.Barracks), BALANCE.MASTERY_POINTS_AT_CAP);
    expect(cheap).toBeLessThan(full);
    expect(cheap).toBeGreaterThan(0);
  });

  /**
   * A full rebuild has to read as a real decision against the thing the whole
   * mid-game is played around, or it becomes a thing to fiddle with between
   * fights.
   */
  it('costs several weeks of opening rent for a full tree', () => {
    expect(retrainCost(0, BALANCE.MASTERY_POINTS_AT_CAP))
      .toBeGreaterThan(BALANCE.TRIBUTE_BASE * 4);
  });
});

describe('weekly Shop assortment', () => {
  it('stocks the agreed distinct family count and Common/Rare eligibility at every level', () => {
    for (const level of [0,1,2,3]) for (let week=1;week<=40;week++) {
      const rack = shopStock(level, week);
      expect(rack).toHaveLength(shopStockCount(level));
      expect(rack.every(t => shopRarities(level).includes(t.rarity))).toBe(true);
      expect(new Set(rack.map(t => t.form + ':' + t.motif)).size).toBe(rack.length);
      expect(rack.map(t=>t.id)).toEqual(shopStock(level,week).map(t=>t.id));
      expect(rack.map(t=>t.id)).not.toEqual(shopStock(level,week+1).map(t=>t.id));
    }
  });
});
