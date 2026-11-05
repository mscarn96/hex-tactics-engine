import { HeroStats, SkillId, WildFormId } from '@/models/types';

/**
 * The Wildshape beasts.
 *
 * A form is three things: a silhouette, a stat profile and a kit. Shifting swaps
 * all three at once — a bear does not cast, and a Druid who wants to heal has to
 * stand up first. That trade is the whole path.
 *
 * **`maxHp` is still absent from every `stats` profile** — that field is shared
 * with boss phases, whose triggers are HP thresholds, so a multiplier there
 * would re-fire the transition that set it. Health instead lives on `vigor`,
 * which only Wildshape reads.
 *
 * That distinction is new, and it is the fix for a real playtest failure: with
 * no health pool at all, the Bear was a tank that died faster than the Druid,
 * and the strongest way to survive a fight was to stay upright and heal
 * yourself. Scaling current HP in step on the way in and out is what makes it
 * safe — the fraction is preserved, so nothing is banked or burned — and
 * `applyVictory` clamps to the hero's own maximum in case a fight ends
 * mid-shift.
 *
 * Multipliers, not flat bonuses: a level-20 Druid's bear should be a level-20
 * bear. Flat numbers would make shifting a strong opening and a bad lategame.
 */
/**
 * A Wildshape form. Its name and its description (shown in the unit dialog while
 * worn) are `units.form.<id>.*`, read through `wildFormName` / `wildFormDescription`.
 */
export interface WildForm {
  id: WildFormId;
  /** `MODEL_DEFS` key for the beast. */
  modelKey: string;
  /**
   * Multipliers on the hero's own stats. An omitted stat is carried unchanged.
   * `speed` is omitted throughout on purpose — turn order is sorted once at the
   * start of combat and never re-sorted, so a speed change mid-fight is a number
   * that does nothing.
   */
  stats: Partial<Record<keyof HeroStats, number>>;
  /**
   * Multiplier on max HP, applied to the current total in step so the health
   * bar keeps its fraction across a shift.
   *
   * Separate from `stats` because `stats` is shared with boss phases, where a
   * max-HP multiplier would re-trigger the very threshold that fired it. Here
   * there are no thresholds, so the objection does not apply — and without it
   * Bear was a tank with no health pool, which is to say not a tank.
   */
  vigor?: number;
  /**
   * Which of the beast's own stats the Druid's magic is worth, once worn.
   *
   * A Druid's gear is magic-tilted by construction — `WEIGHT_TILT.vestment` is
   * `{magic: 2, maxHp: 2, defense: 1}` and `branch` is `{magic: 3}` — and every
   * shape below cuts magic to less than half. So a fully-geared Druid used to
   * shift into a bear that had gained *nothing* from any of it, which makes the
   * path's whole loot table dead weight the moment the shape goes on.
   *
   * The claw shapes and the Apex turn it into reach and the bear turns it into
   * meat. The Apex kept its magic (`magic: 1.0`) without converting it until the
   * remaster (2026-10); its three spells all scale off Attack, so a magic-geared
   * Druid's Apex hit softer than its own Wolf. It now converts like the claws.
   */
  magicConverts?: 'attack' | 'maxHp';
  /**
   * The pair the shape arrives with: a free basic attack, then a signature.
   *
   * Innate and unbought — a shape you had to fill in over three purchases
   * before it beat standing still would be a node that makes you worse. What
   * the tree adds on top is marked `formSkill` on the skill itself and picked up
   * by `skillsForForm`, so this list stays exactly the two you always have.
   */
  skills: SkillId[];
  /** Tint for the shift flash and the form badge. */
  color: string;
}

export const WILD_FORMS: Record<WildFormId, WildForm> = {
  bear: {
    id: 'bear',
    modelKey: 'wild_bear',
    stats: { attack: 1.25, defense: 1.8, magic: 0.4, moveRange: 1 },
    // The whole point of the shape. Defence alone was not enough: it scales
    // against one hit at a time, and what a tank needs is to still be there
    // after eight of them.
    vigor: 1.5,
    magicConverts: 'maxHp',
    skills: ['maul', 'roar'],
    color: '#aa7744',
  },
  wolf: {
    id: 'wolf',
    modelKey: 'wild_wolf',
    stats: { attack: 1.4, defense: 0.9, magic: 0.4, moveRange: 2 },
    magicConverts: 'attack',
    skills: ['rip', 'pounce'],
    color: '#8899aa',
  },
  hawk: {
    id: 'hawk',
    modelKey: 'wild_hawk',
    // The only form that trades defence away outright — the compensation is
    // range and a move range nothing else on the field can match. Evasion would
    // suit it better than raw defence, but `dodgeChance` is optional on
    // `HeroStats` and multiplying an absent value yields nothing at all.
    //
    // The attack multiplier is the highest of the three, above the Wolf's 1.4,
    // and that is the correction rather than an escalation. At 1.1 the Hawk was
    // behind the Wolf on offence *and* the squishiest thing on the board, with
    // nothing but reach to show for it — and reach does not pay in a 61-hex
    // arena where anything worth hitting is four hexes away at worst. A shape
    // has to be the best at something or it is a node that makes you worse; the
    // Bear owns survival and the Wolf owns sustained melee, so what is left for
    // the Hawk is the hardest single strike from somewhere nothing can answer.
    //
    // Defence moves 0.6 → 0.7, and honestly this one was nearly all latent
    // under the old flat mitigation (`defense × 0.4` off each hit). Defence is a
    // share of the hit now (`defenceReduction`), so the step is worth a few
    // percent at every level rather than a rounding error at low ones. Kept because the shape should not
    // scale worse with armour than its siblings do, not because it is what
    // fixed the Hawk: the attack multiplier and the kit below did that.
    // It stays the lowest in the table by a wide margin — the shape is still
    // supposed to die to anything that reaches it.
    //
    // Attack 1.45 → 1.55 (playtest 2026-10-14: "its attack is too low"). The
    // most the shape band in `wildForms.test.ts` allows: the Bear and the Wolf
    // stay within ×1.35 of it. A tuning starting point for device play.
    stats: { attack: 1.55, defense: 0.7, magic: 0.5, moveRange: 3 },
    magicConverts: 'attack',
    skills: ['talons', 'dive'],
    color: '#c8b070',
  },
  apex: {
    id: 'apex',
    modelKey: 'wild_apex',
    // The three-turn burst (remaster, 2026-10): it has to out-hit every shape it
    // can be entered from, *resolved* — so the Attack multiplier leads the table
    // and the Druid's magic converts into Attack as the claws' does (`magic` drops
    // to the claws' level for the same reason theirs did). `wildForms.test.ts`
    // checks the resolved Attack against the Wolf and Hawk at caster gear.
    stats: { attack: 1.8, defense: 1.6, magic: 0.5, moveRange: 2 },
    magicConverts: 'attack',
    // Better than any one shape at everything, health included — but under the
    // Bear, which stays the specialist at the one thing it does
    vigor: 1.4,
    // Three, uniquely, and each usable once per visit (`apexSpent`): the shape is
    // where the ultimate lives, and it has no branch to learn anything from.
    skills: ['crowned_prey', 'antler_charge', 'primal_wrath'],
    color: '#9dff6a',
  },
};

// What the shape you started in is called is `humanFormName()` (`unitText.ts`): a
// hard-coded "Druid Form" rather than the class's display name, because Wildshape is
// a Druid path and nothing else can ever hold a shift skill — and a shift button
// reading "Bear Form" while you *are* the bear says the opposite of what pressing it does.

export const WILD_FORM_IDS = Object.keys(WILD_FORMS) as WildFormId[];

export function findWildForm(id: WildFormId): WildForm {
  return WILD_FORMS[id];
}

/**
 * What one point of the Druid's own magic is worth to a beast, per target stat.
 *
 * Two numbers rather than one because a point of health and a point of attack
 * are not worth the same thing, and the ratio between them is not a taste — it
 * is already written down in every stat block in the game. A mid-campaign Druid
 * carries `maxHp: 100` against `attack: 20`, so health is priced at a fifth,
 * and `1.5 = 0.3 × 5` keeps the bear's share and the wolf's share worth the same
 * amount of Druid.
 *
 * Sized against the shape's *own* contribution rather than against nothing: at
 * `magic 16 / attack 20 / maxHp 100` the Wolf's `×1.4` is worth `+8` attack and
 * this adds `+5`, and the Bear's `×1.5` vigor is worth `+50` health and this
 * adds `+24`. Roughly half, in both cases — enough that magic gear is worth
 * wearing into a shape, not so much that the shape stops being what the numbers
 * are mostly made of.
 *
 * Kept here beside `magicConverts` rather than in `BALANCE` because two callers
 * need them — `wildshape.wornForm` for the bear and `getCombatEffectiveStats`
 * for the claws — and a rate that lived apart from the table saying which stat
 * it feeds is half a rule in each place.
 */
export const MAGIC_CONVERSION: Record<NonNullable<WildForm['magicConverts']>, number> = {
  attack: 0.3,
  maxHp: 1.5,
};

/**
 * The flat bonus a shape hands its wearer for the magic it just took away.
 *
 * **Reads the Druid's own magic, before the form's multiplier.** A beast's magic
 * is `×0.4`–`×0.5` precisely because it cannot cast, so converting the *worn*
 * value would pay out on the number the shape exists to throw away — and would
 * make a shape that cut magic harder also convert less, which is backwards.
 * What is being converted is the caster the Druid stopped being.
 *
 * `scale` is the shape node's own level factor, so a levelled shape converts
 * more for the same reason it multiplies harder — see `wornForm`.
 */
export function magicConversion(
  magic: number,
  form: WildFormId,
  scale = 1,
): Partial<Record<'attack' | 'maxHp', number>> {
  const target = WILD_FORMS[form].magicConverts;
  if (!target || magic <= 0) return {};
  const gain = Math.round(magic * MAGIC_CONVERSION[target] * scale);
  return gain > 0 ? { [target]: gain } : {};
}
