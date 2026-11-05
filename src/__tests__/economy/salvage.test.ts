import { isSalvageable, salvageOutcome, salvageYield, setGems } from '@/systems/economy/salvage';
import { forgeCost } from '@/systems/economy/forge';
import { itemTemplates } from '@/data/items/itemTemplates';
import { GemId, Rarity, ResourceType } from '@/models/types';

describe('salvageYield', () => {
  // Selling pays gold, salvaging pays materials. If salvage also paid gold it
  // would just be selling at a worse rate, and nobody would ever use it.
  it('never returns gold', () => {
    for (const t of itemTemplates) {
      expect({ id: t.id, gold: salvageYield(t)[ResourceType.Gold] })
        .toEqual({ id: t.id, gold: undefined });
    }
  });

  it('returns something for every item in the library', () => {
    const empty = itemTemplates.filter((t) => !isSalvageable(t)).map((t) => t.id);
    expect(empty).toEqual([]);
  });

  it('returns less than forging the same item costs', () => {
    for (const t of itemTemplates) {
      const cost = forgeCost(t.form, t.motif);
      for (const [resource, amount] of Object.entries(salvageYield(t)) as [ResourceType, number][]) {
        const paid = cost[resource] ?? 0;
        expect({ id: t.id, resource, loses: amount < paid || paid <= 1 })
          .toEqual({ id: t.id, resource, loses: true });
      }
    }
  });

  it('scales with rarity, so an epic is worth breaking down', () => {
    const plain = itemTemplates.find((t) => t.id === 'long_sword_plain')!;
    const fire = itemTemplates.find((t) => t.id === 'long_sword_fire')!;
    expect(salvageYield(fire)[ResourceType.Iron]!)
      .toBeGreaterThan(salvageYield(plain)[ResourceType.Iron]!);
  });

  it('returns crystal for elemental items, which is the scarce forge input', () => {
    expect(salvageYield(itemTemplates.find((t) => t.id === 'long_sword_ice')!)[ResourceType.Crystal])
      .toBeGreaterThan(0);
  });

  it('matches the material the item is made of', () => {
    const bow = itemTemplates.find((t) => t.id === 'bow_plain')!;
    const cuirass = itemTemplates.find((t) => t.id === 'plate_chest_plain')!;
    expect(salvageYield(bow)[ResourceType.Wood]).toBeGreaterThan(0);
    expect(salvageYield(cuirass)[ResourceType.Stone]).toBeGreaterThan(0);
  });

  it('handles uniques, which have hand-set stats but still declare a form', () => {
    const excalibur = itemTemplates.find((t) => t.id === 'excalibur')!;
    expect(Object.keys(salvageYield(excalibur)).length).toBeGreaterThan(0);
  });
});

describe('set gems', () => {
  // Playtest 2026-10-23b: the anvil breaks the metal, not the stones
  it('come back whole when their piece is salvaged, empty sockets ignored', () => {
    const sockets: (GemId | null)[] = ['ruby_cut', null, 'jade_brilliant'];
    const piece = { ...itemTemplates[0], sockets, itemLevel: 1, rarity: Rarity.Rare };
    expect(setGems(piece)).toEqual(['ruby_cut', 'jade_brilliant']);
    expect(salvageOutcome(piece).gems)
      .toEqual(['ruby_cut', 'jade_brilliant']);
    expect(setGems({})).toEqual([]);
  });
});
