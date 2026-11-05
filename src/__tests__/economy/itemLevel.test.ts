import { bagFrom } from '@/data/items/bag';
import { Hero, HeroClass, Item, ItemModifiers, ItemTemplate, Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { highestLevelCap } from '@/data/levelCap';
import { itemTemplates } from '@/data/items/itemTemplates';
import { rollAffixes } from '@/data/items/itemAffixes';
import {
  anchorItemLevel,
  isItemLevel,
  itemLevelScale,
  levelledModifiers,
} from '@/data/items/itemLevel';
import {
  defaultMintLevel,
  findTemplate,
  itemAtLevel,
  itemFromTemplate,
  mintItem,
} from '@/systems/economy/itemFactory';
import { effectiveModifiers } from '@/systems/progression/itemStats';
import { upgraded } from '@/systems/progression/upgrades';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { modifierDelta } from '@/systems/progression/equipRules';
import { itemModifierLines } from '@/data/display/itemDisplay';
import { createPlayerUnits } from '@/systems/combat/unitFactory';
import { useInventoryStore } from '@/stores/inventoryStore';
import { SAVE_VERSION, SaveData, isLoadable } from '@/systems/save/saveFormat';
import { emptyGemStock } from '@/data/items/gems';
import { makeStats } from '@/__tests__/support/fixtures';
import { itemName } from '@/data/items/itemText';

/**
 * Item level: one saved number per instance that moves its equipment stats.
 *
 * What this file pins is the set of rules the curve has to keep, not the curve's
 * numbers — the anchors and the offset get retuned by the balance pass, and none
 * of the assertions below should notice.
 */

/** A seeded stream, so an affix roll here is the same roll every run. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const LEVELS = Array.from({ length: BALANCE.MAX_LEVEL }, (_, i) => i + 1);
const template = (id: string): ItemTemplate => {
  const t = findTemplate(id);
  if (!t) throw new Error(`no template ${id}`);
  return t;
};
const nonLegendary = itemTemplates.filter((t) => t.rarity !== Rarity.Legendary);

/** Mutates the cap for the length of `run`, and always puts it back. */
function withCap<T>(cap: number, run: () => T): T {
  const balance = BALANCE as { MAX_LEVEL: number };
  const before = balance.MAX_LEVEL;
  balance.MAX_LEVEL = cap;
  try {
    return run();
  } finally {
    balance.MAX_LEVEL = before;
  }
}

describe('an instance carries its item level', () => {
  it('mints every template with a level in range, and a catalogue preview at its anchor', () => {
    const offenders: string[] = [];
    for (const t of itemTemplates) {
      const minted = mintItem(t, seeded(1));
      if (!isItemLevel(minted.itemLevel, t.rarity)) offenders.push(`mint ${t.id}: ${minted.itemLevel}`);
      const preview = itemFromTemplate(t);
      if (preview.itemLevel !== anchorItemLevel(t.rarity)) offenders.push(`preview ${t.id}`);
      if (preview.modifiers !== t.modifiers) offenders.push(`preview mods ${t.id}`);
    }
    expect(offenders).toEqual([]);
  });

  it('mints at the level it is asked for, clamped to a whole level within the cap', () => {
    const sword = template('long_sword_iron');
    expect(mintItem(sword, seeded(2), 7).itemLevel).toBe(7);
    expect(mintItem(sword, seeded(2), 0).itemLevel).toBe(1);
    expect(mintItem(sword, seeded(2), 99).itemLevel).toBe(BALANCE.MAX_LEVEL);
    expect(mintItem(sword, seeded(2), 6.6).itemLevel).toBe(7);
  });

  /**
   * An acquisition that has not yet been told its source's level mints at the
   * anchor, which is the catalogue's own numbers — so this feature moves no
   * existing drop until a source is taught what level its loot is.
   */
  it('defaults a nonlegendary mint to the anchor, where it matches the catalogue', () => {
    const offenders: string[] = [];
    for (const t of nonLegendary.filter((x) => x.rarity === Rarity.Common)) {
      const minted = mintItem(t, seeded(3));
      if (minted.itemLevel !== defaultMintLevel(t.rarity)) offenders.push(t.id);
      if (JSON.stringify(minted.modifiers) !== JSON.stringify(t.modifiers)) offenders.push(`${t.id} mods`);
    }
    expect(offenders).toEqual([]);
  });

  it('survives a save round trip with its level and a legendary +5 intact', () => {
    const legendary = itemTemplates.find((t) => t.rarity === Rarity.Legendary)!;
    let item: Item = mintItem(legendary, seeded(4));
    for (let i = 0; i < 5; i++) item = upgraded(item);
    const rare = mintItem(template('long_sword_steel'), seeded(4), 11);
    const back = JSON.parse(JSON.stringify([item, rare])) as Item[];
    expect(back[0]).toEqual(item);
    expect(back[0].itemLevel).toBe(BALANCE.MAX_LEVEL + 5);
    expect(back[1].itemLevel).toBe(11);
    expect(effectiveModifiers(back[0])).toEqual(effectiveModifiers(item));
  });
});

describe('the save refuses an item without a readable level', () => {
  const save = (items: unknown[], stash: unknown[] = []): SaveData =>
    ({
      version: SAVE_VERSION,
      game: { difficulty: 'medium', hardcore: false, achievementVictories: [] },
      worldMap: { current: 'empire', worlds: { empire: { seed: 1, explored: [], defeated: [], partyPosition: { q: 0, r: 0 }, activeEncounterTiles: [], usedMagicWells: [], finds: [], merchants: [], day: 1, week: 1 } }, wardUntil: 0, villageBuff: null },
      worldBands: { bands: {}, finished: [] },
      mythicKills: 0,
      ascent: { wrath: { value: 0, at: 0, floor: 0, windowUntil: 0 }, vows: [null, null, null, null], shrines: 0, summit: { slain: false, seals: [0, 0, 0, 0, 0], highestTier: 0 }, forge: { ink: 0, patterns: [] } },
      empire: { winterSeals: [0, 0, 0, 0, 0], heartTier: 0 },
      inventory: { bag: items.map((item) => ({ kind: 'gear', item })), resources: {} },
      city: { stash, gemStash: emptyGemStock(), meal: null, sackedUntilDay: 0, recruitNoticeShownFor: 0 },
    }) as unknown as SaveData;
  const good = mintItem(template('long_sword_iron'), seeded(5), 4);

  // Measured against the highest cap, whatever this device owns: the loader runs
  // before any store holds the campaign, and an owner's level-25 gear is real.
  it('loads a save whose every item carries a whole level within the highest cap', () => {
    expect(isLoadable(save([good], [good]))).toBe(true);
    const top = mintItem(itemTemplates.find((t) => t.rarity === Rarity.Legendary)!, seeded(5));
    expect(isLoadable(save([{ ...top, itemLevel: highestLevelCap() + BALANCE.MAX_UPGRADE_LEVEL }]))).toBe(true);
    expect(isLoadable(save([{ ...top, itemLevel: highestLevelCap() + BALANCE.MAX_UPGRADE_LEVEL + 1 }]))).toBe(false);
    expect(isLoadable(save([{ ...good, itemLevel: highestLevelCap() }]))).toBe(true);
    expect(isLoadable(save([]))).toBe(true);
  });

  it('refuses a missing, fractional, non-numeric or out-of-range level, bag or stash', () => {
    const { itemLevel: _drop, ...missing } = good;
    void _drop;
    const bad: unknown[] = [
      missing,
      { ...good, itemLevel: 2.5 },
      { ...good, itemLevel: '4' },
      { ...good, itemLevel: 0 },
      { ...good, itemLevel: highestLevelCap() + 1 },
      { ...good, itemLevel: null },
    ];
    const accepted = bad.filter((item) => isLoadable(save([good, item])) || isLoadable(save([], [item])));
    expect(accepted).toEqual([]);
  });

  it('still refuses any other version, levels or not', () => {
    expect(isLoadable({ ...save([good]), version: SAVE_VERSION - 1 })).toBe(false);
  });
});

describe('the stat curve', () => {
  /** Every template, affixed the way a real mint would be, at its anchor. */
  const affixedAnchors = nonLegendary.map((t, i) => ({
    t,
    anchored: mintItem(t, seeded(100 + i), anchorItemLevel(t.rarity)),
  }));

  it('is exactly the catalogue at each rarity\'s anchor', () => {
    const offenders = itemTemplates.filter(
      (t) => levelledModifiers(t.modifiers, anchorItemLevel(t.rarity), t.rarity) !== t.modifiers,
    );
    expect(offenders.map((t) => t.id)).toEqual([]);
    for (const rarity of Object.values(Rarity)) {
      expect(itemLevelScale(anchorItemLevel(rarity), rarity)).toBe(1);
    }
  });

  it('never loses a point on any stat as the level rises, affixes included', () => {
    const offenders: string[] = [];
    for (const { t, anchored } of affixedAnchors) {
      let prev: ItemModifiers | null = null;
      for (const level of LEVELS) {
        const mods = itemAtLevel({ ...anchored, itemLevel: 0 }, level).modifiers;
        if (prev) {
          for (const [k, v] of Object.entries(prev) as [keyof ItemModifiers, number][]) {
            if ((mods[k] ?? 0) < v) offenders.push(`${t.id} ${k} L${level - 1}→${level}`);
          }
        }
        prev = mods;
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * No dead roll: every stat an item carries at its anchor — the base's and each
   * affix's — is still on it at level 1. A Keen ring found early is still keen.
   */
  it('keeps every stat an item carries at every level, so no affix rolls dead', () => {
    const offenders: string[] = [];
    for (const { t, anchored } of affixedAnchors) {
      const keys = Object.keys(anchored.modifiers).sort().join();
      for (const level of LEVELS) {
        const got = Object.keys(itemAtLevel({ ...anchored, itemLevel: 0 }, level).modifiers).sort().join();
        if (got !== keys) offenders.push(`${t.id} L${level}: ${got} vs ${keys}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The catalogue alone never exercises the floor — its smallest epic stat is 2,
   * which rounds to 1 even at level 1 — so the rule is pinned on a stat that
   * would otherwise round to nothing.
   */
  it('floors a carried stat at one point rather than rounding it away', () => {
    const scale = itemLevelScale(1, Rarity.Epic);
    expect(Math.round(1 * scale)).toBe(0);
    expect(levelledModifiers({ critChance: 1, attack: 9 }, 1, Rarity.Epic).critChance).toBe(1);
  });

  /**
   * Form primacy and motif tilt survive the curve: a stat that was at least as
   * large as another at the anchor is at least as large at every level. Uniform
   * scaling with a monotone round cannot break that, and this is the assertion
   * that says so rather than the argument.
   *
   * **Strict order only.** An affix that would round away is held up one point
   * (`affixedModifiersAt`), which can lift a stat that *tied* another at the
   * anchor one above it — a tie is not a ranking, and a stat that was ahead
   * stays ahead — to within the one point the hold-up itself adds.
   */
  it('preserves the order of an item\'s own stats at every level', () => {
    const offenders: string[] = [];
    for (const { t, anchored } of affixedAnchors) {
      const entries = Object.entries(anchored.modifiers) as [keyof ItemModifiers, number][];
      for (const level of LEVELS) {
        const mods = itemAtLevel({ ...anchored, itemLevel: 0 }, level).modifiers;
        for (const [a, va] of entries) {
          for (const [b, vb] of entries) {
            if (va > vb && (mods[a] ?? 0) + 1 < (mods[b] ?? 0)) offenders.push(`${t.id} ${a}<${b} L${level}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never puts a rarity-gated stat on gear below the tier that may carry it', () => {
    const offenders: string[] = [];
    for (const { t, anchored } of affixedAnchors) {
      if (t.rarity !== Rarity.Common && t.rarity !== Rarity.Rare) continue;
      for (const level of LEVELS) {
        if (itemAtLevel({ ...anchored, itemLevel: 0 }, level).modifiers.armourPen) {
          offenders.push(`${t.id} L${level}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The acceptance's own levels: 5, 8, 10 and the cap. Each step up those four
   * is a real stat gain on a representative piece of each nonlegendary rarity,
   * and two instances of one named item at different levels are different.
   */
  it('moves a named item\'s stats at levels 5, 8, 10 and the cap', () => {
    const marks = [5, 8, 10, BALANCE.MAX_LEVEL];
    const flat: string[] = [];
    for (const id of ['long_sword_iron', 'long_sword_steel', 'long_sword_fire', 'plate_chest_iron']) {
      const t = template(id);
      const at = marks.map((level) => mintItem(t, seeded(7), level));
      if (new Set(at.map(itemName)).size !== 1) flat.push(`${id} renamed by level`);
      const totals = at.map((i) =>
        Object.values(i.modifiers).reduce((s: number, v) => s + (v ?? 0), 0),
      );
      for (let i = 1; i < totals.length; i++) {
        if (!(totals[i] > totals[i - 1])) flat.push(`${id} L${marks[i - 1]}→${marks[i]}: ${totals}`);
      }
    }
    expect(flat).toEqual([]);
  });

  it('re-levelling is derived, so two routes to one level agree and affixes and name are kept', () => {
    const t = template('long_sword_fire');
    const minted = mintItem(t, seeded(9), 3);
    const relevelled = itemAtLevel(itemAtLevel(minted, 17), 9);
    const direct = mintItem(t, seeded(9), 9);
    expect(relevelled.modifiers).toEqual(direct.modifiers);
    expect(relevelled.affixes).toEqual(minted.affixes);
    expect(itemName(relevelled)).toBe(itemName(minted));
    expect(relevelled.id).toBe(minted.id);
    expect(itemAtLevel(minted, 3)).toBe(minted);
    expect(rollAffixes(t, seeded(9))).toEqual(minted.affixes);
  });
});

describe('one effective-modifier path everywhere', () => {
  const bareHero = (equipment: Hero['equipment']): Hero => ({
    id: 'h1', templateId: 'warrior', name: 'H', heroClass: HeroClass.Warrior,
    level: 12, xp: 0, baseStats: makeStats(), currentHp: 100, currentMana: 50,
    skills: [], equipment, masteryPath: null, masteryPoints: 0, masteryNodes: {},
  });
  const statKeys = ['maxHp', 'attack', 'defense', 'magic', 'speed'] as const;

  /** A legendary three Crystals past the cap and a levelled affixed epic. */
  const legendary = (() => {
    const t = itemTemplates.find((x) => x.rarity === Rarity.Legendary && x.slot === 'mainHand')!;
    let item: Item = { ...mintItem(t, seeded(11)), id: 'leg' };
    for (let i = 0; i < 3; i++) item = upgraded(item);
    return item;
  })();
  const epic = { ...mintItem(template('plate_chest_fire'), seeded(12), 17), id: 'epic' };

  it('does not scale by item level a second time at read', () => {
    expect(effectiveModifiers(epic)).toEqual(epic.modifiers);
    expect(effectiveModifiers(legendary)).toEqual(legendary.modifiers);
    expect(legendary.itemLevel).toBe(BALANCE.MAX_LEVEL + 3);
  });

  it('gives the character sheet, combat units, comparisons and item lines the same numbers', () => {
    const offenders: string[] = [];
    for (const item of [legendary, epic]) {
      const expected = effectiveModifiers(item);
      const slot = item.slot === 'mainHand' ? 'mainHand' : 'chest';
      const naked = getEffectiveStats(bareHero({}), []);
      const hero = bareHero({ [slot]: item.id });
      const sheet = getEffectiveStats(hero, [item]);

      useInventoryStore.setState({ bag: bagFrom({ gear: [item] }) });
      const [unit] = createPlayerUnits([hero], [{ q: 0, r: 0 }]);

      for (const k of statKeys) {
        const want = naked[k] + (expected[k] ?? 0);
        if (sheet[k] !== want) offenders.push(`${item.id} sheet ${k}`);
        if (unit.stats[k] !== want) offenders.push(`${item.id} combat ${k}`);
      }
      const delta = Object.fromEntries(modifierDelta(item, undefined).map((d) => [d.key, d.delta]));
      if (JSON.stringify(delta) !== JSON.stringify(Object.fromEntries(
        Object.entries(expected).filter(([, v]) => v).sort(([, a], [, b]) => (b as number) - (a as number)),
      ))) offenders.push(`${item.id} comparison`);
      const lines = Object.fromEntries(itemModifierLines(item).map((l) => [l.key, l.value]));
      if (JSON.stringify(lines) !== JSON.stringify(expected)) offenders.push(`${item.id} lines`);
    }
    useInventoryStore.setState({ bag: bagFrom({ gear: [] }) });
    expect(offenders).toEqual([]);
  });
});

describe('legendaries are minted at the cap in force', () => {
  const legendary = itemTemplates.find((t) => t.rarity === Rarity.Legendary)!;

  it('takes the current cap whatever level the source asked for', () => {
    expect(mintItem(legendary, seeded(13), 3).itemLevel).toBe(BALANCE.MAX_LEVEL);
    expect(mintItem(legendary, seeded(13)).itemLevel).toBe(BALANCE.MAX_LEVEL);
    expect(defaultMintLevel(Rarity.Legendary)).toBe(BALANCE.MAX_LEVEL);
  });

  it('keeps an old legendary\'s level through a cap increase, and mints new ones higher', () => {
    const old = mintItem(legendary, seeded(14));
    const oldLevel = old.itemLevel;
    const oldMods = { ...old.modifiers };

    withCap(BALANCE.MAX_LEVEL + 10, () => {
      const fresh = mintItem(legendary, seeded(14));
      expect(fresh.itemLevel).toBe(oldLevel + 10);
      // Nothing re-levels the old one: same level, same numbers.
      expect(old.itemLevel).toBe(oldLevel);
      expect(old.modifiers).toEqual(oldMods);
      // The ceiling follows the cap in force, so Crystals carry it on up.
      let pumped = old;
      for (let i = 0; i < 3; i++) pumped = upgraded(pumped);
      expect(pumped.itemLevel).toBe(oldLevel + 3);
      // The raised cap reads as a legal level, and the new piece is no weaker.
      expect(isItemLevel(fresh.itemLevel, Rarity.Legendary)).toBe(true);
      for (const [k, v] of Object.entries(oldMods) as [keyof ItemModifiers, number][]) {
        expect(fresh.modifiers[k] ?? 0).toBeGreaterThanOrEqual(v);
      }
    });
  });
});
