import {
  AffixId, EquipSlot, FormId, ItemModifiers, ItemSlot, ItemTemplate, ModelVariantId, MotifId, Rarity,
} from '@/models/types';
import { t, type MessageKey } from '@/i18n';
import { composeName, type Gender } from '@/i18n/grammar';
import {
  NOUN_GENDERS, UNIQUE_GENDERS, type NounKey, type UniqueNameKey,
} from '@/i18n/itemGenders';
import { findAffix } from '@/data/items/itemAffixes';
import { usesImplementWord } from '@/data/items/itemGen';

/**
 * What a piece of gear is called and how it is described, in the current
 * language, built when shown.
 *
 * An item keeps ids — its template, form, motif, silhouette and affixes — and
 * no words: a name stored at mint would not follow a language change, and a
 * Polish name has to agree with its noun's gender, which only the parts know.
 * The words are the `items` namespace; the Polish genders are
 * `i18n/itemGenders.ts`. See the private project notes,
 * "Generated names".
 */

/** What naming a piece needs: its template and its parts. */
export type NamedItem = Pick<ItemTemplate, 'form' | 'motif' | 'variant'> & {
  affixes?: AffixId[];
} & ({ templateId: string } | { id: string });

const key = (k: string) => `items.${k}` as MessageKey;

/** The template a piece was made from: an instance's `templateId`, a template's own `id`. */
function templateOf(item: NamedItem): string {
  return 'templateId' in item ? item.templateId : item.id;
}

/** Whether a template is one of the authored legendaries, named rather than generated. */
export function isUniqueTemplate(templateId: string): templateId is UniqueNameKey {
  return Object.prototype.hasOwnProperty.call(UNIQUE_GENDERS, templateId);
}

/** The noun a form drawn as `variant` goes by: the variant's own, or the form's for its base. */
function nounKeyOf(form: FormId, variant?: ModelVariantId): NounKey {
  return (variant && variant !== form && variant in NOUN_GENDERS ? variant : form) as NounKey;
}

/** A form's noun: "Short Sword" / "Krótki miecz". */
export function formNoun(form: FormId): string {
  return t(key(`noun.${form}`));
}

/** The noun an item of `form` drawn as `variant` goes by: "Falchion". */
export function variantNoun(form: FormId, variant?: ModelVariantId): string {
  return t(key(`noun.${nounKeyOf(form, variant)}`));
}

/**
 * The name pattern a motif uses on a form: its own, or the material word said
 * on a caster's tool ("Leaden Orb", not "Iron Orb").
 */
export function motifPattern(form: FormId, motif: MotifId): string {
  return usesImplementWord(form, motif)
    ? t(key(`implement.${motif}.pattern`))
    : t(key(`motif.${motif}.pattern`));
}

const HOLE = '\u0000';

/**
 * `inner` (a name already built) set into an affix pattern. Polish agrees the
 * pattern's marked words with `gender` and lowers the inner name's first
 * letter where it is no longer first, unless it is a proper name.
 */
function wrap(pattern: string, inner: string, gender: Gender, _proper: boolean): string {
  const filled = composeName(pattern, HOLE, gender);
  return filled.replace(HOLE, inner);
}

/**
 * A piece's name: "Keen Frostbound Falchion of the Wind" / "Ostry mroźny tasak
 * wiatru". An authored legendary is its own proper name, with any affixes
 * around it. The prefix goes in front and the suffix after, one of each at most.
 */
export function itemName(item: NamedItem): string {
  const template = templateOf(item);
  let name: string;
  let gender: Gender;
  let proper = false;
  if (isUniqueTemplate(template)) {
    name = t(key(`unique.${template}.name`));
    gender = UNIQUE_GENDERS[template];
    proper = true;
  } else {
    const noun = nounKeyOf(item.form, item.variant);
    gender = NOUN_GENDERS[noun];
    name = composeName(motifPattern(item.form, item.motif), t(key(`noun.${noun}`)), gender);
  }
  const specs = (item.affixes ?? []).map(findAffix);
  const prefix = specs.find((s) => s?.kind === 'prefix');
  const suffix = specs.find((s) => s?.kind === 'suffix');
  if (suffix) name = wrap(t(key(`affix.${suffix.id}.pattern`)), name, gender, proper);
  if (prefix) name = wrap(t(key(`affix.${prefix.id}.pattern`)), name, gender, proper);
  return name;
}

/** A piece's one-line description: an authored legendary's own, or its motif's flavour. */
export function itemDescription(item: NamedItem): string {
  const template = templateOf(item);
  return isUniqueTemplate(template)
    ? t(key(`unique.${template}.description`))
    : t(key(`motif.${item.motif}.flavour`));
}

/** An affix on its own, as the line under a name shows it: "Keen", "of the Wind". */
export function affixName(id: AffixId): string {
  return t(key(`affix.${id}.name`));
}

/** A gear slot's label: "Main Hand". Both rings are "Ring"; `twoHands` labels a two-hander. */
export function slotLabel(slot: EquipSlot | ItemSlot | 'twoHands'): string {
  return t(key(`slot.${slot === 'ring1' || slot === 'ring2' ? 'ring' : slot}`));
}

/** A rarity as a word: "Rare", "Legendary". */
export function rarityName(rarity: Rarity): string {
  return t(key(`rarity.${rarity}`));
}

/** What an item's stat line calls a modifier: "Crit Chance", "Physical Defence". */
export function modifierLabel(stat: keyof ItemModifiers): string {
  return t(key(`modifier.${stat}`));
}
