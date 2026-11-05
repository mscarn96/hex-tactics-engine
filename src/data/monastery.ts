import { formatNumber, formatPercent, t } from '@/i18n';
import { entryText } from '@/i18n/dataText';

/**
 * The monastery's four rings of blessings, as data (`systems/world/monastery.ts`
 * is the rule). Each ring offers two small, party-wide alternatives that act
 * only while the party is in Jadeveil. The first ring opens on arrival; the
 * others open as wrath ratchets past its permanent floors.
 *
 * Modest on purpose: the whole set must stay well under what five hero levels
 * add (`monastery.test.ts`), so a blessing is a lean, not a level. First pass;
 * verify in playtest.
 */
export type BlessingId =
  | 'stone_bell' | 'mountain_stride'
  | 'rain_walker' | 'cedar_heart'
  | 'wind_step' | 'lantern_vigil'
  | 'crane_poise' | 'storm_eye';

/** What a blessing does. Every field is optional; percentages are of the hero's own value. */
export interface BlessingEffect {
  /** Physical and Magic Defense, percent. */
  defensePct?: number;
  maxHpPct?: number;
  speedPct?: number;
  /** Hexes of movement, flat. */
  moveRange?: number;
  /** Percentage points of Critical Chance and Dodge, flat. */
  critChance?: number;
  dodgeChance?: number;
  /** The share of wrath's extra enemy strength that reaches the party. */
  wrathShare?: number;
  /** Extra share of each hero's HP the dawn mends in Jadeveil. */
  dawnHeal?: number;
}

/**
 * A blessing. Its words live in the `world` namespace, `blessing.<id>.name`
 * and `blessing.<id>.line`, read when shown through `blessingName` and
 * `blessingLine`; the line's figures come from `effect`.
 */
export interface Blessing {
  id: BlessingId;
  /** Which way it leans, for the panel's tag. */
  kind: 'defence' | 'mobility' | 'storm' | 'offence';
  effect: BlessingEffect;
}

export type VowId = 'gate' | 'rain' | 'wind' | 'crown';

/** A ring of the monastery. Its name is `world.vow.<id>.name`, read through `vowName`. */
export interface MonasteryRing {
  id: VowId;
  /** The wrath floor that opens it; 0 is the arrival vow. */
  opensAt: number;
  choices: readonly [BlessingId, BlessingId];
}

export const BLESSINGS: Record<BlessingId, Blessing> = {
  stone_bell: { id: 'stone_bell', kind: 'defence', effect: { defensePct: 10 } },
  mountain_stride: { id: 'mountain_stride', kind: 'mobility', effect: { moveRange: 1 } },
  rain_walker: { id: 'rain_walker', kind: 'storm', effect: { wrathShare: 0.5 } },
  cedar_heart: { id: 'cedar_heart', kind: 'defence', effect: { maxHpPct: 10 } },
  wind_step: { id: 'wind_step', kind: 'mobility', effect: { speedPct: 10 } },
  lantern_vigil: { id: 'lantern_vigil', kind: 'storm', effect: { dawnHeal: 0.15 } },
  crane_poise: { id: 'crane_poise', kind: 'mobility', effect: { dodgeChance: 6 } },
  storm_eye: { id: 'storm_eye', kind: 'offence', effect: { critChance: 6 } },
};

export const MONASTERY_RINGS: readonly MonasteryRing[] = [
  { id: 'gate', opensAt: 0, choices: ['stone_bell', 'mountain_stride'] },
  { id: 'rain', opensAt: 25, choices: ['rain_walker', 'cedar_heart'] },
  { id: 'wind', opensAt: 50, choices: ['wind_step', 'lantern_vigil'] },
  { id: 'crown', opensAt: 75, choices: ['crane_poise', 'storm_eye'] },
];

/** A blessing's name ("Stone Bell" / "Kamienny dzwon"). */
export const blessingName = (id: BlessingId): string => entryText('world', `blessing.${id}`, 'name');

/** What a blessing does, in one line, as the panels show it — its figures read from its effect. */
export function blessingLine(id: BlessingId): string {
  const e = BLESSINGS[id].effect;
  const pct = e.defensePct ?? e.maxHpPct ?? e.speedPct ?? e.critChance ?? e.dodgeChance;
  return entryText('world', `blessing.${id}`, 'line', {
    percent: pct !== undefined ? formatPercent(pct / 100) : formatPercent(e.dawnHeal ?? 0),
    amount: formatNumber(e.moveRange ?? 0),
  });
}

/** A ring's name ("Vow of the Gate" / "Ślub Bramy"). */
export const vowName = (ring: MonasteryRing): string => entryText('world', `vow.${ring.id}`, 'name');

/** A ring's two blessings on one line, each with what it does — as the Handbook lists them. */
export function vowChoicesText(ring: MonasteryRing): string {
  const [first, second] = ring.choices;
  return t('world.vow.choices.text', {
    first: blessingName(first), firstLine: blessingLine(first),
    second: blessingName(second), secondLine: blessingLine(second),
  });
}

export function isBlessingId(value: unknown): value is BlessingId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BLESSINGS, value);
}
