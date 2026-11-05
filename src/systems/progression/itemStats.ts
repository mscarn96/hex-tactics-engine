import { Item, ItemModifiers } from '@/models/types';
import { gemBonus } from '@/data/items/gems';

/**
 * What an equipped item adds to a sheet. **The only answer to that question.**
 *
 * Item level — a legendary's Crystal levels past the cap included — is baked
 * into `modifiers` whenever it changes. Socketed gems are added here afterward,
 * so no item level can ever
 * multiply a gem. The character sheet (`statCalc`, and therefore combat), the
 * equip comparison (`modifierDelta`) and every modifier line the interface
 * prints go through here, so when that seam fills every view gets it at once.
 */
export function effectiveModifiers(item: Pick<Item, 'modifiers' | 'sockets'>): ItemModifiers {
  const result = { ...item.modifiers };
  for (const gem of item.sockets ?? []) {
    if (!gem) continue;
    const { stat, value } = gemBonus(gem);
    result[stat] = (result[stat] ?? 0) + value;
  }
  return result;
}
