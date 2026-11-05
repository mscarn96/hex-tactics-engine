import { HeroClass, Rarity } from '@/models/types';
import { itemTemplates } from '@/data/items/itemTemplates';
import { buildScenario, defaultScenario } from '@/systems/sim/scenarioCreator';
import { defaultHeroConfig, simAutoSpend, simSlotItem } from '@/systems/sim/simHarness';
import {
  dropIllegal, findItems, itemFacts, quickFill, wearerOf, withLevel, withoutHero, withPath, wornItems,
} from '@/systems/sim/scenarioItems';
import { itemName } from '@/data/items/itemText';

const ALL = [Rarity.Common, Rarity.Rare, Rarity.Epic, Rarity.Legendary];

describe('Save Creator gear search', () => {
  it('narrows by slot, rarity, text and stat, and sorts by the stat', () => {
    const rings = findItems({ slot: 'ring2', rarities: [Rarity.Rare] });
    expect(rings.length).toBeGreaterThan(0);
    expect(rings.every((i) => i.slot === 'ring' && i.rarity === Rarity.Rare)).toBe(true);

    const crit = findItems({ slot: null, rarities: ALL, stat: 'critChance' });
    expect(crit.length).toBeGreaterThan(1);
    for (let i = 1; i < crit.length; i++) {
      expect(crit[i - 1].modifiers.critChance!).toBeGreaterThanOrEqual(crit[i].modifiers.critChance!);
    }

    const name = itemName(itemTemplates[0]);
    expect(findItems({ slot: null, rarities: ALL, text: name.toUpperCase() }).map((i) => i.templateId)).toContain(itemTemplates[0].id);
  });

  it('offers only what the hero may wear when asked to', () => {
    const mage = defaultHeroConfig('mage', 10);
    const legal = findItems({ slot: 'mainHand', rarities: ALL, wearer: wearerOf(mage), worn: {} });
    const all = findItems({ slot: 'mainHand', rarities: ALL });
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.length).toBeLessThan(all.length);
  });

  it('says what a weapon does', () => {
    const bow = simSlotItem('bow_iron')!;
    const text = itemFacts(bow).map((l) => l.text).join('\n');
    expect(text).toMatch(/Worn by:/);
    expect(text).toMatch(/Basic attack: ranged/);
  });
});

describe('Save Creator hero edits', () => {
  it('quick-fills every slot a path can dress, legally', () => {
    for (const [id, path] of [['ranger', 'shadowblade'], ['warrior', 'templar'], ['mage', 'pyromancer'], ['healer', 'stoneshaper']] as const) {
      const hero = quickFill(withPath(defaultHeroConfig(id, 20), path), Rarity.Rare);
      expect(Object.keys(hero.equipment).length).toBeGreaterThanOrEqual(8);
      expect(() => buildScenario({ ...defaultScenario(), party: [hero] })).not.toThrow();
    }
  });

  it('prefers the path’s own set at legendary', () => {
    const hero = quickFill(withPath(defaultHeroConfig('warrior', 20), 'templar'), Rarity.Legendary);
    const worn = wornItems(hero);
    expect(worn.chest?.masteryLock).toContain('templar');
    expect(worn.mainHand?.masteryLock).toContain('templar');
  });

  it('keeps the skills a lower level can still afford', () => {
    const path = withPath(defaultHeroConfig('warrior', 20), 'templar');
    const full = { ...path, masteryNodes: simAutoSpend(path) };
    const lower = withLevel(full, 10);
    expect(lower.masteryNodes.length).toBeGreaterThan(0);
    expect(lower.masteryNodes.length).toBeLessThan(full.masteryNodes.length);
    expect(full.masteryNodes.slice(0, lower.masteryNodes.length)).toEqual(lower.masteryNodes);
    expect(() => buildScenario({ ...defaultScenario(), party: [lower] })).not.toThrow();
    expect(withLevel(full, 3)).toMatchObject({ masteryPath: null, masteryNodes: [] });
  });

  it('lets the piece just picked win over the one it clashes with', () => {
    const twoHander = itemTemplates.find((t) => t.handRule === 'twoHanded' && t.classLock?.includes(HeroClass.Warrior) && !t.masteryLock)!;
    const shielded = { ...defaultHeroConfig('warrior', 10), equipment: { mainHand: 'long_sword_iron', offHand: 'round_shield_iron' } };
    const swapped = dropIllegal({ ...shielded, equipment: { ...shielded.equipment, mainHand: twoHander.id } }, 'mainHand');
    expect(swapped.equipment).toEqual({ mainHand: twoHander.id });
  });

  it('moves per-hero settings down when a hero leaves', () => {
    const recipe = { ...defaultScenario(), party: [defaultHeroConfig('warrior', 5), defaultHeroConfig('mage', 5), defaultHeroConfig('healer', 5)],
      equipmentSettings: { '0.mainHand': { level: 3 }, '2.head': { level: 4 } }, heroState: { 1: { mana: 0 }, 2: { hp: 1 } } };
    const next = withoutHero(recipe, 1);
    expect(next.party.map((h) => h.templateId)).toEqual(['warrior', 'healer']);
    expect(next.equipmentSettings).toEqual({ '0.mainHand': { level: 3 }, '1.head': { level: 4 } });
    expect(next.heroState).toEqual({ 1: { hp: 1 } });
  });
});
