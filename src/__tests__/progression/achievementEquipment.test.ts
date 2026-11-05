import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { itemTemplates } from '@/data/items/itemTemplates';
import { setFormsOf } from '@/data/items/itemForms';
import { mintItem } from '@/systems/economy/itemFactory';
import { matchingSetPieces } from '@/systems/progression/achievementEquipment';
import { buildSimHero, defaultHeroConfig, setLoadout } from '@/systems/sim/simHarness';
import type { EquipSlot, Item, MasteryId } from '@/models/types';

function loadout(path: MasteryId) {
  const slots = setLoadout(path);
  if (path === 'shadowblade') slots.offHand = slots.mainHand;
  if (path === 'berserker') {
    slots.mainHand = itemTemplates.find(t => t.masteryLock?.includes(path) && t.form === 'war_axe')!.id;
    slots.offHand = itemTemplates.find(t => t.masteryLock?.includes(path) && t.form === 'short_sword')!.id;
  }
  return slots;
}

// The six-recipe sets (the Shadowblade's dagger, the Mantis's handblade and the
// Beetle's greatstaff) cannot reach seven; the test below holds the Shadowblade's.
it.each(MASTERY_PATHS.filter(p => setFormsOf(p.id).length === 7))('$name can wear a full seven-piece set', path => {
  const hero = buildSimHero({ ...defaultHeroConfig(path.heroClass, 20), masteryPath: path.id }, item => item.id)!;
  const items: Item[] = [];
  for (const [slot, templateId] of Object.entries(loadout(path.id))) {
    const template = itemTemplates.find(t => t.id === templateId)!;
    const item = { ...mintItem(template, () => 0, 20), id: slot };
    items.push(item);
    hero.equipment[slot as EquipSlot] = item.id;
  }
  expect(matchingSetPieces(hero, items)).toBe(7);
  const first = items[0];
  expect(matchingSetPieces(hero, items.map(i => i.id === first.id ? { ...i, masteryLock: undefined } : i))).toBe(6);
});

it('the six-recipe Shadowblade set cannot complete seven pieces by doubling its dagger, nor can an unrelated unique', () => {
  const hero = buildSimHero({ ...defaultHeroConfig('ranger', 20), masteryPath: 'shadowblade' }, item => item.id)!;
  const items: Item[] = [];
  for (const [slot, templateId] of Object.entries(loadout('shadowblade'))) {
    const item = { ...mintItem(itemTemplates.find(t => t.id === templateId)!, () => 0, 20), id: slot };
    items.push(item);
    hero.equipment[slot as EquipSlot] = item.id;
  }
  hero.equipment.offHand = hero.equipment.mainHand;
  expect(matchingSetPieces(hero, items)).toBe(6);
  hero.equipment.offHand = 'offHand';
  const unique = mintItem(itemTemplates.find(t => t.id === 'excalibur')!, () => 0, 20);
  expect(matchingSetPieces(hero, items.map(i => i.id === 'mainHand' ? { ...unique, id: 'mainHand' } : i))).toBe(6);
});
