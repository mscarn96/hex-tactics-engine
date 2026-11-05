import { Hero, Item } from '@/models/types';
import { useCityStore } from '@/stores/cityStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { mealTier, mealRationFraction } from '@/systems/economy/expeditionMeals';
import { bagKindCap } from '@/data/items/bagKinds';
import { heroMaxHp } from '@/systems/progression/statCalc';
import { t } from '@/i18n';

/**
 * Food: the one heal you carry.
 *
 * Everything else that mends a hero is a *place* or a *time* — the dawn heal is
 * a night, the magic well is a walk to a well, the tavern bed is a walk back to
 * the city. That left the field with no answer at all: a party three days out
 * with one hero at a sliver either turned round or fought at a sliver. A ration
 * is the answer with a price on it, spent on one named hero, out of combat only.
 *
 * **The rule lives here, not in the screen that presses the button.** It is a
 * pure function of (hero, rations held) in and (heal, refusal) out, which is the
 * standing rule this codebase learned from `victoryRewards` and
 * `defeatPenalties` — both were functions of their arguments trapped in a
 * `useEffect`, and that is the entire reason neither had a test for so long.
 *
 * It is deliberately *not* a `HeroSkill` or a status effect: a ration is a
 * stack in the bag (`BagEntry` of kind `ration`, declared in
 * `data/items/bagKinds.ts`), eaten from the bag's panel.
 */

/** The most rations a party of this size may carry: the ration kind's cap, `RATIONS_PER_HERO` for each hero. */
export const rationCap = (partySize: number): number => bagKindCap('ration', partySize) ?? 0;

/** Whether one more fits in the pack. A party that shrank past its cap simply cannot pack more. */
export const canPackRation = (rationsHeld: number, partySize: number): boolean =>
  rationsHeld < rationCap(partySize);

/** Why a hero will not eat. Reported to the player, never swallowed. */
export type RationRefusal =
  /** Nothing in the pack. */
  | 'empty'
  /** Already at their effective ceiling — see `heroMaxHp`. */
  | 'whole'
  /** At zero. Food does not raise the dead; a magic well or a Tavern rest does. */
  | 'fallen';

/**
 * The answer, in the `canEquip` shape the equip screen already speaks.
 *
 * `{ ok: false, reason }` carries the sentence rather than only the tag,
 * because both refusals must be *said*: a button that quietly does nothing is
 * indistinguishable from a broken one, and the "food cannot revive" rule is a
 * design decision the player has no way to infer from a greyed-out control.
 */
export type MealResult =
  | {
      ok: true;
      /** HP the ration actually restores, already clipped to what is missing. */
      healed: number;
      /** The hero's health afterwards. Never above `heroMaxHp`. */
      currentHp: number;
    }
  | { ok: false; refusal: RationRefusal; reason: string };

/**
 * What one ration is worth to this hero, before any clipping.
 *
 * Measured against `heroMaxHp` and never `hero.baseStats.maxHp`. That is the
 * rule the whole store once got wrong in four places at once — base stats carry
 * no gear and no mastery nodes, so a fraction of them mends *less* the better
 * equipped the hero is, and the ration would visibly do less the further into
 * the campaign it was eaten. Rounded up so the smallest bar in the game still
 * gets a whole point out of a meal.
 */
export function rationHeal(hero: Hero, items?: Item[]): number {
  return Math.ceil(heroMaxHp(hero, items) * mealRationFraction(mealTier(useCityStore.getState().meal, useCalendarStore.getState().weekNumber)));
}

const REFUSAL_TEXT: Record<RationRefusal, (name: string) => string> = {
  empty: () => t('economy.ration.empty'),
  whole: (name) => t('economy.ration.whole', { name }),
  // Says what *does* work, because the alternative is a player concluding the
  // button is broken. Both revives are named: a magic well out on the map
  // (`drinkMagicWell`) and a rest at the Tavern in town (`restAll` fills the
  // fallen too). Food undercutting them would delete the reason to walk to one.
  fallen: (name) => t('economy.ration.fallen', { name }),
};

/**
 * Feed one hero one ration.
 *
 * State in, state out: the caller owns both writes (decrement the counter,
 * write the HP) and this owns the arithmetic and every refusal. `items` is the
 * hero's resolved loadout, threaded through to `heroMaxHp` exactly as the rest
 * of `statCalc`'s callers thread it — omitted, that function reads the bag
 * itself, which is right everywhere except a preview.
 *
 * The order of the refusals is the order they are true in: a fallen hero with
 * an empty pack is told about the pack, because that is the one they can fix.
 */
export function eatRation(hero: Hero, rationsHeld: number, items?: Item[]): MealResult {
  if (rationsHeld <= 0) {
    return { ok: false, refusal: 'empty', reason: REFUSAL_TEXT.empty(hero.name) };
  }
  if (hero.currentHp <= 0) {
    return { ok: false, refusal: 'fallen', reason: REFUSAL_TEXT.fallen(hero.name) };
  }

  const max = heroMaxHp(hero, items);
  if (hero.currentHp >= max) {
    return { ok: false, refusal: 'whole', reason: REFUSAL_TEXT.whole(hero.name) };
  }

  // Clipped to what is actually missing, so the number the toast reports is the
  // number the bar moves by. A ration eaten one point below full is still a
  // whole ration spent — the refusal above is what protects the player from
  // that, and only at *exactly* full, which is the honest place to draw it.
  const healed = Math.min(rationHeal(hero, items), max - hero.currentHp);
  return { ok: true, healed, currentHp: hero.currentHp + healed };
}
