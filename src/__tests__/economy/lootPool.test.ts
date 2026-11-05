import { rollRandomItem, SLOT_DROP_WEIGHT } from '@/systems/economy/lootGenerator';
import { itemTemplates } from '@/data/items/itemTemplates';
import { FORMS, pathsOfClass } from '@/data/items/itemForms';
import { MOTIF_RARITY } from '@/data/items/motifs';
import { canEquip } from '@/systems/progression/equipRules';
import {
  EQUIP_SLOTS, EquipSlot, HeroClass, Item, ItemSlot, ItemTemplate, MotifId, MasteryId, Rarity,
} from '@/models/types';

/**
 * What the shipped library can actually hand a player.
 *
 * Separate from `lootGenerator.test.ts`, which mocks `itemTemplates` down to
 * four entries to pin the *mechanism*. Every rule here is about the real pool's
 * composition, and a mocked library cannot state any of them — a coverage hole
 * measured against a stub is a hole in the stub.
 *
 * The hole this file was written for: **an Arcanist could not obtain a rare
 * pendant or a rare ring by any route in the game.** Jewellery takes its class
 * from `MOTIF_CLASS`, the three rare motifs were steel, silver and nature, and
 * those are Warrior, Hunter and Druid. Nothing failed, nothing logged, and the
 * item screen looked exactly as it does when a lock is merely a lock.
 */

const DROPPABLE = itemTemplates.filter((t) => !t.masteryLock);
const CLASSES = Object.values(HeroClass);
const DROP_RARITIES = [Rarity.Common, Rarity.Rare, Rarity.Epic];

/** The four weights, keyed by a form each one owns. */
const ARMOUR_WEIGHTS = ['plate', 'hide', 'robe', 'vestment'] as const;

function motifsAt(weight: (typeof ARMOUR_WEIGHTS)[number], rarity: Rarity): MotifId[] {
  return FORMS[`${weight}_chest`].motifs.filter((m) => MOTIF_RARITY[m] === rarity);
}

describe('every armour weight offers the same spread', () => {
  /**
   * 2 common / 2 rare / 3 epic, and the rule is the deliverable — the specific
   * motifs get retuned.
   *
   * Rarity rides on the motif, so the count *is* the size of the drop pool for
   * that weight at that rarity. It used to be 2/1/3 with hide at 2/1/2: a
   * Champion's entire rare armour library was a Steel Helm, Cuirass, Greaves and
   * Sabatons, and a Hunter's epic armour was 10.5% of what the table could hand
   * them against a Champion's 25%. One motif per weight is not a small library,
   * it is a library with no choice in it.
   */
  it('gives every weight exactly two rare and three epic motifs', () => {
    const offenders: string[] = [];
    for (const weight of ARMOUR_WEIGHTS) {
      const counts = {
        common: motifsAt(weight, Rarity.Common).length,
        rare: motifsAt(weight, Rarity.Rare).length,
        epic: motifsAt(weight, Rarity.Epic).length,
      };
      if (counts.common !== 2 || counts.rare !== 2 || counts.epic !== 3) {
        offenders.push(`${weight}: ${counts.common}/${counts.rare}/${counts.epic}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // All four slots of a weight share one motif list, so a spread that is right
  // for the chest is right for the boots — unless somebody starts authoring per
  // slot, which is exactly when this stops being true silently.
  it('gives all four slots of a weight the same list', () => {
    const offenders: string[] = [];
    for (const weight of ARMOUR_WEIGHTS) {
      const chest = FORMS[`${weight}_chest`].motifs.slice().sort().join(',');
      for (const slot of ['head', 'legs', 'feet'] as const) {
        const list = FORMS[`${weight}_${slot}`].motifs.slice().sort().join(',');
        if (list !== chest) offenders.push(`${weight}_${slot}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('every class can dress itself at every tier', () => {
  /**
   * Nine slots × every class × three rarities, asked through `canEquip` — the
   * same predicate the equipment screen asks — rather than by reading
   * `classLock` here, so a lock added anywhere else in the rules is also
   * measured.
   *
   * A slot counts as reachable when the class can fill it before its path or on
   * any of its paths: a path narrows armour and weapons, but the Monk's locked
   * main hand opens only with one.
   */
  const asItem = (t: ItemTemplate): Item => ({ ...t, templateId: t.id, id: `probe_${t.id}`, itemLevel: 1 });

  it('leaves no class without a rare and an epic for every slot', () => {
    const offenders: string[] = [];
    for (const heroClass of CLASSES) {
      const wearers = [null, ...pathsOfClass(heroClass)].map(
        (masteryPath: MasteryId | null) => ({ heroClass, masteryPath }),
      );
      for (const rarity of [Rarity.Rare, Rarity.Epic]) {
        for (const slot of EQUIP_SLOTS) {
          const reachable = DROPPABLE.some(
            (t) => t.rarity === rarity
              && wearers.some((hero) => canEquip(hero, asItem(t), slot, {}).ok),
          );
          if (!reachable) offenders.push(`${heroClass}/${rarity}/${slot}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // The jewellery half stated on its own, because it is the half that broke and
  // the half with no weight or form to fall back on: a pendant's class comes
  // from `MOTIF_CLASS` and from nowhere else, so a rarity whose motifs do not
  // name every class locks somebody out by arithmetic. The Monk is measured
  // here like everyone: it shares the Druid's and the Arcanist's motifs.
  it('names every class in every rarity of jewellery', () => {
    const offenders: string[] = [];
    for (const rarity of DROP_RARITIES) {
      for (const heroClass of CLASSES) {
        const hero = { heroClass, masteryPath: null };
        for (const slot of ['neck', 'ring1'] as EquipSlot[]) {
          const reachable = DROPPABLE.some(
            (t) => t.rarity === rarity
              && (t.slot === 'neck' || t.slot === 'ring')
              && canEquip(hero, asItem(t), slot, {}).ok,
          );
          if (!reachable) offenders.push(`${heroClass}/${rarity}/${slot}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the slot weighting reaches the finished pool', () => {
  const SLOTS = [...new Set(EQUIP_SLOTS.map((s): ItemSlot => (
    s === 'ring1' || s === 'ring2' ? 'ring' : s
  )))];

  /**
   * The analytic half of the distribution claim.
   *
   * `rollRandomItem` renormalises its weights over the slots that have
   * candidates, so the table is the true share **only if no slot is ever
   * empty**. Establish that and the arithmetic is exact, which is worth more
   * than any number of samples — see the note in `lootGenerator.test.ts` about
   * why a sampled split is a suite that goes intermittently red.
   */
  it('fills every slot at every droppable rarity', () => {
    const offenders: string[] = [];
    for (const rarity of DROP_RARITIES) {
      for (const slot of SLOTS) {
        if (!DROPPABLE.some((t) => t.rarity === rarity && t.slot === slot)) {
          offenders.push(`${rarity}/${slot}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // A slot the weight table has never heard of would make `total` NaN and the
  // walk pick the last slot every time — which looks like a working drop table.
  it('prices every slot the library actually ships', () => {
    const unpriced = [...new Set(DROPPABLE.map((t) => t.slot))]
      .filter((s) => !(s in SLOT_DROP_WEIGHT));
    expect(unpriced).toEqual([]);
  });

  /**
   * The sampled half, kept deliberately coarse.
   *
   * Its job is only to catch a walk that ignores the table — an off-by-one in
   * the cumulative loop, or a slot map that collapses — not to measure 4/9 to
   * three places. 20,000 rolls put the standard error on armour's share near
   * 0.35pp against a ±5pp band, so this is roughly a fourteen-sigma bound and
   * cannot flicker.
   */
  it('actually rolls armour four times as often as the main hand', () => {
    const counts: Partial<Record<ItemSlot, number>> = {};
    for (let i = 0; i < 20000; i++) {
      const item = rollRandomItem();
      if (item) counts[item.slot] = (counts[item.slot] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
    const armour = (['head', 'chest', 'legs', 'feet'] as ItemSlot[])
      .reduce((n, s) => n + (counts[s] ?? 0), 0);
    expect(armour / total).toBeGreaterThan(4 / 8 - 0.05);
    expect(armour / total).toBeLessThan(4 / 8 + 0.05);
    expect((counts.mainHand ?? 0) / total).toBeGreaterThan(1 / 8 - 0.05);
    expect((counts.mainHand ?? 0) / total).toBeLessThan(1 / 8 + 0.05);
    /**
     * Rings sit level with the neck and the hands, not at double.
     *
     * Bounded on **both** sides deliberately: the fault this replaced was rings
     * running away with a third of the loot table off a two-form pool, and a
     * one-sided floor is exactly the assertion that would not have noticed.
     */
    expect((counts.ring ?? 0) / total).toBeGreaterThan(1 / 8 - 0.05);
    expect((counts.ring ?? 0) / total).toBeLessThan(1 / 8 + 0.05);
  });
});
