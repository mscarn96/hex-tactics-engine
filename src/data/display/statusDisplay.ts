import { bloodHowlCrit, bloodHowlTurnCap, beetle, mantis, maxPoisonStacks, meditate, painFeastThreshold, rapidFireStrikes, rapidFireTotal, winterSleepDamageReduction } from '@/systems/combat/displayNumbers';
import { ActiveEffect, AfflictionType, AuraType, StatusEffectType } from '@/models/types';
import { poisonStacks } from '@/systems/combat/statusEffects';
import { BALANCE } from '@/data/balanceConstants';
import { formatNumber, formatPercent, hasMessage, t, type MessageKey, type MessageParams } from '@/i18n';
import { STATE_ON_IRON } from '@/data/display/voxelTheme';
import { MARKSMAN_YELLOW } from '@/data/display/marksmanColors';
import { MANTIS_GREEN } from '@/data/skills/mastery/mantis';

/**
 * How each status presents itself.
 *
 * One table, read by the badge list, the arena pips, the turn bar and the unit
 * dialog. Before this existed the only thing on screen was the raw enum name of
 * whatever happened to be first in the array — `heal over time`, `debuff
 * immunity` — with no magnitude, on the active unit only.
 *
 * `format` is what makes a status legible rather than merely present. A Barrier
 * is worth nothing to a player who cannot see how much of it is left, and a
 * stack of Burn that cannot be read is a stack that cannot be planned around.
 *
 * The words are not here: a status's name is `statusName(type)`
 * (`data/gameText.ts`) and its explanation `statusDescription(type)`, both read
 * from the `statuses` catalog when shown. `format` writes through the catalog too.
 */
export interface StatusDisplay {
  color: string;
  kind: 'aura' | 'affliction';
  /**
   * Renders `magnitude` for this status, or undefined when the number is
   * meaningless.
   *
   * The second argument is the effect itself, for the one status whose badge is
   * not fully described by its magnitude: poison is a pile of *doses*, and how
   * many are in it is what decides whether the next one stacks or detonates.
   * Optional so the three call sites that have only a number keep working.
   */
  format?: (magnitude: number, effect?: ActiveEffect) => string;
  /** Internal bookkeeping the player should never be shown. */
  hidden?: boolean;
  /**
   * The duration is an internal clock, not a count the player plans by: the
   * Vanish wind-up's Ambush lasts `VANISH_WINDUP + 1` only so it outlives the
   * wait, and "3 turns" beside "2 actions" read as a third number (PT-03).
   */
  hideDuration?: boolean;
  /**
   * The world whose fights lay it, where that is not every world's. The
   * archipelago's statuses are drawn ahead of the world itself, as its gear is
   * (`Item.world`): the arena and the HUD draw them like any other, and the
   * Handbook lists one only once the campaign has its world (`isWorldId`).
   */
  world?: 'archipelago';
}

/**
 * The one colour a shield is, everywhere it is drawn.
 *
 * Three places show a Barrier and all three used to name their own colour: the
 * badge and the arena pip at `#66ccff`, the HP bar's shield segment at
 * `#cfd4d8`, and — once the shell became Barrier's rather than Chill's — a
 * third. A player learning "pale steel means shielded" off the bar was then
 * shown cyan in the badge for the same effect.
 *
 * The steel wins over the cyan on purpose. `Chill`, `Freeze` and `Shock` are all
 * saturated ice blues, and Barrier is the one of the four that is *good news*;
 * desaturating it is what stops a shielded unit and a frozen one reading as the
 * same event from across the board.
 */
export const BARRIER_COLOR = '#cfd4d8';
/** Reckoning's red-gold: its badge, its shockwave and the numbers the shockwave floats. */
export const RECKONING_COLOR = '#ff8a3a';

/**
 * What a dodged blow says over the unit that dodged it, and in what colour.
 *
 * Not a status, but here for `BARRIER_COLOR`'s reason exactly: it is a combat
 * display constant that **both execution paths have to agree on**, and this file
 * is already where those live. It was two spellings of one event — the player's
 * resolver floated `MISS` in `#88ccff`, and the AI's had no text channel at all,
 * so it reported the dodge through the *damage* callback as zero and the arena
 * drew **"-0"** over the hero who had just avoided the hit. A number that says a
 * blow landed for nothing is the opposite of what happened.
 *
 * "DODGED" rather than "MISS" because the roll is the *target's*
 * (`dodgeChance`, off the defender's effective stats) — a miss is something the
 * attacker did, and nothing in this game rolls one.
 */
export const dodgeText = (): string => t('combatLog.float.dodged');
export const DODGE_COLOR = '#88ccff';

/**
 * Which side a unit is on, as a colour — here for the same reason as the two
 * above: the arena says it in five places and they all have to agree.
 *
 * Blue for the player and red for the enemy is already the board's vocabulary:
 * the movement overlay is this blue, the skill-range and target overlays this
 * red, the `◧ Sides` glow is both, and the fallback capsule a unit draws before
 * its model is built picks between them. All five carried their own literal.
 *
 * They are also now on the units themselves, permanently, which is what the
 * literal duplication made risky rather than merely untidy — a plate on a body
 * that disagreed with the overlay under it would be worse than no plate at all.
 *
 * **Hue is not the whole answer and is not meant to be.** `UnitMesh` draws a
 * pennant beside the plate that points *up* for the player and *down* for the
 * enemy, so the two are told apart in silhouette as well; the same argument
 * `statusDisplay` makes about Barrier against the ice statuses, one axis over.
 */
export const SIDE_COLOR = { player: '#4a90d9', enemy: '#d94a4a' } as const;

/** The colour of whichever side `isPlayer` says. */
export const sideColor = (isPlayer: boolean): string =>
  (isPlayer ? SIDE_COLOR.player : SIDE_COLOR.enemy);

/**
 * The plate a unit's health bar is framed in: its side's colour, taken down.
 *
 * **Not the side colour itself, and the enemy is why.** `SIDE_COLOR.enemy` and
 * the fill a bar shows below a quarter health (`#f44336`) are 15 apart in Lab
 * — the same red — so a bright plate swallowed its own bar at exactly the moment
 * the bar matters most. Taken down it is a frame rather than a patch, which is
 * also what a frame should look like: the loud statement of the side is the
 * pennant beside it, standing on bare ground where it has nothing to compete
 * with.
 *
 * Derived from the one colour rather than authored beside it, so a retune of a
 * side moves its plate with it.
 */
const PLATE_SHADE = 0.55;

export function sidePlateColor(isPlayer: boolean): string {
  const n = parseInt(sideColor(isPlayer).slice(1), 16);
  const channel = (shift: number) =>
    Math.round(((n >> shift) & 0xff) * PLATE_SHADE).toString(16).padStart(2, '0');
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/**
 * Which way the pennant beside a unit's bar points, in radians about the
 * billboard's own z.
 *
 * **A quarter turn, and opposite signs.** `circleGeometry` at three segments is
 * the flat triangle the pennant is drawn from, and it puts its first vertex at
 * angle 0 — so a triangle left alone points along +X and a half turn points it
 * along −X. The first pass used 0 and π and drew two arrowheads aimed left and
 * right, which is a difference nobody can read as a side. Here rather than
 * inline in the mesh so the rule is arithmetic a test can check, which is how
 * that mistake gets caught the next time.
 */
export const sidePennantRotation = (isPlayer: boolean): number =>
  (isPlayer ? Math.PI / 2 : -Math.PI / 2);

/**
 * Mana, wherever it is shown: the bar under a hero's health, the card in the
 * combat HUD, a skill button's cost corner and the `+N MP` that floats when some
 * is restored.
 *
 * The interface's own mana blue, so the pool over a unit and the pool on the
 * card beside the skills are one colour. It used to be `SIDE_COLOR.player`'s hex
 * under another name, which kept "this is yours" and "this is mana" apart only
 * by the constant they were spelled with; the kit's bars had meanwhile taken a
 * second blue of their own, so the same pool drew in two.
 */
export const MANA_COLOR = STATE_ON_IRON.mana;

/** Chi, wherever a Monk's pool shows: the same places as mana, in its own yellow. */
export const CHI_COLOR = STATE_ON_IRON.chi;

/**
 * The colour of a unit's pool: chi yellow for a Monk, mana blue for everyone
 * else. Takes the unit's or the class's `resource` (`data/classResource`).
 */
export function resourceColor(resource: 'mana' | 'chi' | undefined): string {
  return resource === 'chi' ? CHI_COLOR : MANA_COLOR;
}

/** The Beetle's carapace olive, for its charges, its soak and the Barriers it lays. */
export const CARAPACE_COLOR = '#b8c860';

/**
 * A unit's health bar, by side: green for yours, red for theirs — over its head
 * and on the combat card alike.
 *
 * By side rather than by how hurt it is. The bars used to run green, amber and
 * red down a unit's health, which said how much was left twice (the fill's
 * length already says it) and said nothing about whose it was. Now that every
 * bar has a track, what is missing is visible without a colour change, and the
 * colour is free to answer the question the board keeps asking.
 */
export const hpBarColor = (isPlayer: boolean): string =>
  (isPlayer ? STATE_ON_IRON.hp : STATE_ON_IRON.danger);

const num = (m: number) => formatNumber(m);
const pct = (fraction: number) => formatPercent(fraction);
const perTurn = (m: number) => t('statuses.format.perTurn', { n: num(m) });
const flat = (m: number) => `+${num(m)}`;
const shred = (m: number) => `−${num(m)}`;
const percent = (m: number) => pct(m);
const points = (m: number) => num(m);

export const STATUS_DISPLAY: Record<StatusEffectType, StatusDisplay> = {
  [AuraType.HealOverTime]: { color: '#44dd88', kind: 'aura', format: perTurn },
  [AuraType.ManaRegenOverTime]: { color: '#4a90d9', kind: 'aura', format: perTurn },
  [AuraType.AttackBuff]: { color: '#ff8844', kind: 'aura', format: flat },
  [AuraType.DefenseBuff]: { color: '#88aaff', kind: 'aura', format: flat },
  [AuraType.MagicBuff]: { color: '#cc88ff', kind: 'aura', format: flat },
  [AuraType.SpeedBuff]: { color: '#ffdd66', kind: 'aura', format: flat },
  [AuraType.Invulnerability]: { color: '#ffffff', kind: 'aura' },
  [AuraType.DebuffImmunity]: { color: '#ffe9a8', kind: 'aura' },
  [AuraType.Barrier]: { color: BARRIER_COLOR, kind: 'aura', format: points },
  [AuraType.Thorns]: { color: '#88cc44', kind: 'aura', format: percent },
  [AuraType.FlameGuard]: { color: '#ff7a2e', kind: 'aura', format: percent },
  [AuraType.Stealth]: { color: '#aa88ff', kind: 'aura' },
  [AuraType.CritBuff]: { color: '#ffcc44', kind: 'aura', format: (m) => `+${pct(m / 100)}` },
  [AuraType.CritDamageBuff]: { color: '#ffaa44', kind: 'aura', format: (m) => `+${pct(m / 100)}` },
  [AuraType.RapidFire]: { color: '#ffcc44', kind: 'aura' },
  [AuraType.BladeStorm]: { color: '#ff4a4a', kind: 'aura', format: points },
  [AuraType.Flurry]: { color: '#ff4a4a', kind: 'aura' },
  [AuraType.ShadowEcho]: { color: '#9b6bff', kind: 'aura' },
  [AuraType.SmokeCover]: { color: '#9aa4b0', kind: 'aura' },
  [AuraType.Ambush]: { color: '#8844cc', kind: 'aura', hideDuration: true, format: (m) => t('statuses.ambush.format', { count: Math.round(m) }) },
  [AuraType.SacredRhythm]: { color: '#ffe9a8', kind: 'aura', format: (m) => t('statuses.sacred_rhythm.format', { n: num(m) }) },
  [AuraType.Growth]: { color: '#9be86a', kind: 'aura', format: (m) => t('statuses.format.charges', { n: num(m), max: 3 }) },
  [AuraType.BloodHowl]: { color: '#ff6a72', kind: 'aura', format: (m) => t('statuses.blood_howl.format', { n: num(m) }) },
  [AuraType.Evasive]: { color: '#9ab8d0', kind: 'aura', format: (m) => t('statuses.evasive.format', { n: pct(m / 100) }) },
  [AuraType.Apex]: { color: '#9dff6a', kind: 'aura', format: () => t('statuses.apex.format') },
  [AuraType.SecondSpring]: { color: '#7fe0a0', kind: 'aura', format: (m) => t('statuses.format.damageTakenLess', { n: pct(m / 100) }) },
  [AuraType.GroundedFocus]: { color: '#c8a878', kind: 'aura', format: (m) => t('statuses.grounded_focus.format', { n: pct(m) }) },
  [AfflictionType.SacredSeal]: { color: '#ffe9a8', kind: 'affliction', format: (m, e) => (e?.healMagnitude !== undefined
      ? t('statuses.sacred_seal.formatHeal', { n: num(m), heal: num(e.healMagnitude) })
      : t('statuses.sacred_seal.format', { n: num(m) })) },
  [AuraType.BlessedWeapon]: { color: '#ffe9a8', kind: 'aura', format: (m, e) => t('statuses.blessed_weapon.format', { n: num(m), stacks: e?.stacks ?? 1 }) },
  [AuraType.Meditation]: { color: '#e8d8a8', kind: 'aura' },
  [AuraType.BeaconLight]: { color: '#ff9e00', kind: 'aura', format: (m) => `+${pct(m / 100)}` },
  [AuraType.BeaconLit]: { color: '#ffb640', kind: 'aura', format: (m) => t('statuses.format.damageTaken', { n: pct(m) }) },
  [AuraType.Lightbond]: { color: '#ff9e00', kind: 'aura', format: (m) => t('statuses.lightbond.format', { n: pct(m / 100) }) },
  [AuraType.Carapace]: { color: CARAPACE_COLOR, kind: 'aura', format: (m) => t('statuses.format.charges', { n: num(m), max: beetle().CARAPACE_MAX }) },
  [AuraType.MarkedPrey]: { color: MANTIS_GREEN, kind: 'aura' },
  [AuraType.ShoulderGuard]: { color: '#e0a83c', kind: 'aura', format: (m) => t('statuses.shoulder_guard.format', { n: pct(m / 100) }) },
  [AuraType.MartyrSeal]: { color: '#fff2c8', kind: 'aura', format: points },
  [AuraType.StaticCharge]: { color: '#ffee66', kind: 'aura', format: points },
  [AuraType.Lifesteal]: { color: '#cc44ff', kind: 'aura', format: percent },
  [AuraType.Carnage]: { color: '#cc2244', kind: 'aura' },
  [AuraType.MagicDefenseBuff]: { color: '#c8a8ff', kind: 'aura', format: flat },
  [AuraType.SeismicStep]: { color: '#c8a878', kind: 'aura', format: (m) => t('statuses.seismic_step.format', { n: num(m) }) },
  [AuraType.Overloaded]: { color: '#9ee8ff', kind: 'aura', format: percent },
  [AuraType.OrbCharge]: { color: '#ff2a3a', kind: 'aura', format: points },
  [AuraType.Fury]: { color: '#ff2a2a', kind: 'aura', format: (m) => t('statuses.fury.format', { n: pct(m) }) },
  [AuraType.Exposed]: { color: '#ffdd66', kind: 'aura', format: (m) => t('statuses.format.damageTaken', { n: pct(m) }) },
  [AuraType.Slumber]: { color: '#9ec8ff', kind: 'aura', format: () => t('statuses.format.damageTakenLess', { n: pct(winterSleepDamageReduction()) }) },
  [AuraType.Rage]: { color: '#ff5a3c', kind: 'aura', format: (m) => `${num(m)}/${painFeastThreshold()}` },
  [AuraType.SoulSplit]: { color: '#c8f0ff', kind: 'aura', format: (m, effect) => t('statuses.soul_split.format', { home: num(m), loose: effect?.stacks ?? 0 }) },
  [AuraType.Burrowed]: { color: '#d8b878', kind: 'aura' },
  [AuraType.Encased]: { color: '#7fe8ff', kind: 'aura' },
  [AuraType.Webbed]: { color: '#f0ecd8', kind: 'aura' },
  [AuraType.Suspended]: { color: '#f0ecd8', kind: 'aura' },
  [AuraType.Aloft]: { color: '#bcd8ff', kind: 'aura' },
  [AuraType.Duel]: { color: '#bfe6f5', kind: 'aura', format: (m) => (m > 0 ? t('statuses.duel.format', { n: pct(m) }) : '') },
  [AuraType.Challenged]: { color: '#bfe6f5', kind: 'aura' },
  [AuraType.Kneeling]: { color: '#9fd8ff', kind: 'aura' },
  [AuraType.Authority]: { color: '#e8b84a', kind: 'aura', format: percent },
  [AuraType.Reckoning]: { color: RECKONING_COLOR, kind: 'aura', format: points },
  [AuraType.UndyingWindow]: { color: '#ff3b3b', kind: 'aura', format: (m) => t('statuses.format.turns', { count: Math.round(m) }) },
  [AuraType.UndyingSpent]: { color: '#666666', kind: 'aura', hidden: true },
  [AuraType.Envenomed]: { color: '#88cc44', kind: 'aura' },
  [AfflictionType.Poison]: { color: '#88cc44', kind: 'affliction', format: (m, effect) => `${perTurn(m)} ×${effect ? poisonStacks(effect) : 1}` },
  [AfflictionType.DeathMark]: { color: '#b04dff', kind: 'affliction', format: (m) => `+${pct(m)}` },
  [AfflictionType.JadeTaint]: { color: '#3fe0a0', kind: 'affliction', format: (m) => `${num(m)}/3` },
  [AfflictionType.Blades]: { color: '#c0c8d0', kind: 'affliction', format: points },
  [AfflictionType.Bleed]: { color: '#cc4444', kind: 'affliction', format: perTurn },
  [AfflictionType.Burn]: { color: '#ff8844', kind: 'affliction', format: perTurn },
  [AfflictionType.Stun]: { color: '#ffdd44', kind: 'affliction' },
  [AfflictionType.Freeze]: { color: '#88ddff', kind: 'affliction' },
  [AuraType.Charging]: { color: '#e6f7ff', kind: 'aura' },
  [AuraType.Aiming]: { color: MARKSMAN_YELLOW, kind: 'aura' },
  [AuraType.SettledAim]: { color: MARKSMAN_YELLOW, kind: 'aura', format: (m) => pct(m / 100) },
  [AfflictionType.Brittle]: { color: '#d8f4ff', kind: 'affliction' },
  [AfflictionType.Chill]: { color: '#88ddff', kind: 'affliction', format: shred },
  [AfflictionType.Shock]: { color: '#66ccff', kind: 'affliction' },
  [AfflictionType.Taunt]: { color: '#ff8800', kind: 'affliction' },
  [AfflictionType.Root]: { color: '#aa8844', kind: 'affliction' },
  [AfflictionType.Silence]: { color: '#bb66cc', kind: 'affliction' },
  [AfflictionType.AttackDown]: { color: '#cc7755', kind: 'affliction', format: shred },
  [AfflictionType.MagicDown]: { color: '#9a7acc', kind: 'affliction', format: shred },
  [AfflictionType.DefenseDown]: { color: '#7788cc', kind: 'affliction', format: shred },
  [AfflictionType.PhysicalDefenseDown]: { color: '#a08858', kind: 'affliction', format: shred },
  [AfflictionType.Mark]: { color: MARKSMAN_YELLOW, kind: 'affliction', format: percent },
  [AfflictionType.CutOpen]: { color: MANTIS_GREEN, kind: 'affliction', format: percent },
  [AfflictionType.Writ]: { color: '#c02028', kind: 'affliction', format: percent },
  [AfflictionType.Chained]: { color: '#ff2a3a', kind: 'affliction' },
  [AfflictionType.Branded]: { color: '#ff2a3a', kind: 'affliction' },
  [AfflictionType.Wound]: { color: '#d9a066', kind: 'affliction', format: (m, effect) => `×${effect?.stacks ?? 1} (−${num(m)})` },
  [AfflictionType.MindControl]: { color: '#c24dff', kind: 'affliction' },
  [AfflictionType.Warband]: { color: '#ff7a3c', kind: 'affliction' },
  [AfflictionType.Fracture]: { color: '#d0b890', kind: 'affliction' },
  [AfflictionType.HuntersMark]: { color: '#f2c84a', kind: 'affliction', format: (m, e) => t('statuses.hunters_mark.format', { n: pct(m / 100), left: e?.stacks ?? 1 }) },
  [AfflictionType.CrownedPrey]: { color: '#9dff6a', kind: 'affliction', format: (m, e) => t('statuses.crowned_prey.format', { n: num(m), left: e?.stacks ?? 1 }) },
  [AfflictionType.Geas]: { color: '#9a5ac8', kind: 'affliction' },
  [AfflictionType.Doom]: { color: '#ff2a3a', kind: 'affliction', format: (m) => t('statuses.doom.format', { n: num(m) }) },
  // The archipelago's, ahead of its world. No yellow: that light is Captain Varr's alone.
  // The Duelist's mark in sea turquoise, apart from Taunt's orange, whose job it does without forcing
  [AfflictionType.CalledOut]: { color: '#40e0d0', kind: 'affliction', world: 'archipelago', format: (m) => t('statuses.called_out.format', { n: pct(m) }) },
  // Breaching Shot's hole in gunmetal, apart from Cracked's tan crack
  [AfflictionType.Breached]: { color: '#7f8fa6', kind: 'affliction', world: 'archipelago', format: shred },
  [AfflictionType.Charmed]: { color: '#ff7eb6', kind: 'affliction', world: 'archipelago' },
  // The Furnace Heart's carrier: ember orange, the healing it cuts as a share
  [AfflictionType.Seared]: { color: '#ff7a1e', kind: 'affliction', format: (m) => t('statuses.seared.format', { n: pct(m) }) },
};

/** Duration as a player reads it. Permanent and conditional both show as lasting. */
export function formatDuration(duration: number): string {
  return duration === -1 || duration === 99 ? '∞' : `${duration}`;
}

export function statusDisplay(type: StatusEffectType): StatusDisplay {
  return STATUS_DISPLAY[type] ?? { color: '#888888', kind: 'affliction' };
}

/**
 * The numbers some explanations quote, read from the rules when shown so a
 * retune moves the sentence with it.
 */
const DESCRIPTION_PARAMS: Partial<Record<StatusEffectType, () => MessageParams>> = {
  [AuraType.RapidFire]: () => ({ strikes: rapidFireStrikes(), each: pct(rapidFireTotal() / rapidFireStrikes()) }),
  [AuraType.BloodHowl]: () => ({ crit: pct(bloodHowlCrit() / 100), cap: bloodHowlTurnCap() }),
  [AuraType.Meditation]: () => ({ heal: pct(meditate().HEAL_SHARE), attack: meditate().ATTACK, magic: meditate().MAGIC }),
  [AuraType.Carapace]: () => ({ defense: beetle().CARAPACE_DEFENSE, max: beetle().CARAPACE_MAX }),
  [AuraType.MarkedPrey]: () => ({ share: pct(mantis().MARK_SHARE) }),
  [AuraType.Slumber]: () => ({ reduction: pct(winterSleepDamageReduction()) }),
  [AuraType.Rage]: () => ({ threshold: painFeastThreshold() }),
  [AfflictionType.Poison]: () => ({ max: maxPoisonStacks() }),
};

/**
 * One line explaining what a status does, for the unit dialog, the Bestiary and
 * the Handbook: `statuses.<type>.description`. Empty for a type with no entry.
 */
export function statusDescription(type: StatusEffectType): string {
  const key = `statuses.${type}.description`;
  return hasMessage(key) ? t(key as MessageKey, DESCRIPTION_PARAMS[type]?.()) : '';
}

/** Effects worth showing, in a stable order — afflictions first, since they are the threat. */
export function visibleEffects<T extends { type: StatusEffectType }>(effects: T[]): T[] {
  return effects
    .filter((e) => !statusDisplay(e.type).hidden)
    .slice()
    .sort((a, b) => {
      const ka = statusDisplay(a.type).kind === 'affliction' ? 0 : 1;
      const kb = statusDisplay(b.type).kind === 'affliction' ? 0 : 1;
      return ka - kb;
    });
}
