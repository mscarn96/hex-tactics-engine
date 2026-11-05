import { HeroClass } from '@/models/types';
import type { WorldId } from '@/data/worlds';
import { entryText } from '@/i18n/dataText';

/**
 * The expansions a player can own, as products.
 *
 * Ownership is about the **player and the device**, never the campaign: it is
 * held in the preferences record (`systems/save/preferences.ts`), outlives every
 * new campaign, and is read through `stores/entitlementStore.ts`. What an
 * expansion opens *inside* a campaign is a separate question — the Jadeveil gate
 * also waits for Aethelred, and so do its five levels — and is answered by the
 * systems that read both (`worldTravel.gateState`, `data/levelCap.ts`).
 *
 * See `docs/quests-progression-items.md`#expansion-ownership`.
 */
export type ExpansionId = 'jadeveil';

export const EXPANSION_IDS: readonly ExpansionId[] = ['jadeveil'];

export interface ExpansionDef {
  id: ExpansionId;
  /**
   * The store product id, the same on both stores. A non-consumable: one
   * purchase, restorable on any device signed into the same store account.
   */
  productId: string;
  /** The world it opens, from the Empire's world gate. */
  world: WorldId;
  /** The class an owner may start as or recruit, in any campaign. */
  heroClass: HeroClass;
}

export const EXPANSIONS: Readonly<Record<ExpansionId, ExpansionDef>> = {
  jadeveil: {
    id: 'jadeveil',
    productId: 'engine.expansion.jadeveil',
    world: 'jadeveil',
    heroClass: HeroClass.Monk,
  },
};

/** What the store and the game call an expansion ("The Jadeveil Ascent"), from the `world` namespace. */
export const expansionTitle = (id: ExpansionId): string => entryText('world', `expansion.${id}`, 'title');

/** The expansion whose class this is, if any. */
export function expansionOfClass(heroClass: HeroClass): ExpansionId | null {
  return EXPANSION_IDS.find((id) => EXPANSIONS[id].heroClass === heroClass) ?? null;
}
