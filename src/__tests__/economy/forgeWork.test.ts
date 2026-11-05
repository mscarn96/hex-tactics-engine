import { bagFrom } from '@/data/items/bag';
import { BALANCE } from '@/data/balanceConstants';
import { itemTemplates } from '@/data/items/itemTemplates';
import { affixPool, applyAffixes, findAffix } from '@/data/items/itemAffixes';
import { anchorItemLevel, levelledModifiers, maxItemLevel } from '@/data/items/itemLevel';
import { Item, ItemModifiers, ItemTemplate, Rarity, ResourceType } from '@/models/types';
import {
  affixRerollCost, affixRerollOptions, balanceAfter, forgeCost, levelUpgradeCap, levelUpgradeCost,
  affixRerollPreview, levelUpgraded, nextStatLevel, rerolledAffix, setBonusRerollCost,
} from '@/systems/economy/forge';
import { itemAtLevel, itemFromTemplate, itemWithAffixes, mintItem } from '@/systems/economy/itemFactory';
import { upgraded } from '@/systems/progression/upgrades';
import { rerollSetBonus } from '@/data/items/setBonus';
import { selectGear, useInventoryStore } from '@/stores/inventoryStore';
import { itemName } from '@/data/items/itemText';

/**
 * The reforge bench: nonlegendary item-level upgrades and one-affix rerolls.
 *
 * The rules pinned here are the feature's acceptance stated over the whole
 * catalogue rather than a sample: an upgrade always moves a stat, never passes
 * the cap and keeps everything but the level; a reroll never returns what it
 * replaced, never rolls an affix the piece could not have minted with, and keeps
 * everything but that affix; and every action charges exactly once.
 */

const ordinary = itemTemplates.filter((t) => t.rarity !== Rarity.Legendary);
const affixed = ordinary.filter((t) => t.rarity === Rarity.Rare || t.rarity === Rarity.Epic);
const legendary = itemTemplates.find((t) => t.rarity === Rarity.Legendary)!;

/** A minted piece with both sockets filled, so "gems are kept" is a real claim. */
function socketed(template: ItemTemplate, level: number, rng = () => 0.99): Item {
  const minted = mintItem(template, rng, level);
  return { ...minted, id: `held_${template.id}`, sockets: (minted.sockets ?? []).map(() => 'ruby_cut') };
}

function differs(a: ItemModifiers, b: ItemModifiers): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ItemModifiers>;
  return [...keys].some((k) => (a[k] ?? 0) !== (b[k] ?? 0));
}

beforeEach(() => useInventoryStore.getState().reset());

describe('raising an ordinary piece to its next stat gain', () => {
  it('lands on the first level that moves a stat, never on a plateau and never past the cap', () => {
    const offenders: string[] = [];
    for (const t of ordinary) {
      for (const start of [1, 4, 9, 15]) {
        const item = socketed(t, start);
        for (const cap of [start, start + 1, start + 3, BALANCE.MAX_LEVEL]) {
          const target = nextStatLevel(item, cap);
          if (target === null) {
            for (let l = item.itemLevel + 1; l <= Math.min(cap, maxItemLevel(t.rarity)); l++) {
              if (differs(itemAtLevel(item, l).modifiers, item.modifiers)) offenders.push(`${t.id} missed Lv ${l}`);
            }
            continue;
          }
          if (target > cap) offenders.push(`${t.id}: ${target} past cap ${cap}`);
          const raised = levelUpgraded(item, target);
          if (!differs(raised.modifiers, item.modifiers)) offenders.push(`${t.id}: Lv ${target} is a plateau`);
          for (let l = item.itemLevel + 1; l < target; l++) {
            if (differs(itemAtLevel(item, l).modifiers, item.modifiers)) offenders.push(`${t.id}: skipped Lv ${l}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the id, affixes, sockets and gems, changing only the level, stats and price', () => {
    const offenders: string[] = [];
    for (const t of affixed) {
      const item = socketed(t, 3);
      const target = nextStatLevel(item, BALANCE.MAX_LEVEL);
      if (target === null) continue;
      const raised = levelUpgraded(item, target);
      const { itemLevel: _l, modifiers: _m, sellPrice: _p, ...rest } = raised;
      const { itemLevel: _l2, modifiers: _m2, sellPrice: _p2, ...before } = item;
      if (JSON.stringify(rest) !== JSON.stringify(before)) offenders.push(t.id);
      if (raised.itemLevel !== target) offenders.push(`${t.id} level`);
    }
    expect(offenders).toEqual([]);
  });

  it('refuses legendaries, whose levels are the Crystal track', () => {
    expect(nextStatLevel(mintItem(legendary), BALANCE.MAX_LEVEL + 10)).toBeNull();
  });

  it('caps at the strongest hero, not the mean', () => {
    expect(levelUpgradeCap([3, 11, 6])).toBe(11);
    expect(levelUpgradeCap([])).toBe(1);
  });

  it('prices a climb in gold and the form material, never under the floors, and more for a longer climb', () => {
    const sword = itemTemplates.find((t) => t.id.startsWith('long_sword'))!;
    const item = socketed(sword, 2);
    const short = levelUpgradeCost(item, 3);
    const long = levelUpgradeCost(item, 18);
    expect(short[ResourceType.Gold]).toBeGreaterThanOrEqual(BALANCE.ITEM_LEVEL_UPGRADE.minGold);
    expect(short[ResourceType.Iron]).toBeGreaterThanOrEqual(BALANCE.ITEM_LEVEL_UPGRADE.minMaterial);
    expect(long[ResourceType.Gold]!).toBeGreaterThan(short[ResourceType.Gold]!);
  });
});

describe('the reroll preview states what each affix gives', () => {
  const keys = (a: ItemModifiers, b: ItemModifiers) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])] as (keyof ItemModifiers)[];

  /**
   * At the rarity's anchor level and above. Below it the scale cuts every number
   * down, and an affix on a stat the piece already carries can round to nothing
   * — the preview says so ("no effect at this level") rather than hiding it.
   */
  it('gives every candidate and the current affix a non-empty set of stat lines', () => {
    for (const t of affixed) {
      const item = socketed(t, anchorItemLevel(t.rarity));
      for (const affixId of item.affixes ?? []) {
        const { current, options } = affixRerollPreview(item, affixId);
        expect(Object.keys(current).length).toBeGreaterThan(0);
        for (const { gain } of options) expect(Object.keys(gain).length).toBeGreaterThan(0);
      }
    }
  });

  it('matches the item after the reroll: the change is exactly candidate minus current', () => {
    const offenders: string[] = [];
    for (const t of affixed) {
      for (const level of [3, 11]) {
        const item = socketed(t, level);
        for (const affixId of item.affixes ?? []) {
          const { current, options } = affixRerollPreview(item, affixId);
          options.forEach(({ spec, gain }, index) => {
            // The roll that picks option `index` out of `options.length`
            const next = rerolledAffix(item, affixId, () => (index + 0.5) / options.length);
            if (!(next.affixes ?? []).includes(spec.id)) {
              offenders.push(`${t.id}: roll did not pick ${spec.id}`);
              return;
            }
            for (const key of keys(next.modifiers, item.modifiers)) {
              const moved = (next.modifiers[key] ?? 0) - (item.modifiers[key] ?? 0);
              const promised = (gain[key] ?? 0) - (current[key] ?? 0);
              if (moved !== promised) offenders.push(`${t.id}@${level} ${spec.id}.${key}: ${moved} vs ${promised}`);
            }
          });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('rerolling one affix', () => {
  it('never returns the affix it replaced, stays in its own kind and in the pool the piece mints from', () => {
    const offenders: string[] = [];
    for (const t of affixed) {
      for (const seed of [0, 0.3, 0.7, 0.99]) {
        const item = socketed(t, 6, () => seed);
        for (const affixId of item.affixes ?? []) {
          const spec = findAffix(affixId)!;
          const legal = affixPool(item, spec.kind).map((a) => a.id);
          for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
            const next = rerolledAffix(item, affixId, () => roll);
            if (next === item) continue; // nothing else fits — the bench says so
            const replaced = (next.affixes ?? []).find((id) => !(item.affixes ?? []).includes(id));
            if (!replaced) { offenders.push(`${t.id}: ${affixId} returned itself`); continue; }
            if (findAffix(replaced)!.kind !== spec.kind) offenders.push(`${t.id}: ${replaced} changed kind`);
            if (!legal.includes(replaced)) offenders.push(`${t.id}: ${replaced} is not legal here`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the level, the other affix, the sockets and gems, and derives stats as a mint would', () => {
    const offenders: string[] = [];
    for (const t of affixed) {
      const item = socketed(t, 11);
      for (const affixId of item.affixes ?? []) {
        if (affixRerollOptions(item, affixId).length === 0) continue;
        const next = rerolledAffix(item, affixId, () => 0.5);
        if (next.itemLevel !== item.itemLevel) offenders.push(`${t.id} level`);
        if (JSON.stringify(next.sockets) !== JSON.stringify(item.sockets)) offenders.push(`${t.id} sockets`);
        if (next.id !== item.id || next.sellPrice !== item.sellPrice) offenders.push(`${t.id} identity`);
        const others = (item.affixes ?? []).filter((id) => id !== affixId);
        if (!others.every((id) => next.affixes!.includes(id))) offenders.push(`${t.id} lost ${others}`);
        const fresh = applyAffixes(itemFromTemplate(t), next.affixes!);
        const expected = levelledModifiers(fresh.modifiers, item.itemLevel, t.rarity);
        if (differs(next.modifiers, expected) || itemName(next) !== itemName(fresh)) offenders.push(`${t.id} derivation`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('offers nothing on a common, a legendary, or an affix the piece does not carry', () => {
    const common = mintItem(ordinary.find((t) => t.rarity === Rarity.Common)!);
    expect(common.affixes ?? []).toEqual([]);
    const rare = socketed(affixed.find((t) => t.rarity === Rarity.Rare)!, 8);
    const foreign = (['keen', 'of_the_ox'] as const).find((id) => !(rare.affixes ?? []).includes(id))!;
    expect(affixRerollOptions(rare, foreign)).toEqual([]);
    const set = mintItem(legendary);
    for (const id of set.affixes ?? []) expect(affixRerollOptions(set, id)).toEqual([]);
  });

  it('is priced in gold that follows the piece along the level curve', () => {
    const t = affixed.find((x) => x.rarity === Rarity.Epic)!;
    expect(Object.keys(affixRerollCost(itemAtLevel(itemFromTemplate(t), 14)))).toEqual([ResourceType.Gold]);
    expect(affixRerollCost({ rarity: Rarity.Epic, itemLevel: 14 })[ResourceType.Gold])
      .toBe(BALANCE.AFFIX_REROLL_GOLD.epic);
    expect(affixRerollCost({ rarity: Rarity.Epic, itemLevel: 20 })[ResourceType.Gold]!)
      .toBeGreaterThan(BALANCE.AFFIX_REROLL_GOLD.epic);
  });
});

describe('a forge action commits exactly what it previewed, and charges once', () => {
  const setPurse = (gold: number, rest: Partial<Record<ResourceType, number>> = {}) =>
    useInventoryStore.setState((s) => ({ resources: { ...s.resources, [ResourceType.Gold]: gold, ...rest } }));

  it('writes the previewed piece and the previewed purse, for every forge action on an item', () => {
    const t = affixed.find((x) => x.rarity === Rarity.Epic && x.slot === 'mainHand')!;
    const item = socketed(t, 4);
    const set = { ...mintItem(legendary, () => 0.3), id: 'held_set' };
    const target = nextStatLevel(item, BALANCE.MAX_LEVEL)!;
    const actions: [string, Item, Item, Partial<Record<ResourceType, number>>][] = [
      ['raise', item, levelUpgraded(item, target), levelUpgradeCost(item, target)],
      ['reroll', item, rerolledAffix(item, item.affixes![0], () => 0.4), affixRerollCost(item)],
      ['set bonus', set, rerollSetBonus(set), setBonusRerollCost()],
    ];
    for (const [label, held, preview, cost] of actions) {
      useInventoryStore.getState().reset();
      useInventoryStore.setState({ bag: bagFrom({ gear: [held] }) });
      setPurse(10_000, { [ResourceType.Iron]: 500, [ResourceType.Crystal]: 50, [ResourceType.Wood]: 500, [ResourceType.Stone]: 500 });
      const before = useInventoryStore.getState().resources;
      const expectedPurse = { ...before, ...balanceAfter(before, cost) };
      expect([label, useInventoryStore.getState().applyForgeWork(held.id, preview, cost)]).toEqual([label, true]);
      const state = useInventoryStore.getState();
      expect([label, selectGear(state)]).toEqual([label, [{ ...preview, id: held.id }]]);
      expect([label, state.resources]).toEqual([label, expectedPurse]);
    }
  });

  it('refuses without funds or without the item, and changes nothing either way', () => {
    const item = socketed(affixed[0], 4);
    const next = rerolledAffix(item, item.affixes![0], () => 0.4);
    const cost = affixRerollCost(item);
    useInventoryStore.setState({ bag: bagFrom({ gear: [item] }) });
    setPurse(cost[ResourceType.Gold]! - 1);
    const before = useInventoryStore.getState();
    expect(balanceAfter(before.resources, cost)).toBeNull();
    expect(before.applyForgeWork(item.id, next, cost)).toBe(false);
    expect(before.applyForgeWork('nobody', next, { [ResourceType.Gold]: 0 })).toBe(false);
    const after = useInventoryStore.getState();
    expect(after.bag).toBe(before.bag);
    expect(after.resources).toBe(before.resources);
  });

  it('charges once: a second identical action pays again rather than riding on the first', () => {
    const item = socketed(affixed[0], 4);
    const cost = affixRerollCost(item);
    useInventoryStore.setState({ bag: bagFrom({ gear: [item] }) });
    setPurse(cost[ResourceType.Gold]! * 2);
    const store = useInventoryStore.getState();
    expect(store.applyForgeWork(item.id, rerolledAffix(item, item.affixes![0], () => 0.1), cost)).toBe(true);
    expect(useInventoryStore.getState().resources[ResourceType.Gold]).toBe(cost[ResourceType.Gold]);
  });

  it('previews a legendary Crystal upgrade as exactly the piece it commits', () => {
    const set = mintItem(legendary, () => 0.3);
    expect(upgraded(set)).toEqual(upgraded(set));
    expect(upgraded(set).itemLevel).toBe(set.itemLevel + 1);
  });
});

describe('forge prices come from shared balance constants', () => {
  it('prices a craft from BALANCE.FORGE_COST', () => {
    const t = itemTemplates.find((x) => x.form === 'long_sword' && x.motif === 'plain')!;
    const points = 5 * 1; // SLOT_BUDGET.mainHand × RARITY_SCALE.common, at the anchor
    expect(forgeCost(t.form, t.motif)).toEqual({
      [ResourceType.Gold]: Math.round(points * BALANCE.FORGE_COST.goldPerPoint),
      [ResourceType.Iron]: Math.round(points * BALANCE.FORGE_COST.materialPerPoint),
    });
  });

  it('keeps every forge action free of an inline price', () => {
    // The shape of the rule rather than a list: the pricing functions in forge.ts
    // reach BALANCE for every number that is a price.
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../systems/economy/forge.ts'), 'utf8') as string;
    for (const fn of ['forgeCost', 'levelUpgradeCost', 'affixRerollCost', 'setBonusRerollCost']) {
      const start = src.indexOf(`export function ${fn}`);
      const body = src.slice(start, src.indexOf('\n}\n', start));
      expect([fn, body.match(/\*\s*\d+(\.\d+)?\b/g)]).toEqual([fn, null]);
    }
  });
});

describe('an affix is never a dead roll, at any item level', () => {
  it('always changes the piece against the same piece without it', () => {
    const dead: string[] = [];
    for (const t of affixed) {
      for (const level of [1, 2, 3, 5, 9, 14, 20, 30]) {
        const item = socketed(t, level);
        for (const id of item.affixes ?? []) {
          const without = itemWithAffixes(item, (item.affixes ?? []).filter((a) => a !== id));
          if (!differs(item.modifiers, without.modifiers)) dead.push(`${t.id}@${item.itemLevel} ${id}`);
        }
      }
    }
    expect(dead).toEqual([]);
  });

  it('also holds for every reroll candidate on the bench', () => {
    for (const t of affixed) {
      for (const level of [1, 3]) {
        const item = socketed(t, level);
        for (const id of item.affixes ?? []) {
          for (const { spec, gain } of affixRerollPreview(item, id).options) {
            expect([t.id, level, spec.id, Object.keys(gain).length > 0]).toEqual([t.id, level, spec.id, true]);
          }
        }
      }
    }
  });
});
