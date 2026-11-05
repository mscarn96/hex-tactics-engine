import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from '../support/paths';
import { EQUIP_SLOTS, ItemSlot } from '@/models/types';
import { SLOT_DROP_WEIGHT } from '@/systems/economy/lootGenerator';

/**
 * There is one list of a hero's slots, and it is a balance input.
 *
 * `lootGenerator.SLOT_DROP_WEIGHT` is *derived* by counting `EQUIP_SLOTS` — a
 * slot's share of drops is its share of the body — so that array's length is the
 * denominator of every drop share in the game and each entry moves the loot
 * table. It stopped being a mere iteration helper the moment that derivation
 * landed.
 *
 * `systems/sim/simHarness.ts` used to declare a **second** array of the same
 * name and the same nine entries, and `SimSetupScreen` imports the symbol from
 * *there* — so the app dressed a hero from one list and the tuning harness from
 * another, agreeing only by coincidence. A slot added to one and not the other
 * would have left the harness measuring a hero missing gear the real game hands
 * out, which is exactly the comparison that harness exists to make trustworthy.
 *
 * **Neither TypeScript nor any runtime check could see it.** Both were typed
 * `EquipSlot[]`, and a list missing a member of a union type is perfectly legal.
 * That is the shape of failure `glyphs.test.ts` and `heroNaming.test.ts` exist
 * for, so this follows them: a source scan, because a *new* copy appearing is
 * something nothing at runtime can observe.
 *
 * Exhaustiveness itself is checked at compile time in `models/items.ts` — see
 * `_UnlistedSlot` — since a type cannot be enumerated at runtime.
 */

const OWNER = path.join('models', 'items.ts');

/** Same walk `heroNaming` and `glyphs` use — the source is the only witness here. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('a hero has exactly one list of slots', () => {
  it('is declared in models/items.ts and nowhere else', () => {
    const declaration = /(?:const|let|var)\s+EQUIP_SLOTS\b/;
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => !file.includes('__tests__'))
      .filter((file) => declaration.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC_DIR, file))
      .filter((rel) => rel !== OWNER)
      .sort();

    expect(offenders).toEqual([]);
  });

  /**
   * The drop table's denominator is the body, so a slot the loot roll has never
   * heard of is a slot that can never be filled by a drop.
   *
   * Stated as a relationship rather than as `8`, because the rule survives a
   * retune and the number does not: every item slot a hero can wear carries some
   * weight, and the weights account for every one of them.
   */
  it('gives every wearable slot a share of the drop table', () => {
    const wearable = new Set<ItemSlot>(
      EQUIP_SLOTS.map((s) => (s === 'ring1' || s === 'ring2' ? 'ring' : s)),
    );

    const unrollable = [...wearable].filter((slot) => !(SLOT_DROP_WEIGHT[slot] > 0)).sort();
    expect(unrollable).toEqual([]);

    const phantom = (Object.keys(SLOT_DROP_WEIGHT) as ItemSlot[])
      .filter((slot) => !wearable.has(slot))
      .sort();
    expect(phantom).toEqual([]);
  });
});
