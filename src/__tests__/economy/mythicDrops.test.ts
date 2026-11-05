import { canBeMythic } from '@/data/items/setBonus';
import { itemTemplates } from '@/data/items/itemTemplates';
import { inWorld } from '@/data/items/worldGear';
import { BALANCE } from '@/data/balanceConstants';
import { setLevelCapInputs } from '@/data/levelCap';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { LAIR_SPECS } from '@/locations/lairs';
import { EnemyTemplateId, HeroClass, Item, MasteryId, Rarity } from '@/models/types';
import { victoryRewards } from '@/systems/combat/combatRewards';
import { shopStock } from '@/systems/economy/cityServices';
import { forgeTemplate } from '@/systems/economy/forge';
import { lairChestRewards, summitGuaranteedPieces } from '@/systems/economy/jadeveilRewards';
import {
  LootWearer, rollBossLoot, rollChest, rollChestGuardItem, rollLairChest, rollLoot, rollRandomItem, wearableByParty,
} from '@/systems/economy/lootGenerator';
import { aethelredMythicRoll, heldMythics, mythicChance, mythicDue, mythicRollFor, MythicRoll } from '@/systems/economy/mythicDrops';
import { contentLevel } from '@/systems/world/contentLevel';
import { summitEncounterId, STORM_TIERS } from '@/systems/world/summit';
import { siegeEncounterId } from '@/systems/world/tribute';
import { makeHero, makeUnit } from '@/__tests__/support/fixtures';
import { jadeveilAt } from '@/__tests__/support/bandRoad';
import { createRNG } from '@/utils/rng';

/**
 * Where a mythic comes from, and how often. Seeded, because the balance simulator plays fights and
 * does not roll loot. The numbers belong to `BALANCE.MYTHIC`; this pins what they must do.
 * `MYTHIC_AUDIT=1` prints the table `quests-progression-items.md` quotes.
 */

const seeded = (seed: number) => {
  const rng = createRNG(seed);
  return () => rng.next();
};

const PARTY: LootWearer[] = [
  { heroClass: HeroClass.Warrior, masteryPath: 'templar' },
  { heroClass: HeroClass.Mage, masteryPath: 'pyromancer' },
  { heroClass: HeroClass.Healer, masteryPath: 'lifewarden' },
  { heroClass: HeroClass.Monk, masteryPath: 'firefly' },
];
const MASTERIES = PARTY.map((h) => h.masteryPath!) as MasteryId[];
const HEROES = PARTY.map((h) => makeHero(h));
const CAP = BALANCE.MYTHIC.COUNTER_CAP;
const BANDS = [1, 2, 3, 4];
const boss = (id: string) => enemyTemplates.find((t) => t.id === id)!;
const KAIREN = boss('kairen');
const isMythic = (item: Pick<Item, 'rarity'>) => item.rarity === Rarity.Mythic;
const roll = (over: Partial<MythicRoll> = {}): MythicRoll => ({ chance: 0, kills: 0, held: new Set(), ...over });
const inJadeveil = (mythic: MythicRoll, seed = 1) => ({ party: PARTY, world: 'jadeveil' as const, rng: seeded(seed), mythic });

const STORY_LAIRS = LAIR_SPECS.filter((lair) => lair.world === 'jadeveil');

/** Won fights through the real reward, Math.random seeded for the rolls it does not hand an rng. */
function won(templateId: EnemyTemplateId, encounterId: string, world: 'empire' | 'jadeveil', mythicKills: number, over = {}) {
  const units = [
    makeUnit({ isPlayer: true, currentHp: 10 }),
    makeUnit({ isPlayer: false, templateId, currentHp: 0 }),
  ];
  return victoryRewards({
    units, heroes: HEROES, encounterId, threatBand: 4, castleRun: null, isLastStage: false, world, mythicKills, ...over,
  });
}

afterEach(() => {
  setLevelCapInputs({ owned: [], emperorDefeated: false, banded: [], finished: [] });
  jest.restoreAllMocks();
});

describe('the chance per kill', () => {
  it('rises with every band and every boss tier, and is a chance', () => {
    for (const band of BANDS) {
      for (const tier of STORM_TIERS) {
        const chance = mythicChance(band, tier);
        expect(chance).toBeGreaterThan(0);
        expect(chance).toBeLessThan(1);
        if (band > 1) expect(chance).toBeGreaterThan(mythicChance(band - 1, tier));
        if (tier > 1) expect(chance).toBeGreaterThan(mythicChance(band, tier - 1));
      }
    }
  });

  it('reads the loot\'s band: a story boss the world\'s, a Storm Seal tier the cap\'s', () => {
    setLevelCapInputs(jadeveilAt(1, 35));
    const chanceAt = (encounterId: string) =>
      mythicRollFor(encounterId, contentLevel({ world: 'jadeveil', encounterId }), 0, [])!.chance;
    expect(chanceAt('lair_silk_boss')).toBeCloseTo(mythicChance(1, 1));
    expect(chanceAt('lair_hall_boss')).toBeCloseTo(mythicChance(1, 1));
    expect(chanceAt(summitEncounterId(1))).toBeCloseTo(mythicChance(1, 1));
    expect(chanceAt(summitEncounterId(5))).toBeCloseTo(mythicChance(3, 5));
  });

  it('answers nothing where no boss may drop one: the Empire and a siege', () => {
    setLevelCapInputs(jadeveilAt(1));
    expect(mythicRollFor('lair_wyrm_boss', contentLevel({ world: 'empire', encounterId: 'lair_wyrm_boss' }), 0, [])).toBeNull();
    const siege = siegeEncounterId(3);
    expect(mythicRollFor(siege, contentLevel({ world: 'jadeveil', encounterId: siege }), 0, [])).toBeNull();
  });
});

describe('the bad-luck counter', () => {
  const dry = () => 0.999;

  it('forces one at its cap, and resets', () => {
    expect(mythicDue(CAP - 1, 0, dry)).toBe(false);
    expect(mythicDue(CAP, 0, dry)).toBe(true);
    const ledger = roll();
    const drops = Array.from({ length: CAP * 3 }, () =>
      rollBossLoot(KAIREN, { ...inJadeveil(ledger), rng: dry }).filter(isMythic).length);
    expect(drops.reduce((sum, n) => sum + n, 0)).toBe(3);
    drops.forEach((n, i) => expect(n).toBe((i + 1) % CAP === 0 ? 1 : 0));
    expect(ledger.kills).toBe(0);
  });

  it('counts each eligible kill, and resets on a lucky drop', () => {
    const ledger = roll({ kills: 7, chance: 1 });
    expect(rollBossLoot(KAIREN, inJadeveil(ledger)).filter(isMythic)).toHaveLength(1);
    expect(ledger.kills).toBe(0);
    const unlucky = roll({ kills: 7, chance: 0 });
    expect(rollBossLoot(KAIREN, inJadeveil(unlucky)).filter(isMythic)).toHaveLength(0);
    expect(unlucky.kills).toBe(8);
  });

  it('does not count a kill with nothing left to pay', () => {
    const held = new Set(itemTemplates.filter(canBeMythic).map((t) => t.id));
    const ledger = roll({ kills: CAP - 1, chance: 1, held });
    expect(rollBossLoot(KAIREN, inJadeveil(ledger)).filter(isMythic)).toHaveLength(0);
    expect(ledger.kills).toBe(CAP - 1);
  });

  it('is handed back by a boss fight and not by any other', () => {
    setLevelCapInputs(jadeveilAt(1));
    expect(won('kairen', summitEncounterId(1), 'jadeveil', 3, { heldMythics: [] }).mythicKills).toBeLessThanOrEqual(4);
    expect(won('jorogumo', 'lair_silk_boss', 'jadeveil', CAP - 1).mythicKills).toBe(0);
    expect(won('wyrmling', 'random', 'jadeveil', 3).mythicKills).toBe(3);
    expect(won('dragon', 'lair_wyrm_boss', 'empire', 3).mythicKills).toBeUndefined();
  });
});

describe('Aethelred, the Empire\'s one exception', () => {
  const atCastle = (tier: number, mythicKills: number) =>
    won('aethelred', 'castle', 'empire', mythicKills, { castleRun: { tier, stage: 3 }, isLastStage: true });

  it('reads band 1 at tier 1 and the cap\'s band at a higher Seal tier', () => {
    setLevelCapInputs(jadeveilAt(1, 35));
    expect(aethelredMythicRoll(1, 0, []).chance).toBeCloseTo(mythicChance(1, 1));
    expect(aethelredMythicRoll(4, 0, []).chance).toBeCloseTo(mythicChance(3, 4));
    setLevelCapInputs({ owned: [], emperorDefeated: false, banded: [], finished: [] });
    expect(aethelredMythicRoll(5, 0, []).chance).toBeCloseTo(mythicChance(1, 5));
  });

  it('counts toward the counter, is forced at its cap, and pays only mastery set pieces', () => {
    jest.spyOn(Math, 'random').mockImplementation(seeded(21));
    for (let i = 0; i < 20; i++) {
      const paid = atCastle(1 + (i % 5), CAP - 1);
      expect(paid.mythicKills).toBe(0);
      const mythics = paid.items.filter(isMythic);
      expect(mythics).toHaveLength(1);
      const template = itemTemplates.find((t) => t.id === mythics[0].templateId)!;
      expect(template.masteryLock?.length).toBeGreaterThan(0);
      expect(template.world).toBeUndefined();
    }
    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(atCastle(1, 3).mythicKills).toBe(4);
  });

  it('a castle stage without him rolls nothing', () => {
    jest.spyOn(Math, 'random').mockImplementation(seeded(22));
    const stage = won('dread_knight', 'castle', 'empire', CAP - 1, { castleRun: { tier: 2, stage: 1 } });
    expect(stage.mythicKills).toBeUndefined();
    expect(stage.items.filter(isMythic)).toEqual([]);
  });
});

describe('what a boss pays', () => {
  const dropped = (seed: number, over: Partial<MythicRoll> = {}) =>
    rollBossLoot(KAIREN, inJadeveil(roll({ chance: 1, ...over }), seed)).filter(isMythic);

  it('is at most one mythic a kill, inside the legendary count', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const items = rollBossLoot(KAIREN, inJadeveil(roll({ chance: 1 }), seed));
      expect(items.filter(isMythic)).toHaveLength(1);
      expect(items.filter((i) => i.rarity === Rarity.Legendary || isMythic(i)).length).toBeLessThanOrEqual(2);
    }
  });

  it('is a set piece of this world that a hero can wear, and each hero has their turn', () => {
    const heroesServed = new Set<HeroClass>();
    for (let seed = 1; seed <= 300; seed++) {
      const [piece] = dropped(seed);
      const template = itemTemplates.find((t) => t.id === piece.templateId)!;
      expect(canBeMythic(template)).toBe(true);
      expect(inWorld(template, 'jadeveil')).toBe(true);
      expect(wearableByParty(template, PARTY)).toBe(true);
      for (const hero of PARTY) if (wearableByParty(template, [hero])) heroesServed.add(hero.heroClass);
    }
    expect([...heroesServed].sort()).toEqual(PARTY.map((h) => h.heroClass).sort());
  });

  it('never repeats a piece the party holds as a mythic, and runs dry rather than repeat', () => {
    const wearable = itemTemplates.filter((t) => canBeMythic(t) && inWorld(t, 'jadeveil') && wearableByParty(t, PARTY));
    const ledger = roll({ chance: 1 });
    const seen = new Set<string>();
    for (let i = 0; i < wearable.length; i++) {
      const [piece] = rollBossLoot(KAIREN, inJadeveil(ledger, i + 1)).filter(isMythic);
      expect(seen.has(piece.templateId)).toBe(false);
      seen.add(piece.templateId);
    }
    expect(seen.size).toBe(wearable.length);
    expect(rollBossLoot(KAIREN, inJadeveil(ledger, 999)).filter(isMythic)).toEqual([]);
  });

  it('still pays a mythic of a piece the party holds only as a legendary', () => {
    const owned = new Set(itemTemplates.filter(canBeMythic).map((t) => t.id));
    expect(rollBossLoot(KAIREN, { ...inJadeveil(roll({ chance: 1 })), owned }).filter(isMythic)).toHaveLength(1);
  });

  it('does not pay its mythic again as the second legendary', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const items = rollBossLoot(KAIREN, inJadeveil(roll({ chance: 1 }), seed));
      const [mythic] = items.filter(isMythic);
      expect(items.filter((i) => i.templateId === mythic.templateId)).toHaveLength(1);
    }
  });

  it('reads what is held from the gear, wherever it is', () => {
    const gear = [{ templateId: 'a', rarity: Rarity.Mythic }, { templateId: 'b', rarity: Rarity.Legendary }];
    expect([...heldMythics(gear)]).toEqual(['a']);
  });

  it('mints it as its legendary would be, at the ceiling', () => {
    setLevelCapInputs(jadeveilAt(1, 35));
    jest.spyOn(Math, 'random').mockImplementation(seeded(3));
    const encounterId = summitEncounterId(5);
    const paid = Array.from({ length: 3 }, () => won('kairen', encounterId, 'jadeveil', CAP - 1).items).flat();
    const mythics = paid.filter(isMythic);
    expect(mythics).toHaveLength(3);
    for (const item of mythics) expect(item.itemLevel).toBe(35);
  });
});

describe('where a mythic never comes from', () => {
  const atCap = () => roll({ kills: CAP - 1, chance: 1 });
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

  it('the Empire\'s other bosses, with the counter at its cap', () => {
    setLevelCapInputs(jadeveilAt(2));
    jest.spyOn(Math, 'random').mockImplementation(seeded(11));
    const fights: [EnemyTemplateId, string][] = [
      ['troll_chieftain', 'lair_warren_boss'], ['dragon', 'lair_wyrm_boss'], ['heart_of_winter', 'lair_barrow_boss'],
    ];
    for (const [id, encounterId] of fights) {
      for (const _ of SEEDS) expect(won(id, encounterId, 'empire', CAP - 1).items.filter(isMythic)).toEqual([]);
    }
  });

  it('a fight with no boss in it, in a world where a boss would', () => {
    setLevelCapInputs(jadeveilAt(1));
    jest.spyOn(Math, 'random').mockImplementation(seeded(12));
    const others = enemyTemplates.filter((t) => t.tier !== 'boss');
    for (const seed of SEEDS) {
      const enemies = [others[seed % others.length], others[(seed * 7) % others.length]];
      expect(rollLoot(enemies, inJadeveil(atCap(), seed)).filter(isMythic)).toEqual([]);
    }
  });

  it('a chest of any kind, or a chest\'s guard, or any other roll', () => {
    for (const seed of SEEDS) {
      const options = inJadeveil(atCap(), seed);
      const paid = [
        ...rollChest(MASTERIES, options),
        ...rollLairChest('legendary', MASTERIES, options),
        ...rollLairChest('epics', MASTERIES, options),
        ...lairChestRewards(STORY_LAIRS[0].id, 'jadeveil', 'legendary', MASTERIES, options).items,
        ...summitGuaranteedPieces(options),
        rollRandomItem(Rarity.Legendary, options),
        rollChestGuardItem(4, options),
      ].filter((item): item is Item => !!item);
      expect(paid.length).toBeGreaterThan(0);
      expect(paid.filter(isMythic)).toEqual([]);
    }
  });

  it('a shop or the forge: the catalogue they read holds none', () => {
    expect(itemTemplates.filter(isMythic)).toEqual([]);
    for (let week = 1; week <= 20; week++) expect(shopStock(3, week).filter(isMythic)).toEqual([]);
    for (const template of itemTemplates) {
      if (!template.form || !template.motif) continue;
      const forged = forgeTemplate(template.form, template.motif);
      if (forged) expect(isMythic(forged)).toBe(false);
    }
  });
});

/** One cell: the real boss roll, `kills` of them from an empty counter, the party's holdings emptied at each mythic. */
function auditCell(band: number, tier: number, kills: number) {
  const chance = mythicChance(band, tier);
  const rng = seeded(1000 * band + tier);
  const ledger = roll({ chance });
  const gaps: number[] = [];
  let forced = 0;
  for (let kill = 0; kill < kills; kill++) {
    const before = ledger.kills;
    const paid = rollBossLoot(KAIREN, { party: PARTY, world: 'jadeveil', rng, mythic: ledger }).some(isMythic);
    if (!paid) continue;
    gaps.push(before + 1);
    if (before + 1 === CAP) forced += 1;
    ledger.held.clear();
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    band, tier, chance,
    firstMean: gaps.reduce((sum, n) => sum + n, 0) / gaps.length,
    firstMedian: sorted[Math.floor(sorted.length / 2)],
    per100: (100 * gaps.length) / kills,
    worst: Math.max(...gaps),
    forcedShare: forced / gaps.length,
  };
}

describe('the audit', () => {
  const KILLS = process.env.MYTHIC_AUDIT ? 20000 : 2000;
  const table = BANDS.flatMap((band) => STORM_TIERS.map((tier) => auditCell(band, tier, KILLS)));
  const cell = (band: number, tier: number) => table.find((c) => c.band === band && c.tier === tier)!;

  if (process.env.MYTHIC_AUDIT) {
    const rows = table.map((c) => [
      c.band, c.tier, `${(c.chance * 100).toFixed(1)}%`, c.firstMean.toFixed(1), c.firstMedian, c.per100.toFixed(1), c.worst,
      `${(c.forcedShare * 100).toFixed(0)}%`,
    ].join(' | '));
    process.stdout.write(`${['band | tier | chance | first (mean) | first (median) | per 100 | worst | forced', ...rows].join('\n')}\n`);
  }

  it('measures rates that rise with the boss tier in every band, and with the band at every tier', () => {
    for (const band of BANDS) {
      for (const tier of STORM_TIERS.slice(1)) expect(cell(band, tier).per100).toBeGreaterThan(cell(band, tier - 1).per100);
    }
    for (const tier of STORM_TIERS) expect(cell(4, tier).per100).toBeGreaterThan(cell(1, tier).per100);
    for (const c of table) expect(c.firstMean).toBeCloseTo(100 / c.per100, 0);
  });

  it('bounds the worst case: no run of kills ever passes the cap', () => {
    for (const c of table) expect(c.worst).toBeLessThanOrEqual(CAP);
    // ...and the band-1 story cell does reach it, so the bound is the counter's and not luck's
    expect(cell(1, 1).worst).toBe(CAP);
  });

  it('keeps it a rare event from the story, which cannot reach the counter on its own', () => {
    const storyBosses = STORY_LAIRS.length + 1;
    // Aethelred's first fight, then every world's
    expect(1 + storyBosses * BALANCE.MAX_WORLD_CROSSINGS).toBeLessThan(CAP);
    const worldOfStory = 1 - (1 - mythicChance(1, 1)) ** storyBosses;
    expect(worldOfStory).toBeLessThan(0.2);
  });

  it('makes the top tier of a finished world the farm, well above the free refight', () => {
    // A finished band-1 world's tier 5 mints at the next band; tier 1 is free and its loot is still band 1
    expect(cell(2, 5).per100).toBeGreaterThan(1.5 * cell(1, 1).per100);
    expect(cell(2, 5).firstMean).toBeLessThan(CAP / 2);
  });
});
