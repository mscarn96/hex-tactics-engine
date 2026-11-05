import {
  STAT_PER_POINT, combineTilts, finishedTilt, generateItemTemplates, motifWeight, primaryStats,
} from '@/data/items/itemGen';
import { FORMS } from '@/data/items/itemForms';
import { FormId, ItemModifiers, ItemTemplate, MotifId } from '@/models/types';

/**
 * The form wins. That is the whole of this file.
 *
 * A form and a motif are both normalised before they are mixed, so a
 * *single-stat* motif lands its entire weight on one axis while a form spreads
 * its own over two or three. At the flat 0.5 this replaced, `iron` — literally
 * `{ defense: 1 }` — took a third of a weapon's budget: an Iron Throwing Blade
 * was `+2 attack, +1 speed, +2 defense` against the plain blade's `+3 attack,
 * +1 speed`, which is a Hunter's weapon that had traded its own attack away for
 * armour. The rule is not "iron is too strong", it is that **no treatment may
 * out-allocate the form it is a treatment of**, and it has to hold for motifs
 * that do not exist yet.
 *
 * Two measures, and the difference between them matters:
 *
 *  - **Share** — the fraction of the budget an axis is allocated. Exact, and
 *    the thing the generator actually decides. This is the strong assertion.
 *  - **Finished modifiers** — what the player reads off the item. Those are
 *    `Math.round`ed and denominated in *stat units*, and a budget point buys
 *    four maxHp against one attack (`STAT_PER_POINT`). So a modifier sweep has
 *    to divide the price back out or it compares two different currencies, and
 *    it has to allow for the rounding, which is the only slack in the pipeline.
 */

const generated = generateItemTemplates();

/** Every generated pair, with its form and motif recovered off the template. */
const pairs = generated.map((t) => ({
  template: t,
  form: t.form as FormId,
  motif: t.motif as MotifId,
}));

type Stat = keyof ItemModifiers;

/** How much budget an item spent on `stat`, undoing `STAT_PER_POINT`. */
function pointsOn(template: ItemTemplate, stat: Stat): number {
  return (template.modifiers[stat] ?? 0) / STAT_PER_POINT[stat];
}

/**
 * The most a rounding pass can move a two-stat comparison, in budget points.
 *
 * `Math.round` can move each side by half a stat unit, and a stat unit is worth
 * `1 / STAT_PER_POINT` points — so speed, at 0.7 units per point, carries the
 * widest slack of the five the forms actually tilt toward.
 */
function roundingSlack(a: Stat, b: Stat): number {
  return 0.5 / STAT_PER_POINT[a] + 0.5 / STAT_PER_POINT[b];
}

describe('a motif flavours a form, it never redefines it', () => {
  // The exact assertion. Ties are legal and deliberate: `band` is
  // `{ attack: 1, magic: 1, speed: 1 }` and `fetish` is `{ magic: 2, maxHp: 2 }`,
  // so those forms have two or three top stats and any of them may lead. What
  // may never lead is a stat the *motif* brought.
  it('never lets a motif out-allocate the form’s own top stat', () => {
    const offenders: string[] = [];
    for (const { form, motif } of pairs) {
      const tilt = finishedTilt(form, motif);
      const tops = primaryStats(FORMS[form].tilt);
      const cap = Math.max(0, ...tops.map((s) => tilt[s] ?? 0));
      for (const [stat, share] of Object.entries(tilt) as [Stat, number][]) {
        if (tops.includes(stat)) continue;
        if (share > cap + 1e-9) {
          offenders.push(
            `${form}_${motif}: ${stat} ${share.toFixed(3)} > ${tops.join('/')} ${cap.toFixed(3)}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // The same rule read off the finished item, which is what a player compares.
  it('never lets a motif out-allocate the form’s own top stat in the shipped modifiers', () => {
    const offenders: string[] = [];
    for (const { template, form } of pairs) {
      const tops = primaryStats(FORMS[form].tilt);
      const best = Math.max(0, ...tops.map((s) => pointsOn(template, s)));
      const bestStat = tops.reduce((a, b) => (pointsOn(template, a) >= pointsOn(template, b) ? a : b));
      for (const stat of Object.keys(template.modifiers) as Stat[]) {
        if (tops.includes(stat)) continue;
        if (pointsOn(template, stat) > best + roundingSlack(bestStat, stat)) {
          offenders.push(
            `${template.id}: ${stat} ${pointsOn(template, stat).toFixed(2)}pts `
            + `> ${bestStat} ${best.toFixed(2)}pts`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // The playtest complaint, stated as narrowly as it was reported. `attack`,
  // `magic` and `defense` are all priced at one stat per point, so these three
  // numbers are directly comparable as printed — no conversion, no slack.
  it('never gives an offensive weapon more defence than offence', () => {
    const offenders: string[] = [];
    for (const { template, form } of pairs) {
      if (FORMS[form].slot !== 'mainHand') continue;
      const tops = primaryStats(FORMS[form].tilt);
      if (!tops.includes('attack') && !tops.includes('magic')) continue;
      const best = Math.max(...tops.map((s) => template.modifiers[s] ?? 0));
      if ((template.modifiers.defense ?? 0) > best) {
        offenders.push(`${template.id}: defense ${template.modifiers.defense} > ${tops.join('/')} ${best}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // maxHp is four stat units to the point, so it is compared as budget rather
  // than as a printed number — +20 HP beside +5 magic is the price table doing
  // its job, not a staff that has become a health item.
  it('never spends more of an offensive weapon’s budget on health than on its own stat', () => {
    const offenders: string[] = [];
    for (const { template, form } of pairs) {
      if (FORMS[form].slot !== 'mainHand') continue;
      const tops = primaryStats(FORMS[form].tilt);
      if (!tops.includes('attack') && !tops.includes('magic')) continue;
      const bestStat = tops.reduce((a, b) => (pointsOn(template, a) >= pointsOn(template, b) ? a : b));
      const best = pointsOn(template, bestStat);
      if (pointsOn(template, 'maxHp') > best + roundingSlack(bestStat, 'maxHp')) {
        offenders.push(
          `${template.id}: maxHp ${pointsOn(template, 'maxHp').toFixed(2)}pts > ${bestStat} ${best.toFixed(2)}pts`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the Throwing Blade, which is where this came from', () => {
  const byId = (id: string) => generated.find((t) => t.id === id)!;

  it('keeps its attack when it is made of iron', () => {
    // Both are Common, so both spend the same five points.
    expect(byId('throwing_blade_plain').modifiers).toEqual({ attack: 3, speed: 1 });
    expect(byId('throwing_blade_iron').modifiers).toEqual({ attack: 3, speed: 1, defense: 1 });
  });
});

describe('motif weights', () => {
  // Derived from `isMasteryMotif` and `MotifSpec.elemental`, so a motif added
  // later is priced by what it is rather than by being remembered here.
  it('orders material below elemental below mastery', () => {
    expect(motifWeight('iron')).toBeLessThan(motifWeight('fire'));
    expect(motifWeight('fire')).toBeLessThan(motifWeight('bulwark'));
    // A mastery motif is authored `elemental: true` for its palette; the
    // mastery tier has to win, or all twelve sets would be priced as weather.
    expect(motifWeight('shadowblade')).toBe(motifWeight('bulwark'));
  });

  // The clamp must temper a treatment, never delete it — a motif that changes
  // nothing anywhere is a motif that does not exist, which is what an empty or
  // duplicated `MOTIF_TILT` row would silently produce.
  //
  // Deliberately "at least one item" rather than "every item". `iron` is worth a
  // fifth of the split and a plate sabaton is a two-point budget, so on eight of
  // the smallest commons its whole contribution lands inside `Math.round` and
  // the numbers come out identical to plain. That is the price floor doing what
  // it does, not the motif being inert — the same eight differ at every rarity
  // above common, and they still differ by name and by model.
  it('lets every motif change something', () => {
    const inert: MotifId[] = [];
    const motifs = new Set(pairs.map((p) => p.motif));
    for (const motif of motifs) {
      if (motif === 'plain') continue;
      const moved = pairs.some(({ template, form, motif: m }) => {
        if (m !== motif) return false;
        const plain = generated.find((t) => t.id === `${form}_plain`);
        return !!plain && JSON.stringify(plain.modifiers) !== JSON.stringify(template.modifiers);
      });
      if (!moved) inert.push(motif);
    }
    expect(inert).toEqual([]);
  });
});

describe('combineTilts', () => {
  it('leaves a form alone when the motif has no opinion', () => {
    expect(combineTilts({ attack: 3, speed: 1 }, {}, 0.5)).toEqual({ attack: 0.75, speed: 0.25 });
  });

  it('holds a runaway motif down to the form’s own top share', () => {
    // Weight 10 is far past anything the table authors — the clamp, not the
    // weight, has to be what makes this safe.
    const out = combineTilts({ attack: 3, speed: 1 }, { defense: 1 }, 10);
    expect(out.defense!).toBeLessThanOrEqual(out.attack! + 1e-9);
  });

  it('reports every tied top stat, so a tie is not broken arbitrarily', () => {
    expect(primaryStats({ attack: 1, magic: 1, speed: 1 }).sort())
      .toEqual(['attack', 'magic', 'speed']);
    expect(primaryStats({ magic: 4, maxHp: 1 })).toEqual(['magic']);
  });
});
