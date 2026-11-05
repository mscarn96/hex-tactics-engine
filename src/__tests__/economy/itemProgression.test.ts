import { itemTemplates } from '@/data/items/itemTemplates';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { FORMS, MASTERY_WEAPON_FORMS, PATH_CLASS } from '@/data/items/itemForms';
import { SLOT_BUDGET, STAT_PER_POINT, itemBudget } from '@/data/items/itemGen';
import { GEM_KINDS, gemBonus } from '@/data/items/gems';
import { BALANCE } from '@/data/balanceConstants';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { previewItem } from '@/systems/economy/itemFactory';
import { effectiveModifiers } from '@/systems/progression/itemStats';
import { forgeCost } from '@/systems/economy/forge';
import { rollRandomItem, wearableByParty } from '@/systems/economy/lootGenerator';
import { basicAttackWith } from '@/systems/combat/basicAttack';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { weaponStrikes } from '@/systems/combat/statusEffects';
import { canEquip, DUAL_WIELD_MASTERIES } from '@/systems/progression/equipRules';
import { createRNG } from '@/utils/rng';
import { FormId, HeroClass, Item, ItemTemplate, MasteryId, Rarity } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';

/**
 * Early, mid and late gear measured against the rules that stop a purchase
 * being dead. Deterministic throughout: every figure is arithmetic through the
 * real pipeline or a seeded roll, so a red here is a retune, not bad luck.
 * The numbers these rules were tuned against, and why, are in
 * the private project notes under "Tuning record".
 */

/** The three points of a campaign the suite measures at: party level and the gear's rarity. */
const STAGES: [string, number, Rarity][] = [
  // Early is the first level a path can be chosen at — the suite measures paths.
  ['early', BALANCE.MASTERY_UNLOCK_LEVEL, Rarity.Common],
  ['mid', 10, Rarity.Rare],
  ['late', 20, Rarity.Epic],
];
/** Light, medium and heavy armour on the receiving end. */
const DEFENCES = [10, 30, 60];

/** The plain (base-silhouette, unlocked) template of a form at a rarity. */
const plainOf = (form: FormId, rarity: Rarity): ItemTemplate | undefined =>
  itemTemplates.find((t) => t.form === form && t.rarity === rarity && !t.masteryLock
    && (t.variant === undefined || t.variant === form));

const statTotal = (item: Pick<Item, 'modifiers' | 'sockets'>) =>
  Object.values(effectiveModifiers(item)).reduce((a, b) => a + (b ?? 0), 0);

/** Expected Basic Attack damage per action, through the real damage pipeline. */
function basicAttackDamage(heroClass: HeroClass, level: number, worn: Item[], def: number, dual: boolean): number {
  const base = calculateStatsForLevel(heroTemplates.find((h) => h.heroClass === heroClass)!, level);
  const attack = base.attack + worn.reduce((sum, i) => sum + (effectiveModifiers(i).attack ?? 0), 0);
  const skill = basicAttackWith(worn[0], dual);
  const attacker = makeUnit({ stats: makeStats({ ...base, attack }) });
  const target = makeUnit({ isPlayer: false, stats: makeStats({ defense: def }) });
  const hit = calculateDamage(attacker, target, skill);
  return weaponStrikes(skill).reduce((sum, scale) => sum + hit * scale, 0);
}

describe('two-handed weapons', () => {
  it('are budgeted for both hands they take', () => {
    const offenders = itemTemplates
      .filter((t) => t.handRule === 'twoHanded')
      .filter((t) => itemBudget(t) !== SLOT_BUDGET.mainHand + SLOT_BUDGET.offHand)
      .map((t) => t.id);
    expect(offenders).toEqual([]);
    expect(itemBudget({ slot: 'mainHand', handRule: 'main' })).toBe(SLOT_BUDGET.mainHand);
  });

  it('cost more at the forge than a one-hander of the same motif', () => {
    const great = forgeCost('greatsword', 'steel', 10);
    const long = forgeCost('long_sword', 'steel', 10);
    expect(great.gold!).toBeGreaterThan(long.gold!);
  });

  /**
   * The dead choice this tuning removed. At one-hander budget a greatsword was
   * one attack point over a short sword, so a Berserker gave up a whole second
   * weapon for nothing. It has to out-hit every legal one-hander on its own,
   * and a dual-wield pair may only out-hit it by a small margin — the pair's
   * real advantage is two procs per action, not raw damage.
   */
  it('out-hit any single one-hander and stay within reach of a dual pair', () => {
    const offenders: string[] = [];
    for (const mastery of Object.keys(MASTERY_WEAPON_FORMS) as MasteryId[]) {
      const forms = MASTERY_WEAPON_FORMS[mastery];
      const twoHanders = forms.filter((f) => FORMS[f].handRule === 'twoHanded');
      if (twoHanders.length === 0) continue;
      const oneHanders = forms.filter((f) => FORMS[f].handRule !== 'twoHanded');
      const heroClass = FORMS[twoHanders[0]].classLock![0];
      for (const [stage, level, rarity] of STAGES) {
        const at = (f: FormId) => { const t = plainOf(f, rarity); return t ? previewItem(t, level) : null; };
        for (const def of DEFENCES) {
          for (const two of twoHanders) {
            const great = at(two);
            if (!great) continue;
            const greatHit = basicAttackDamage(heroClass, level, [great], def, false);
            for (const one of oneHanders) {
              const item = at(one);
              if (!item) continue;
              const single = basicAttackDamage(heroClass, level, [item], def, false);
              if (greatHit <= single) offenders.push(`${mastery} ${stage} def${def}: ${two} ${greatHit} <= ${one} ${single}`);
              if (DUAL_WIELD_MASTERIES.includes(mastery)) {
                const pair = basicAttackDamage(heroClass, level, [item, item], def, true);
                if (pair > greatHit * 1.15) offenders.push(`${mastery} ${stage} def${def}: ${one}×2 ${pair} > 1.15 × ${two} ${greatHit}`);
              }
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('dual wield', () => {
  /**
   * The intended advantage: a second weapon's stats on the sheet, and a second
   * strike carrying every proc. Measured against the same weapon held alone.
   */
  it('never loses to the same weapon held alone, at every stage and armour', () => {
    const offenders: string[] = [];
    for (const mastery of DUAL_WIELD_MASTERIES) {
      const heroClass = FORMS[MASTERY_WEAPON_FORMS[mastery][0]].classLock![0];
      for (const form of MASTERY_WEAPON_FORMS[mastery].filter((f) => FORMS[f].handRule !== 'twoHanded')) {
        for (const [stage, level, rarity] of STAGES) {
          const t = plainOf(form, rarity);
          if (!t) continue;
          const item = previewItem(t, level);
          for (const def of DEFENCES) {
            const single = basicAttackDamage(heroClass, level, [item], def, false);
            const pair = basicAttackDamage(heroClass, level, [item, item], def, true);
            if (pair < single) offenders.push(`${mastery} ${form} ${stage} def${def}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /** "Without invalid mastery matchups": a weapon in the off-hand is exactly the dual-wield paths'. */
  it('is offered to the dual-wield paths and to nobody else', () => {
    const offenders: string[] = [];
    for (const mastery of Object.keys(MASTERY_WEAPON_FORMS) as MasteryId[]) {
      const forms = MASTERY_WEAPON_FORMS[mastery];
      const heroClass = PATH_CLASS[mastery];
      const hero = { heroClass, masteryPath: mastery };
      for (const main of forms) {
        for (const off of forms) {
          const a = plainOf(main, Rarity.Common) ?? plainOf(main, Rarity.Rare);
          const b = plainOf(off, Rarity.Common) ?? plainOf(off, Rarity.Rare);
          if (!a || !b) continue;
          const mainItem = previewItem(a, 5);
          if (!canEquip(hero, mainItem, 'mainHand', {}).ok) continue;
          // A two-hander is *displaced* by an off-hand weapon rather than
          // joined by it, so a legal swap that takes the main hand off is not a pair.
          const check = canEquip(hero, previewItem(b, 5), 'offHand', { mainHand: mainItem });
          const allowed = check.ok && !check.displaces.includes('mainHand');
          const expected = DUAL_WIELD_MASTERIES.includes(mastery)
            && FORMS[main].handRule !== 'twoHanded' && FORMS[off].handRule !== 'twoHanded';
          if (allowed !== expected) offenders.push(`${mastery} ${main}+${off}: ${allowed}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('gems', () => {
  /** What a gem is worth in the item budget's own currency. */
  const points = (kind: (typeof GEM_KINDS)[number], tier: 'cut' | 'brilliant') => {
    const { stat, value } = gemBonus(`${kind}_${tier}`);
    return { value, points: value / STAT_PER_POINT[stat], unit: 1 / STAT_PER_POINT[stat] };
  };

  it('are worth the same budget within a tier, to one stat unit', () => {
    const offenders: string[] = [];
    for (const tier of ['cut', 'brilliant'] as const) {
      const top = Math.max(...GEM_KINDS.map((k) => points(k, tier).points));
      for (const kind of GEM_KINDS) {
        const g = points(kind, tier);
        if (top - g.points > g.unit + 1e-9) offenders.push(`${kind}_${tier}: ${g.points} against ${top}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /** Paying to cut two gems into one must never hand back fewer stats. */
  it('never lose stats by being cut from two into one', () => {
    const offenders = GEM_KINDS.filter((k) => points(k, 'brilliant').value <= 2 * points(k, 'cut').value);
    expect(offenders).toEqual([]);
  });

  /**
   * A gem does not level, so it must still be worth a socket late. A late epic
   * weapon's own budget is the yardstick: a Brilliant stays a real share of it.
   */
  it('stay a meaningful share of a late weapon', () => {
    const lateSword = previewItem(plainOf('long_sword', Rarity.Epic)!, 20);
    const swordPoints = statTotal(lateSword);
    const offenders = GEM_KINDS.filter((k) => points(k, 'brilliant').points < swordPoints * 0.15);
    expect(offenders).toEqual([]);
  });
});

describe('item-level progression', () => {
  const ladder = [...BALANCE.BAND_ITEM_LEVEL, BALANCE.MAX_LEVEL];

  it('never loses stats as the ground gets deeper, and always gains over the campaign', () => {
    const offenders: string[] = [];
    for (const t of itemTemplates.filter((x) => x.rarity !== Rarity.Legendary)) {
      const totals = ladder.map((l) => statTotal(previewItem(t, l)));
      const falls = totals.some((v, i) => i > 0 && v < totals[i - 1]);
      if (falls || totals[totals.length - 1] <= totals[0]) offenders.push(`${t.id}: ${totals.join('/')}`);
    }
    expect(offenders).toEqual([]);
  });

  /** A rarer piece at the same level is never the worse buy. */
  it('ranks rarities at every level for each weapon form', () => {
    const offenders: string[] = [];
    for (const form of Object.keys(FORMS) as FormId[]) {
      if (FORMS[form].slot !== 'mainHand') continue;
      for (const level of ladder) {
        const totals = [Rarity.Common, Rarity.Rare, Rarity.Epic]
          .map((r) => plainOf(form, r))
          .map((t) => (t ? statTotal(previewItem(t, level)) : null));
        for (let i = 1; i < totals.length; i++) {
          const [lo, hi] = [totals[i - 1], totals[i]];
          if (lo !== null && hi !== null && hi < lo) offenders.push(`${form} L${level}: ${totals.join('/')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('party-relevant loot', () => {
  /**
   * The 70/30 lean is per hero, and each hero gets an equal share of it — the
   * complaint that started the feature was a two-hero party whose drops were
   * almost all for the first hero.
   */
  it('shares the lean evenly across a four-class party', () => {
    const party = [HeroClass.Warrior, HeroClass.Mage, HeroClass.Healer, HeroClass.Ranger]
      .map((heroClass) => ({ heroClass, masteryPath: null }));
    const rng = createRNG(4242);
    const N = 12000;
    const wearable = party.map(() => 0);
    let forSomebody = 0;
    for (let i = 0; i < N; i++) {
      const drop = rollRandomItem(Rarity.Legendary, { party, rng: () => rng.next() });
      const t = drop && itemTemplates.find((x) => x.id === drop.templateId);
      if (!t) continue;
      party.forEach((h, k) => { if (wearableByParty(t, [h])) wearable[k]++; });
      if (wearableByParty(t, party)) forSomebody++;
    }
    const shares = wearable.map((w) => w / N);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThan(0.05);
    // Common armour is held to its weight like any other (`wearableWeights`),
    // so no piece is everybody's: each hero is owed its own share of the lean,
    // and the lean as a whole lands on somebody
    expect(Math.min(...shares)).toBeGreaterThanOrEqual(BALANCE.PARTY_LOOT_BIAS / party.length);
    expect(forSomebody / N).toBeGreaterThanOrEqual(BALANCE.PARTY_LOOT_BIAS);
  });
});
