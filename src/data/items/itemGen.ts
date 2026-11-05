import { isLegendaryGrade } from '@/data/items/rarity';
import {
  FormId, HandRule, HeroClass, ItemModifiers, ItemSlot, ItemTemplate, ModelVariantId, MotifId, Rarity,
} from '@/models/types';
import { MOTIFS, MOTIF_RARITY, isMasteryMotif } from '@/data/items/motifs';
import { variantsOf } from '@/data/items/variants';
import {
  FORMS, FORM_IDS, MOTIF_CLASS, StatTilt, masterySetMotifsFor,
} from '@/data/items/itemForms';
import { isCollectionMotif } from '@/data/items/collections';
import { motifWorld, worldMotifsFor } from '@/data/items/worldGear';

/**
 * Generates the item library from form × motif.
 *
 * Every form is authored once and every motif is authored once; this crosses
 * them, so adding a single form yields eleven items and adding a single motif
 * yields one per form. Rarity is not a third axis — it is a property of the
 * motif (`MOTIF_RARITY`), which is what stops the generator from emitting a
 * "Legendary Plain Dagger" that looks exactly like the common one.
 *
 * Numbers here are first-pass and meant to be tuned by playtest.
 */

/**
 * How much stat budget a slot is worth, before rarity.
 *
 * A full nine-slot common loadout is 25 points — about one hero's worth of
 * level-1 base stats spread across the party's needs, so starter gear helps
 * without doubling anyone. Nine slots at epic is 100, which roughly doubles a
 * level-20 hero: that is the number `DEFENSE_ATTACKER_K` and
 * `ENEMY_LEVEL_SCALE` are sized against.
 */
export const SLOT_BUDGET: Record<ItemSlot, number> = {
  mainHand: 5,
  chest: 4,
  offHand: 3,
  head: 3,
  legs: 3,
  feet: 2,
  neck: 2,
  ring: 1.5,
};

/**
 * The budget a piece is built on: its slot's, plus the off-hand's for a weapon
 * that takes both hands.
 *
 * A two-hander used to be priced like any other main-hand weapon while costing
 * its wielder the off-hand slot as well, so the greatsword came out one attack
 * point over a short sword and was strictly worse than the short sword and the
 * shield — or, for a Berserker, the second short sword — it displaced. It is
 * charged for both hands it occupies now, and every reader of the budget (the
 * generator, the affixes, the forge's recipe and its level upgrade) asks here,
 * so the four cannot disagree about what a greatsword is worth.
 */
export function itemBudget(item: { slot: ItemSlot; handRule?: HandRule }): number {
  return SLOT_BUDGET[item.slot] + (item.handRule === 'twoHanded' ? SLOT_BUDGET.offHand : 0);
}

/** Budget multiplier per rarity. Legendary is uniques only, but the scale is used to price them. */
export const RARITY_SCALE: Record<Rarity, number> = {
  [Rarity.Common]: 1,
  [Rarity.Rare]: 2.2,
  [Rarity.Epic]: 4,
  [Rarity.Legendary]: 6.5,
  [Rarity.Mythic]: 6.5,
};

/**
 * How many stat units one budget point buys.
 *
 * Speed buys less per point because it compounds through turn order; HP buys
 * more because a point of HP does far less than a point of defence.
 */
export const STAT_PER_POINT: Record<keyof ItemModifiers, number> = {
  attack: 1,
  defense: 1,
  magicDefense: 1,
  magic: 1,
  speed: 0.7,
  maxHp: 4,
  // Jade's percentage (playtest 2026-10-14), a percent of health a point, so a
  // Jade costs the same budget as a Ruby of its tier. No form or affix allocates it.
  maxHpPercent: 1,
  // Variance and specialist stats. The forms tilt toward none of these — a
  // short sword is attack and speed and always will be — so the base library
  // still never allocates them a share. What spends them is `itemAffixes`,
  // which is why a rare has something to say that a common does not.
  //
  // A required `Record`, so adding a field to `ItemModifiers` without pricing
  // it is a compile error rather than an affix that silently rolls zero.
  critChance: 0.5,
  critDamage: 3,
  dodgeChance: 0.35,
  // Penetration, one price for both halves. It was 0.4, which made a
  // legendary Sundering helm +2% and the pen half of "of Ruin" +1–3%: a roll
  // nobody could feel. Priced against attack instead — one point of attack is
  // about one point of a hit, and one point of pen is DEF × 0.4 / 100 of one, so
  // against a late defence of 40–80 a point of attack is worth ~4–8% pen. 1.4 sits
  // well under that, because pen also stacks toward a cap that deletes most of a
  // defence (`MAX_ARMOUR_PEN` / `MAX_MAGIC_PEN`): a legendary Sundering or
  // Piercing roll is now 6% on a helm, 8% on a cuirass, 10% on a one-hander and 16%
  // on a two-hander, and the rarity gate still keeps it off anything below Epic.
  armourPen: 1.4,
  magicPen: 1.4,
  // Lifesteal: one percent a point. It was 0.25 — priced as the dearest stat
  // in the table — and a legendary Vampiric helm came out at +1%, which heals a
  // hero for a rounding error. A point of HP buys 4 health once; a point of
  // lifesteal returns 1% of a hero's ~40 damage a turn across a fight of ~8
  // turns, about 3 health, so 1.0 is the fair price. A legendary Vampiric roll
  // is 4–7% now (11% on a two-hander) and a rare one 1–2%; the stacking a
  // forged all-lifesteal kit could reach is what `MAX_LIFESTEAL` caps.
  lifesteal: 1,
  // Flat mana against a pool of tens, so a point buys very little of it.
  manaRegen: 0.12,
  healPower: 0.6,
  shieldPower: 0.6,
  poisonPower: 0.6,
};

/**
 * Stats only good gear is allowed to carry.
 *
 * Penetration (armour and magic) is the answer to a wall, and a wall is what the back half
 * of the campaign is made of. Finding it on a common dagger would make the
 * whole defence half of the game optional from level one — so it arrives late,
 * as a reason to want the epic.
 */
const RARITY_GATED_STATS: (keyof ItemModifiers)[] = ['armourPen', 'magicPen'];

/**
 * How a motif nudges the split.
 *
 * Applied at a fraction of the weight of the form's own tilt, so a Frostbound
 * Dagger is still recognisably a dagger — see `motifWeight` and `combineTilts`
 * for the two rules that keep it one.
 */
const MOTIF_TILT: Record<MotifId, StatTilt> = {
  plain: {},
  iron: { defense: 1 },
  steel: { attack: 1, defense: 1 },
  silver: { speed: 1, magic: 1 },
  // Softer than steel and heavier for it — mass rather than edge, so it does not
  // simply read as a worse steel on the axis steel is already best at.
  bronze: { defense: 1, maxHp: 1 },
  gold: { attack: 1, defense: 1, magic: 1 },
  // A ward holds something in. Deliberately not `{ magic: n }` alone: silver is
  // already the rare motif that is only magic and speed, and two rare treatments
  // that move the same axis are one treatment with two names.
  runed: { magic: 2, maxHp: 1 },
  fire: { attack: 2, magic: 2 },
  ice: { defense: 2, maxHp: 2 },
  storm: { speed: 3 },
  nature: { maxHp: 3 },
  shadow: { speed: 2, attack: 1 },
  holy: { magic: 2, magicDefense: 2 },
  // Jadeveil's two. A prayer worn is a ward and a light step — no rare motif
  // pairs magic defence with speed. A seal holds something in, so health leads,
  // with a little of both strengths it is holding: no motif leads on health
  // over attack and magic together (nature is health alone).
  votive: { magicDefense: 2, speed: 1 },
  spiritsealed: { maxHp: 2, attack: 1, magic: 1 },
  // The archipelago's two. A red flag flown at sea means no quarter: the hit
  // that lands hurts — no rare motif pairs attack with critical damage. A chart
  // and a compass find the route first and the mark true — no epic motif pairs
  // speed with critical chance.
  redflag: { attack: 2, critDamage: 1 },
  compassbound: { speed: 2, critChance: 2 },
  // The four collections tilt toward their weight's wearers in general rather
  // than one path — they are shared, so they are the generalist's legendary
  // against a set's specialist. Mixed at the mastery weight (`motifWeight`).
  jade_bastion: { defense: 3, maxHp: 3, magicDefense: 2 },
  canopy_strider: { attack: 3, speed: 3, critChance: 2 },
  cloud_script: { magic: 4, magicDefense: 2, manaRegen: 2 },
  monastery_oath: { magic: 3, maxHp: 3, healPower: 2 },
  // The archipelago's four. Its plate is the flagship's admiral, who holds the deck and hits back.
  ironclad_admiral: { defense: 3, maxHp: 3, attack: 2 },
  // Its hide: a smuggler-captain's coat — the strike that lands, then the one that cuts deep.
  saltrunner: { attack: 3, critChance: 3, speed: 2 },
  // Its robe: the storm-sorceress, whose lightning comes first and hard.
  stormglass: { magic: 4, speed: 2, critChance: 2 },
  // Its vestment: the reef oracle, who mends and outlasts.
  shellwoven: { healPower: 3, maxHp: 3, magicDefense: 2 },

  // Mastery sets tilt hard toward what their path actually does, rather than
  // spreading a bigger budget evenly — a Bloodrage piece should feel reckless
  bulwark: { defense: 4, maxHp: 4 },
  templar: { defense: 2, magicDefense: 1, magic: 3, maxHp: 2 },
  // Armour penetration rides the four paths whose problem is a target that will
  // not die. Their set pieces are legendary, so the rarity gate passes and the
  // stat lands where it was designed to.
  //
  // Magic penetration mirrors it on the two caster paths whose job is the same
  // kill: the Pyromancer's burst (at the Berserker's weight) and the
  // Stormcaller's reach (at the Skirmisher's). The Hydromancer is the caster's
  // Bulwark — control and a ward, `magicDefense` in its tilt — and its pen is
  // Killing Frost's, conditional on the Chill it lays, as the tank paths carry
  // none.
  berserker: { attack: 5, critDamage: 3, armourPen: 3 },
  pyromancer: { magic: 5, critChance: 3, magicPen: 3 },
  hydromancer: { magic: 4, magicDefense: 3, maxHp: 1 },
  stormcaller: { magic: 4, speed: 4, magicPen: 2 },
  lifewarden: { magic: 5, maxHp: 3 },
  stoneshaper: { defense: 3, magicDefense: 1, maxHp: 3, magic: 1 },
  wildshape: { maxHp: 4, attack: 3, defense: 1 },
  marksman: { attack: 4, critChance: 4, armourPen: 3 },
  skirmisher: { attack: 3, speed: 3, dodgeChance: 2, armourPen: 2 },
  shadowblade: { attack: 4, speed: 2, critDamage: 2, armourPen: 3 },
  // The Monk's three. The Beetle's Barriers scale from both its defences, so
  // its set raises both rather than health; the Firefly heals by hurting, so
  // its magic leads; the Mantis is the fourth executioner and carries the pen.
  beetle: { defense: 3, magicDefense: 3, maxHp: 2 },
  firefly: { magic: 5, speed: 2, maxHp: 1 },
  mantis: { attack: 4, speed: 2, critChance: 3, armourPen: 2 },
};

/**
 * Whether a form is an *implement* — a caster's tool rather than a weight of
 * metal. Derived from the spec, not listed: a focus or totem off-hand, or a
 * main-hand belonging to one of the two caster classes. A form added later is
 * classified by what it is.
 */
function isImplement(form: FormId): boolean {
  const spec = FORMS[form];
  if (spec.offHandKind === 'focus' || spec.offHandKind === 'totem') return true;
  return (
    spec.slot === 'mainHand' &&
    !!spec.classLock?.some((c) => c === HeroClass.Mage || c === HeroClass.Healer)
  );
}

/**
 * The material motifs that are said differently on an implement.
 *
 * The material adjectives were written for arms and armour, and the
 * cross-product happily produced an "Iron Orb" and an "Iron Staff" — a
 * blacksmith's word on a conjurer's tool, which a playtest read as a generator
 * seam rather than as an item. The *stats and the model are untouched*: this is
 * one word per material, said differently when the thing being treated is a
 * focus rather than a blade (`items.implement.<motif>.pattern`: Leaden,
 * Tempered, Silvered). Elemental and mastery motifs already read naturally on
 * anything ("Frostbound Staff") and take no entry; `gold` is "Gilded"
 * everywhere, which was always right on both.
 */
const IMPLEMENT_MOTIFS: readonly MotifId[] = ['iron', 'steel', 'silver'];

/** Whether an item's name says its motif with the implement word — the one per-family naming seam. */
export function usesImplementWord(form: FormId, motif: MotifId): boolean {
  return isImplement(form) && IMPLEMENT_MOTIFS.includes(motif);
}

/**
 * How loudly a treatment is allowed to speak over the form it is applied to.
 *
 * Both tilts are normalised before they are mixed, so a *single-stat* motif
 * lands its whole weight on one axis while a form spreads its own across two or
 * three. At the old flat 0.5 that made `iron` — literally `{ defense: 1 }` —
 * worth a third of a weapon's entire budget on an axis the weapon has nothing
 * to do with: an Iron Throwing Blade was `+2 attack, +1 speed, +2 defense`
 * against the plain blade's `+3 attack, +1 speed`, i.e. a Hunter's weapon that
 * had traded away its own attack for armour. It is `+3 / +1 / +1` now.
 *
 * Three tiers, and the split is read off data that already exists
 * (`isMasteryMotif`, `MotifSpec.elemental`) rather than named motif by motif —
 * a motif added later is priced by what it *is*, not by being remembered here.
 *
 *  - **material** — iron, steel, silver, gold. What a thing is made of, and the
 *    quietest thing a treatment can be. This is the number the playtest report
 *    was about.
 *  - **elemental** — fire, ice, storm, nature, shadow, holy. A character rather
 *    than a metal, so it is allowed to be heard.
 *  - **mastery** — the twelve legendary set treatments. Deliberately the
 *    loudest: a set piece is a path's identity in an item, and `MOTIF_TILT`
 *    authors them to tilt hard on purpose. They are **not** exempt from the
 *    dominance clamp below, though — see the note there.
 */
const MOTIF_WEIGHT: Record<'material' | 'elemental' | 'mastery', number> = {
  material: 0.2,
  elemental: 0.35,
  mastery: 0.5,
};

/** Which of the three weights a motif is mixed at. Mastery wins over elemental. */
export function motifWeight(motif: MotifId): number {
  // A collection is a legendary's treatment as a set is, and is heard as loudly.
  if (isMasteryMotif(motif) || isCollectionMotif(motif)) return MOTIF_WEIGHT.mastery;
  return MOTIFS[motif].elemental ? MOTIF_WEIGHT.elemental : MOTIF_WEIGHT.material;
}

/** Normalises a tilt to weights summing to 1. An empty tilt spreads evenly across nothing. */
function normalise(tilt: StatTilt): StatTilt {
  const total = Object.values(tilt).reduce((a, b) => a + (b ?? 0), 0);
  if (total <= 0) return {};
  const out: StatTilt = {};
  for (const [k, v] of Object.entries(tilt) as [keyof ItemModifiers, number][]) {
    out[k] = v / total;
  }
  return out;
}

/**
 * The stats a form ranks highest.
 *
 * A **list**, because a tie has no single winner to protect: `band` is
 * `{ attack: 1, magic: 1, speed: 1 }` and `fetish` is `{ magic: 2, maxHp: 2 }`.
 * Picking one arbitrarily and holding the other two down to it would make every
 * Thunderwrought Band identical to the plain one — the clamp would delete the
 * treatment rather than temper it.
 */
export function primaryStats(tilt: StatTilt): (keyof ItemModifiers)[] {
  const entries = Object.entries(tilt) as [keyof ItemModifiers, number][];
  const top = entries.reduce((m, [, v]) => Math.max(m, v), 0);
  return entries.filter(([, v]) => v === top).map(([k]) => k);
}

/**
 * Mixes a motif into a form, and guarantees the form still wins.
 *
 * The weight above is what makes this true nearly everywhere; the clamp is what
 * makes it a rule rather than a tuning. **No stat may finish with a larger
 * share than the form's own top stat** — anything that would is held down to it
 * and the surplus is handed back to the rest by the closing `normalise`.
 *
 * **Mastery motifs are not exempt**, and that is the one judgement call here.
 * They are legendary, they are a path's identity, and they are authored to tilt
 * hard — every argument for letting them off. But a set piece is still a
 * *piece*: `bulwark` is `{ defense: 4, maxHp: 4 }` and the Bulwark's set weapon
 * is a warhammer, so exempting them ships a legendary hammer whose largest stat
 * is armour. A path that wants a defensive weapon should say so in the weapon's
 * form. What the exemption would buy — a louder set — is already bought by the
 * mastery weight and by a 6.5× budget, so it would be paid for with the one
 * thing the clamp exists to protect.
 */
export function combineTilts(form: StatTilt, motif: StatTilt, weight: number): StatTilt {
  const a = normalise(form);
  const b = normalise(motif);
  const out: StatTilt = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof ItemModifiers, number][]) {
    out[k] = (out[k] ?? 0) + v * weight;
  }

  const primaries = primaryStats(a);
  const cap = Math.max(0, ...primaries.map((k) => out[k] ?? 0));
  if (cap > 0) {
    for (const [k, v] of Object.entries(out) as [keyof ItemModifiers, number][]) {
      if (!primaries.includes(k) && v > cap) out[k] = cap;
    }
  }
  return normalise(out);
}

/** The finished split for one generated item — form, motif and the rules between them. */
export function finishedTilt(form: FormId, motif: MotifId): StatTilt {
  return combineTilts(FORMS[form].tilt, MOTIF_TILT[motif], motifWeight(motif));
}

/** Spends `points` across the tilted stats. Zero-value stats are dropped, not stored as 0. */
export function budgetToModifiers(
  points: number,
  tilt: StatTilt,
  /**
   * The item's rarity, which gates the stats only good gear may carry.
   *
   * Defaults to Epic so a caller that omits it gets the permissive answer and
   * nothing silently loses a stat. The only gated stats today are the two
   * penetrations: they are the answer to a wall, and finding one on a common
   * dagger would make the whole defence half of the game optional from level one.
   */
  rarity: Rarity = Rarity.Epic,
): ItemModifiers {
  const mods: ItemModifiers = {};
  const rich = rarity === Rarity.Epic || isLegendaryGrade(rarity);

  for (const [stat, share] of Object.entries(tilt) as [keyof ItemModifiers, number][]) {
    if (RARITY_GATED_STATS.includes(stat) && !rich) continue;
    const value = stat === 'manaRegen' && share > 0 ? Math.max(1, Math.round(points * share * STAT_PER_POINT[stat])) : Math.round(points * share * STAT_PER_POINT[stat]);
    if (value > 0) mods[stat] = value;
  }
  // A tilt that rounds to nothing still has to give something, or the item is a
  // strictly worse copy of an empty slot
  if (Object.keys(mods).length === 0) {
    const best = (Object.entries(tilt) as [keyof ItemModifiers, number][])
      .sort((x, y) => y[1] - x[1])[0];
    if (best) mods[best[0]] = 1;
  }
  return mods;
}

/**
 * Which class may use a generated item.
 *
 * Commons carry no lock *except* weapons — a bow in a mage's hands was never
 * the plan. Common armour is still held to its weight, but by `canEquip` asking
 * the wearer's path (`wearableWeights`) rather than by a lock. Off-hands return nothing because
 * `offHandKind` already restricts them by class, and a second lock would only
 * be a chance to disagree with the first.
 */
export function classLockFor(form: FormId, motif: MotifId): HeroClass[] | undefined {
  const spec = FORMS[form];
  if (spec.offHandKind) return undefined;

  const rarity = MOTIF_RARITY[motif];
  if (spec.slot === 'mainHand') return spec.classLock;
  if (rarity === Rarity.Common) return undefined;

  // Armour takes its class from the weight, jewellery from the motif
  return spec.classLock ?? MOTIF_CLASS[motif];
}

/**
 * A generated template's id.
 *
 * A form's **base** variant keeps the id it has always had — `short_sword_iron`
 * — so the starter kit, the path grants, every authored loot table and every
 * save written before variants existed still name the same template. Any other
 * variant is spelled by its own id: `falchion_iron`. Variant ids never collide
 * with form ids or each other, so neither does this.
 */
export function generatedItemId(form: FormId, motif: MotifId, variant?: ModelVariantId): string {
  return `${variant && variant !== form ? variant : form}_${motif}`;
}

/**
 * The form × motif a template is one silhouette of — the key the shop, the
 * market and the forge group variants under, so a form drawn two ways is not
 * twice as likely to be stocked. A unique is its own family.
 */
export function templateFamily(template: Pick<ItemTemplate, 'id' | 'form' | 'motif' | 'variant'>): string {
  return template.variant ? generatedItemId(template.form, template.motif) : template.id;
}

/**
 * Templates grouped by `templateFamily`, in the order each family first
 * appears. The unit a rack is stocked in.
 */
export function familiesOf<T extends Pick<ItemTemplate, 'id' | 'form' | 'motif' | 'variant'>>(templates: T[]): T[][] {
  const out = new Map<string, T[]>();
  for (const t of templates) {
    const key = templateFamily(t);
    const list = out.get(key);
    if (list) list.push(t);
    else out.set(key, [t]);
  }
  return [...out.values()];
}

function buildTemplate(form: FormId, motif: MotifId, variant?: ModelVariantId): ItemTemplate {
  const spec = FORMS[form];
  const rarity = MOTIF_RARITY[motif];
  const points = itemBudget(spec) * RARITY_SCALE[rarity];
  const tilt = finishedTilt(form, motif);

  // No words here: a piece's name and description are built when shown, from
  // its form, motif and variant (`itemText.itemName`)
  return {
    id: generatedItemId(form, motif, variant),
    rarity,
    slot: spec.slot,
    form,
    motif,
    // Every held template names its silhouette, base included, so an instance
    // says which model it is without anybody decoding its template id.
    ...(variant ? { variant } : {}),
    handRule: spec.handRule,
    offHandKind: spec.offHandKind,
    classLock: classLockFor(form, motif),
    // A set piece belongs to one path, not one class — a Bulwark cuirass on a
    // Berserker would be the wrong half of "you chose this"
    masteryLock: isMasteryMotif(motif) ? [motif] : undefined,
    // A later world's motifs are that world's loot (`worldGear.ts`)
    ...(motifWorld(motif) ? { world: motifWorld(motif) } : {}),
    modifiers: budgetToModifiers(points, tilt, rarity),
    sellPrice: Math.max(1, Math.round(points * 6)),
  };
}

/**
 * The full generated library. Uniques are added on top in `itemTemplates.ts`.
 *
 * Form × motif × variant, with the variant innermost so each form × motif's
 * silhouettes sit together. **Legendary set pieces are drawn in the base
 * variant only**: a set is authored as one look per path (see
 * `voxel/models/looks/`), and drawing a Bulwark hammer three ways would make
 * the set a family rather than a set.
 */
export function generateItemTemplates(): ItemTemplate[] {
  const out: ItemTemplate[] = [];
  for (const form of FORM_IDS) {
    const variants = variantsOf(form);
    // Set motifs are listed per form rather than in `FORMS[form].motifs`, so a
    // Nightveil Cuirass exists without every hide piece also gaining eleven
    // other set variants it has no business in
    for (const motif of FORMS[form].motifs) {
      if (variants.length === 0) out.push(buildTemplate(form, motif));
      for (const variant of variants) out.push(buildTemplate(form, motif, variant));
    }
    for (const motif of masterySetMotifsFor(form)) {
      out.push(buildTemplate(form, motif, variants[0]));
    }
    // A world's own motifs, kept off `FORMS[form].motifs` so the Empire's pools
    // stay as they were. Ordinary ones come in every silhouette, as the Empire's
    // do; a collection is armour, so it has none.
    for (const motif of worldMotifsFor(form)) {
      if (variants.length === 0) out.push(buildTemplate(form, motif));
      for (const variant of variants) out.push(buildTemplate(form, motif, variant));
    }
  }
  return out;
}
