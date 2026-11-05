import { heroWearsLine, itemKindLabel, itemRarityKind, partyWearerLine } from '@/data/display/itemDisplay';
import { itemTemplates } from '@/data/items/itemTemplates';
import { armourWeightOf } from '@/data/items/itemForms';
import { itemFromTemplate } from '@/systems/economy/itemFactory';
import { couldWear, offHandKindsFor } from '@/systems/progression/equipRules';
import { HeroClass } from '@/models/types';
import { makeHero } from '../support/fixtures';

/**
 * What kind of piece it is and who in the party could wear it (playtest
 * 2026-10-30): the card names an armour's weight, the counters name heroes,
 * and the gear tab names what a hero takes — each from the rules `canEquip` asks.
 */

const plate = itemTemplates.find((t) => armourWeightOf(t.form) === 'plate' && !t.masteryLock?.length)!;
const shield = itemTemplates.find((t) => t.slot === 'offHand' && t.offHandKind === 'shield')!;
const ring = itemTemplates.find((t) => t.slot === 'ring')!;

it('names every armour piece\'s weight and every off-hand\'s kind, and nothing for a ring', () => {
  for (const template of itemTemplates) {
    const weight = armourWeightOf(template.form);
    if (weight) expect(itemKindLabel(template)).toBeTruthy();
  }
  expect(itemKindLabel(plate)).toBe('Plate armour');
  expect(itemKindLabel(shield)).toBe('Shield');
  expect(itemKindLabel(ring)).toBeUndefined();
  expect(itemRarityKind(plate)).toMatch(/· Plate armour$/);
});

it('names the party members who could wear a piece, by the equip rules', () => {
  const champion = makeHero({ id: 'c', name: 'Aldric', heroClass: HeroClass.Warrior, masteryPath: null });
  const mage = makeHero({ id: 'm', name: 'Ysolde', heroClass: HeroClass.Mage, masteryPath: null });
  const item = itemFromTemplate(plate);
  expect(couldWear(champion, item)).toBe(true);
  expect(couldWear(mage, item)).toBe(false);
  expect(partyWearerLine(item, [champion, mage])).toBe('In your party: Aldric');
  expect(partyWearerLine(item, [mage])).toBe('Nobody in your party can wear it');
});

it('says what a hero wears: the path narrows the weights, a Berserker trades the shield for a second weapon', () => {
  const monk = { heroClass: HeroClass.Monk, masteryPath: null };
  expect(heroWearsLine(monk)).toMatch(/Plate armour/);
  expect(heroWearsLine(monk)).toMatch(/Hide armour/);
  expect(heroWearsLine(monk)).toMatch(/Vestments/);
  expect(heroWearsLine({ heroClass: HeroClass.Monk, masteryPath: 'beetle' })).not.toMatch(/Hide armour|Vestments/);
  expect(offHandKindsFor({ heroClass: HeroClass.Warrior, masteryPath: 'bulwark' })).toEqual(['shield']);
  expect(offHandKindsFor({ heroClass: HeroClass.Warrior, masteryPath: 'berserker' })).toEqual(['weapon']);
});
