import { rollRandomItem } from '@/systems/economy/lootGenerator';
import { Rarity } from '@/models/types';
import { createRNG } from '@/utils/rng';

/**
 * A form's share of drops is not its share of the catalogue.
 *
 * The roll picks a form uniformly inside the rarity and slot it has settled,
 * and only then a template of that form — so a silhouette that gains motifs, or
 * the named variants the item epic has planned, does not become the commonest
 * thing on the ground by existing in more rows. Stated against a mocked library
 * where one form has five entries and the other one, because the shipped
 * library's composition moves and this is a rule about the mechanism.
 */
jest.mock('@/data/items/itemTemplates', () => {
  // Inside the factory: `jest.mock` is hoisted above anything declared beside it
  const entry = (id: string, form: string) => ({
    id, name: id, description: '', rarity: 'common', slot: 'chest', form, motif: 'iron',
    modifiers: { defense: 1 }, sellPrice: 1,
  });
  return {
    itemTemplates: [
      entry('lone_a', 'form_a'),
      ...[1, 2, 3, 4, 5].map((n) => entry(`many_b_${n}`, 'form_b')),
    ],
  };
});

it('draws each form at the same rate however many entries it has', () => {
  const r = createRNG(5);
  const rng = () => r.next();
  let a = 0;
  const ROLLS = 6000;
  for (let i = 0; i < ROLLS; i++) {
    if (rollRandomItem(Rarity.Common, { rng })!.form === ('form_a' as never)) a++;
  }
  // One template against five: by rows this would be a sixth
  expect(Math.abs(a / ROLLS - 0.5)).toBeLessThan(0.03);
});
