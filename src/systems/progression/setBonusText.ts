import { Hero, Item, MasteryId, SkillId } from '@/models/types';
import { t } from '@/i18n';
import { pathName, skillName, pathName as masteryPathName } from '@/data/gameText';
import { findMasteryPath } from '@/data/skills/masteryData';
import { bonusFitsWearer, bonusPathOf, isCollectionPiece } from '@/data/items/setBonus';
import { findSkill, gearSkillBonusSources } from '@/systems/progression/mastery';
import { itemDisplayName } from '@/systems/progression/upgrades';
import { MASTERY_SET_FORGE_LEVEL } from '@/systems/economy/forge';
import { setFormsOf } from '@/data/items/itemForms';
import { COLLECTION_IDS, isCollectionMotif } from '@/data/items/collections';
import { isLegendaryGrade, isMythic, setPieceWeight } from '@/data/items/rarity';
import { matchingSetPieces } from '@/systems/progression/achievementEquipment';
import {
  FIVE_BONUS, THREE_BONUS, fiveValue, threeValue, tiersOf, wornCollectionPieces,
  type FiveBonus, type SetId, type SetTier, type ThreeBonus,
} from '@/systems/progression/setBonuses';

/**
 * A legendary's rolled skill bonus, in words, wherever a piece is shown.
 *
 * Here rather than in `itemDisplay`, which may not reach the skill registry. A
 * collection piece names the path its skill belongs to, because that path need
 * not be the wearer's: a Jade Bastion helm worn by a Templar may carry a Beetle
 * skill. **A mismatch is said, never hidden** — the bonus is applied to the named
 * skill whoever wears the piece, so on a hero without it the bonus does nothing,
 * and the line says so and names the repair (the forge's re-aim).
 */
export interface SetBonusText {
  /** "+12% Shield Wall · Bulwark". */
  text: string;
  /** Set when shown against a wearer whose path the bonus is not for. */
  warning?: string;
}

/** The bonus line for a piece, or null when it carries none. */
export function setBonusText(
  item: Pick<Item, 'rarity' | 'masteryLock' | 'motif' | 'setBonus'>,
  wearer?: Pick<Hero, 'masteryPath'>,
): SetBonusText | null {
  const bonus = item.setBonus;
  if (!bonus) return null;
  const found = findSkill(bonus.skillId);
  const skill = found ? skillName(found) : bonus.skillId;
  const path = bonusPathOf(item);
  const pathText = path ? pathTitle(path) : null;
  // A set piece's path is the only one that can wear it, so naming it says
  // nothing; a collection's is the whole point of the line
  const text = isCollectionPiece(item) && pathText
    ? t('items.setBonus.lineWithPath', { percent: bonus.percent, skill, path: pathText })
    : t('items.setBonus.line', { percent: bonus.percent, skill });
  if (!wearer || !isCollectionPiece(item) || bonusFitsWearer(item, wearer)) return { text };
  return {
    text,
    warning: wearer.masteryPath
      ? t('items.setBonus.notThisPath', { level: MASTERY_SET_FORGE_LEVEL })
      : t('items.setBonus.forPath', { path: pathText ?? '', level: MASTERY_SET_FORGE_LEVEL }),
  };
}

/** A path's name, or its id where it has no tree to name it. */
function pathTitle(path: MasteryId): string {
  const found = findMasteryPath(path);
  return found ? pathName(found) : path;
}

/**
 * "+12% from Bulwark's Helm", one per worn piece that raises this skill: the
 * line under a skill's description in the mastery tree and the Skills tab
 * (PT-38), so a bonus is seen where the skill is read and not only on the item.
 * Empty when nothing worn bonuses it.
 */
export function skillBonusSourceLines(
  hero: Pick<Hero, 'masteryPath'> & Partial<Pick<Hero, 'equipment'>>,
  skillId: SkillId,
): string[] {
  return gearSkillBonusSources(hero, skillId)
    .map(({ percent, item }) => t('items.setBonus.fromItem', { percent, item: itemDisplayName(item) }));
}

/** One tier of a set's bonus, said, and whether the worn pieces have reached it. */
export interface SetCardLine {
  tier: SetTier;
  text: string;
  active: boolean;
}

/** A piece's set at a glance, for the item card and the gear screen. */
export interface SetCardView {
  /** "Emberlord 3/7", or "Emberlord 3/7 if worn" for a piece not yet on. */
  header: string;
  lines: SetCardLine[];
}

/** Bonuses authored as a fraction, said as a percent; the rest are already a plain number. */
const FRACTION_THREE: ReadonlySet<ThreeBonus> = new Set(['hp', 'damage', 'spell', 'armour']);
const FRACTION_FIVE: ReadonlySet<FiveBonus> = new Set(['barrier', 'bleed', 'burn', 'brittle', 'lifebloom', 'form', 'marked', 'reap']);

/** The skill a five-piece bonus names in its sentence, where it names one. */
const FIVE_SKILL_NAME: Partial<Record<FiveBonus, SkillId>> = {
  smite: 'smite', chain: 'chain_lightning', lifebloom: 'lifebloom_skill', bladeRecall: 'blade_recall',
  carapace: 'iron_carapace', glowmote: 'glowmote',
};

/** A set's name: its pattern without the noun ("Emberlord"). */
export function setName(set: SetId): string {
  return t(`items.motif.${set}.pattern`, { noun: '' }).replace(/\s+/g, ' ').trim();
}

/** The set a piece belongs to: a collection's, or the path its set is locked to. */
function setOfItem(item: Pick<Item, 'rarity' | 'masteryLock' | 'motif'>): SetId | undefined {
  if (!isLegendaryGrade(item.rarity)) return undefined;
  if (isCollectionMotif(item.motif)) return COLLECTION_IDS.find((c) => c === item.motif);
  return item.masteryLock?.[0];
}

function bonusText(set: SetId, tier: SetTier): string {
  const skillOf = (id?: SkillId) => {
    const found = id ? findSkill(id) : undefined;
    return found ? skillName(found) : (id ?? '');
  };
  if (tier === 3) {
    const bonus = THREE_BONUS[set];
    const v = threeValue(bonus);
    return t(`items.set.three.${bonus}`, { n: FRACTION_THREE.has(bonus) ? Math.round(v * 100) : v });
  }
  const bonus = FIVE_BONUS[set as MasteryId];
  const v = fiveValue(bonus);
  return t(`items.set.five.${bonus}`, { n: FRACTION_FIVE.has(bonus) ? Math.round(v * 100) : v, skill: skillOf(FIVE_SKILL_NAME[bonus]) });
}

/**
 * The set progress a piece shows beside its stats: the set's name and how many
 * pieces the hero has of it, and each tier's bonus — greyed by `active` until
 * the count reaches it. A piece not yet worn counts as if it were, and a mythic
 * counts as two, which the header says. Null for a piece with no set, or a set of
 * another path.
 */
export function setCardView(
  item: Pick<Item, 'id' | 'templateId' | 'rarity' | 'masteryLock' | 'motif'>,
  hero: Hero,
  worn: readonly Item[],
): SetCardView | null {
  const set = setOfItem(item);
  if (!set) return null;
  const isCollection = isCollectionMotif(set);
  if (!isCollection && hero.masteryPath !== set) return null;

  const equipped = Object.values(hero.equipment);
  const onHero = worn.filter((w) => equipped.includes(w.id));
  const owned = isCollection
    ? (wornCollectionPieces(hero, worn)[set as never] ?? 0)
    : matchingSetPieces(hero, worn);
  // Worn in place of any copy of its template, which the count holds once, so a
  // mythic swapped in for its legendary is one more and the reverse one fewer.
  const sameTemplate = onHero.filter((w) => w.templateId === item.templateId);
  const replaced = Math.max(0, ...sameTemplate.map(setPieceWeight));
  const wearing = equipped.includes(item.id);
  const count = wearing ? owned : owned - replaced + setPieceWeight(item);
  const alreadyCounted = wearing || count === owned;
  const total = isCollection ? 4 : setFormsOf(set as MasteryId).length;
  // A mythic beside the count is why the number outruns the pieces on the body.
  const doubled = isMythic(item) || onHero.some((w) => isMythic(w) && setOfItem(w) === set);
  const header = doubled
    ? (alreadyCounted ? 'items.set.headerMythic' : 'items.set.headerWouldMythic')
    : (alreadyCounted ? 'items.set.header' : 'items.set.headerWould');

  return {
    // Double counts can pass the set's size; the bonuses stop at its last tier anyway.
    header: t(header, { name: setName(set), count: Math.min(count, total), total }),
    lines: tiersOf(set).map((tier) => ({
      tier,
      text: t('items.set.tier', { pieces: tier, effect: bonusText(set, tier) }),
      active: count >= tier,
    })),
  };
}
