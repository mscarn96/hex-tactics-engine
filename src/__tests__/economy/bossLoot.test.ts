import {
  LootWearer, ownedTemplateIds, rollBossLoot, rollChest, rollLairChest, rollLoot, wearableByParty,
} from '@/systems/economy/lootGenerator';
import { summitGuaranteedPieces } from '@/systems/economy/jadeveilRewards';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { itemTemplates } from '@/data/items/itemTemplates';
import { inWorld } from '@/data/items/worldGear';
import { BALANCE } from '@/data/balanceConstants';
import { HeroClass, Rarity } from '@/models/types';
import { createRNG } from '@/utils/rng';

const party: LootWearer[] = [{ heroClass: HeroClass.Warrior, masteryPath: 'berserker' }];
const bosses = enemyTemplates.filter((enemy) => enemy.tier === 'boss');
const rngFor = (seed: number) => {
  const random = createRNG(seed);
  return () => random.next();
};
const kills = (boss: (typeof bosses)[number], count: number, options = {}) =>
  Array.from({ length: count }, (_, i) => rollLoot([boss], { party, rng: rngFor(i + 1), ...options }));
const BOSS_ONLY = { dragon: 'dragon_scale_armor', troll_chieftain: 'chieftain_club', heart_of_winter: 'heartfrost_staff', kairen: 'kairens_fang',
  aethelred: 'last_legion_crown', jorogumo: 'widows_needle', last_lesson: 'silent_lesson_staff',
};

describe('what a boss kill pays', () => {
  it('is 1-2 Legendaries and 2-4 Epics and Rares for every boss, kill after kill', () => {
    const { min, max } = BALANCE.BOSS_LOOT.OTHER_ITEMS;
    for (const boss of bosses) {
      const seen = new Set<number>();
      for (const items of kills(boss, 200)) {
        const legendaries = items.filter((item) => item.rarity === Rarity.Legendary);
        const others = items.filter((item) => item.rarity !== Rarity.Legendary);
        expect(legendaries.length).toBeGreaterThanOrEqual(1);
        expect(legendaries.length).toBeLessThanOrEqual(2);
        expect(others.length).toBeGreaterThanOrEqual(min);
        expect(others.length).toBeLessThanOrEqual(max);
        expect(others.every((item) => item.rarity === Rarity.Epic || item.rarity === Rarity.Rare)).toBe(true);
        seen.add(legendaries.length);
      }
      // the second Legendary is a chance: sometimes there, never certain
      expect([...seen].sort()).toEqual([1, 2]);
    }
  });

  it('varies the Legendaries, includes mastery set pieces and favors wearable gear', () => {
    const boss = { ...bosses[0], lootTable: [] };
    const templates = kills(boss, 400).flat()
      .filter((item) => item.rarity === Rarity.Legendary)
      .map((item) => itemTemplates.find((template) => template.id === item.templateId)!);
    expect(new Set(templates.map((template) => template.id)).size).toBeGreaterThan(10);
    expect(templates.some((template) => template.masteryLock?.includes('berserker'))).toBe(true);
    expect(templates.filter((template) => wearableByParty(template, party)).length / templates.length).toBeGreaterThan(0.6);
    expect(templates.some((template) => !wearableByParty(template, party))).toBe(true);
  });

  it('never pays one piece twice in a kill while the pool has others', () => {
    for (const boss of bosses) {
      for (const items of kills(boss, 100)) {
        const legendaries = items.filter((item) => item.rarity === Rarity.Legendary).map((item) => item.templateId);
        expect(new Set(legendaries).size).toBe(legendaries.length);
      }
    }
  });
});

describe('a boss\'s own item', () => {
  const bossOnly = itemTemplates.filter((template) => template.bossOnly);

  it('is each template named in exactly one boss\'s loot table, and the four known ones are', () => {
    expect(Object.fromEntries(bosses.filter((b) => b.lootTable?.length).map((b) => [b.id, b.lootTable!.map((e) => e.templateId)])))
      .toEqual(Object.fromEntries(Object.entries(BOSS_ONLY).map(([boss, id]) => [boss, [id]])));
    expect(bossOnly.map((t) => t.id).sort()).toEqual(Object.values(BOSS_ONLY).sort());
    for (const template of bossOnly) expect(template.rarity).toBe(Rarity.Legendary);
    for (const boss of bosses) for (const entry of boss.lootTable ?? []) {
      expect(itemTemplates.find((t) => t.id === entry.templateId)?.bossOnly).toBe(true);
    }
  });

  it.each(Object.entries(BOSS_ONLY))('drops %s\'s %s at a chance, never guaranteed', (bossId, templateId) => {
    const boss = bosses.find((b) => b.id === bossId)!;
    const world = ['kairen', 'jorogumo', 'last_lesson'].includes(bossId) ? { world: 'jadeveil' as const } : {};
    const runs = kills(boss, 600, world);
    const dropped = runs.filter((items) => items.some((item) => item.templateId === templateId)).length;
    expect(dropped).toBeGreaterThan(0);
    expect(dropped).toBeLessThan(runs.length);
    expect(dropped / runs.length).toBeGreaterThan(BALANCE.BOSS_LOOT.ONLY_ITEM_CHANCE * 0.6);
    expect(dropped / runs.length).toBeLessThan(BALANCE.BOSS_LOOT.ONLY_ITEM_CHANCE * 1.5);
    // it stands in for a Legendary, so it never lifts the count above two
    for (const items of runs) expect(items.filter((i) => i.rarity === Rarity.Legendary).length).toBeLessThanOrEqual(2);
  });

  it('drops from no other boss, chest or roll', () => {
    const ids = new Set(bossOnly.map((template) => template.id));
    const found: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const options = { party, rng: rngFor(seed) };
      for (const boss of bosses) {
        const withoutTable = { ...boss, lootTable: undefined };
        const own = new Set(boss.lootTable?.map((e) => e.templateId));
        for (const item of rollLoot([withoutTable], options)) found.push(item.templateId);
        for (const item of rollLoot([boss], { ...options, rng: rngFor(seed) })) {
          if (ids.has(item.templateId) && !own.has(item.templateId)) found.push(item.templateId);
        }
      }
      for (const item of [
        ...rollChest(['berserker'], options),
        ...rollLairChest('legendary', ['berserker'], options),
        ...rollLairChest('epics', ['berserker'], options),
        ...summitGuaranteedPieces({ ...options, world: 'jadeveil' }),
      ]) found.push(item.templateId);
    }
    expect(found.filter((id) => ids.has(id))).toEqual([]);
  });

  it('is not rolled for once the party owns it', () => {
    const dragon = bosses.find((b) => b.id === 'dragon')!;
    const owned = ownedTemplateIds([{ templateId: 'dragon_scale_armor' }]);
    for (const items of kills(dragon, 300, { owned })) {
      expect(items.some((item) => item.templateId === 'dragon_scale_armor')).toBe(false);
    }
  });
});

describe('Legendary rolls skip what the party owns', () => {
  const pool = itemTemplates.filter((t) => t.rarity === Rarity.Legendary && !t.bossOnly && inWorld(t, 'empire'));
  const wearable = pool.filter((t) => wearableByParty(t, party));
  const legendaryIds = (items: { rarity: Rarity; templateId: string }[]) =>
    items.filter((i) => i.rarity === Rarity.Legendary).map((i) => i.templateId);

  // Forty pieces left unowned: a kill or a chest pays a few Legendaries and
  // marks each owned as it goes, so the pool must outlast one roll
  const left = new Set(pool.slice(0, 40).map((t) => t.id));
  const owned = new Set(pool.slice(40).map((t) => t.id));

  it('draws only what is not owned yet, and never the same piece twice in one roll', () => {
    const boss = { ...bosses[0], lootTable: [] };
    for (const items of kills(boss, 100, { owned })) {
      const ids = legendaryIds(items);
      for (const id of ids) expect(left.has(id)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('applies to chests as well as bosses', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const options = { party, owned, rng: rngFor(seed) };
      for (const items of [rollLairChest('legendary', ['berserker'], options), rollChest(['berserker'], options)]) {
        const ids = legendaryIds(items);
        for (const id of ids) expect(left.has(id)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('falls back to the rest of the pool when the hero\'s wearable pieces are all owned', () => {
    const owned = new Set(wearable.map((t) => t.id));
    const boss = { ...bosses[0], lootTable: [] };
    const ids = kills(boss, 100, { owned }).flatMap(legendaryIds);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(owned.has(id)).toBe(false);
      expect(pool.some((t) => t.id === id)).toBe(true);
    }
  });

  it('allows repeats once everything is owned', () => {
    const owned = new Set(pool.map((t) => t.id));
    const boss = { ...bosses[0], lootTable: [] };
    for (const items of kills(boss, 50, { owned })) {
      expect(items.filter((i) => i.rarity === Rarity.Legendary).length).toBeGreaterThanOrEqual(1);
    }
    const ids = kills(boss, 50, { owned }).flatMap(legendaryIds);
    expect(ids.every((id) => owned.has(id))).toBe(true);
  });

  it('leaves the owned set the caller passed untouched', () => {
    const owned = new Set<string>();
    kills(bosses[0], 20, { owned });
    rollChest(['berserker'], { party, owned });
    expect(owned.size).toBe(0);
  });
});
