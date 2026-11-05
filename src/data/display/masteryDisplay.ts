/**
 * How a mastery node's grants read to a player.
 *
 * Sibling to `statusDisplay` / `skillDisplay` / `itemDisplay`, and pure for the
 * same reason: these are measurable claims about words shown on a screen, and
 * `masteryLabels.test.ts` checks them in the node environment, which cannot
 * import anything that reaches React Native.
 *
 * It lived inside `MasteryScreen.tsx`, which is why it was never swept — and it
 * had drifted badly. `MODIFIER_LABEL` covered seven keys against the eighteen
 * the twelve trees actually grant, and the caller's fallback printed the raw
 * field name, so a Stoneshaper node advertised "aoeDamageBonus 0.15" and a
 * Lifewarden's "healRestoresMana 6".
 *
 * The words are in the `masteryCommon` catalog, looked up when shown.
 */
import { WildFormId } from '@/models/types';
import { arcanistRowTwo, bladesCap, secondNatureMaxSteps } from '@/systems/combat/displayNumbers';
import { formScale, wornFormAt } from '@/systems/combat/wildshape';
import { resourcePerTurn, resourceShort, usesChi } from '@/data/classResource';
import { formatDecimal, formatNumber, formatPercent, t, type MessageKey } from '@/i18n';

/**
 * The five core stats, then the seven past them that each feed exactly one
 * system — as keys into `masteryCommon.stat.*`, read through `statLabel`.
 *
 * The second group was missing entirely, so a Lifewarden's node offered
 * "+8 healPower" and a Stoneshaper's "+6 shieldPower" — the same raw-identifier
 * leak the modifiers had, one field over, and the reason the suite sweeps both.
 */
export const STAT_LABELS: Record<string, MessageKey> = Object.fromEntries(
  [
    'maxHp', 'attack', 'defense', 'magicDefense', 'magic', 'speed', 'moveRange', 'maxMana',
    'critChance', 'critDamage', 'dodgeChance', 'armourPen', 'magicPen',
    'healPower', 'shieldPower', 'poisonPower', 'lifesteal', 'manaRegen',
  ].map((key) => [key, `masteryCommon.stat.${key}` as MessageKey]),
);

/** A stat's short label ("HP" / "PŻ"), or the key itself for a stat with none. */
export function masteryStatLabel(key: string): string {
  const label = STAT_LABELS[key];
  return label ? t(label) : key;
}

/**
 * A stat's label on a node that belongs to `heroClass`: the Monk's pool is chi,
 * so a Monk node that raises it says "+8 Chi" where everyone else's says MP
 * (`classResource`). Every other stat reads as `STAT_LABELS` has it.
 */
export function nodeStatLabel(key: string, heroClass: string | undefined): string {
  if (usesChi(heroClass)) {
    if (key === 'maxMana') return resourceShort('chi');
    if (key === 'manaRegen') return resourcePerTurn('chi');
  }
  return masteryStatLabel(key);
}

const modifierKey = (key: string) => `masteryCommon.modifier.${key}` as MessageKey;

/**
 * Percentages are rounded rather than shown at a rank's true precision.
 *
 * A rung lands on figures like 0.1125, and a panel full of decimals reads as a
 * bug where a whole number reads as a number. `formatPercent` rounds.
 */
const pct = (key: string) => (v: number) => t(modifierKey(key), { percent: formatPercent(v) });
/** A whole number: hexes, a radius, defence, mana. */
const whole = (key: string) => (v: number) => t(modifierKey(key), { value: formatNumber(v) });
/** A count of turns, which is a plural entry. */
const turns = (key: string) => (v: number) => t(modifierKey(key), { count: v });

/**
 * One line of prose per modifier key.
 *
 * **Every key the trees grant must appear here** — see the suite. A missing
 * entry is invisible at runtime: the panel draws, the node works, and only the
 * words are wrong.
 */
export const MODIFIER_LABEL: Record<string, (v: number) => string> = {
  tauntDurationBonus: turns('tauntDurationBonus'),
  lifestealBonus: pct('lifestealBonus'),
  thornsMultiplier: pct('thornsMultiplier'),
  skillRangeBonus: whole('skillRangeBonus'),
  aoeRadiusBonus: whole('aoeRadiusBonus'),
  burnMagnitudeBonus: pct('burnMagnitudeBonus'),
  shieldPowerBonus: pct('shieldPowerBonus'),
  aoeDamageBonus: pct('aoeDamageBonus'),
  singleTargetDamageBonus: pct('singleTargetDamageBonus'),
  incomingSupportBonus: pct('incomingSupportBonus'),
  maxHpPercentBonus: pct('maxHpPercentBonus'),
  magicPercentBonus: pct('magicPercentBonus'),
  lowHpDamageBonus: pct('lowHpDamageBonus'),
  highHpDamageBonus: pct('highHpDamageBonus'),
  markedDamageBonus: pct('markedDamageBonus'),
  regenMagnitudeBonus: pct('regenMagnitudeBonus'),
  healRestoresMana: whole('healRestoresMana'),
  healGrantsDefense: whole('healGrantsDefense'),
  poisonBurstBonus: pct('poisonBurstBonus'),
  bleedMagnitudeBonus: pct('bleedMagnitudeBonus'),
  bleedDurationBonus: turns('bleedDurationBonus'),
  bleedingDamageBonus: pct('bleedingDamageBonus'),
  // Advanced (level 21–25): Arcanist
  burnCapBonus: pct('burnCapBonus'),
  detonationBonus: pct('detonationBonus'),
  freezeDurationBonus: turns('freezeDurationBonus'),
  chilledDamageBonus: pct('chilledDamageBonus'),
  shockedDamageBonus: pct('shockedDamageBonus'),
  shockChainBonus: pct('shockChainBonus'),
  // Level 26: Arcanist
  burnOverflowShare: (v) => t(modifierKey('burnOverflowShare'), {
    percent: formatPercent(v), reach: formatNumber(arcanistRowTwo().BURN_OVERFLOW_REACH),
  }),
  shockSecondHop: pct('shockSecondHop'),
  // Advanced (level 21–25): Druid
  overhealBarrier: pct('overhealBarrier'),
  rootDurationBonus: turns('rootDurationBonus'),
  pinnedDamageBonus: pct('pinnedDamageBonus'),
  formVigorBonus: pct('formVigorBonus'),
  formSkillDamageBonus: pct('formSkillDamageBonus'),
  // Advanced (level 26): Champion
  tauntedExposure: pct('tauntedExposure'),
  allyHealSpill: pct('allyHealSpill'),
  thirstMissingBonus: pct('thirstMissingBonus'),
  // Advanced (level 26): Druid
  hotBloomShare: pct('hotBloomShare'),
  shapeSettledBonus: (v) => t(modifierKey('shapeSettledBonus'), {
    percent: formatPercent(v), steps: formatNumber(secondNatureMaxSteps()),
  }),
  // Advanced (level 26): Hunter
  bladesCapBonus: (v) => t(modifierKey('bladesCapBonus'), { cap: formatNumber(bladesCap() + v), base: formatNumber(bladesCap()) }),
};

/** The stats a shape's body multiplies, labelled as the node's stat lines are. */
const FORM_STATS: ReadonlySet<string> = new Set(['attack', 'defense', 'magicDefense', 'magic', 'speed', 'moveRange']);

/** A multiplier to two decimals, trailing zeros dropped. */
const timesText = (m: number) => `×${formatDecimal(m, 2)}`;

/**
 * What a shape's body is worth at a rung of its node — one string per number.
 *
 * A shift skill deals and heals nothing, so the skill preview on a shape node
 * only ever repeated mana and cooldown while the rank was changing the form's
 * whole stat line. These come from `wornFormAt`, the arithmetic the fight runs,
 * so the tree cannot advertise a body the Druid would not wear. The multipliers
 * a shape leaves alone (×1) are left out, and the Druid's own magic — converted
 * into health or attack on top — is not known here and is not included.
 */
export function formFigures(form: WildFormId, level: number): string[] {
  const worn = wornFormAt(form, formScale(level), { magic: 0, maxHp: 0 });
  const lines: string[] = [];
  for (const [key, mult] of Object.entries(worn.stats) as [string, number][]) {
    if (Number(mult.toFixed(2)) === 1) continue;
    lines.push(`${FORM_STATS.has(key) ? masteryStatLabel(key) : key} ${timesText(mult)}`);
  }
  if (Number(worn.vigor.toFixed(2)) !== 1) lines.push(`${masteryStatLabel('maxHp')} ${timesText(worn.vigor)}`);
  return lines;
}

/**
 * A shape's numbers as "now → next", one entry per stat — "ATK ×1.19 → ATK ×1.25".
 * Either rung may be absent (an unowned node has no "now", a maxed one no "next").
 */
export function formRankLines(form: WildFormId, shown: number | null, next: number | null): string[] {
  const now = shown ? formFigures(form, shown) : null;
  const then = next ? formFigures(form, next) : null;
  return (now ?? then ?? []).map((_, i) => grantPair(now?.[i] ?? null, then?.[i] ?? null)).filter(Boolean);
}

/** `+30 HP`, `-2 SPD`. */
export const signedStat = (v: number, label: string) => `${v > 0 ? '+' : ''}${formatDecimal(v, 2)} ${label}`;

/**
 * "now → next", or whichever half exists.
 *
 * The arrow is the point: a rank costs a point and nothing anywhere told the
 * player what the point bought. An integer modifier is identical at every rank,
 * so the two halves collapse rather than rendering "+1 range → +1 range", which
 * reads as a bug.
 */
export const grantPair = (now: string | null, then: string | null): string =>
  now && then ? (now === then ? now : `${now} → ${then}`) : (now ?? then ?? '');
