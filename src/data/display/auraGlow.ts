import { AuraType, StatusEffectType } from '@/models/types';

/**
 * Auras that light the unit up, and in what colour.
 *
 * Deliberately a short list rather than "every aura". A status pip already says
 * *that* a buff exists; a body glow says **this unit is dangerous right now**,
 * across the board, without reading anything. Spending that signal on every
 * heal-over-time would leave it saying nothing at all — so this table is only
 * for the windows a player is supposed to see coming and answer.
 *
 * Keyed by the aura that is *unique to* the window rather than the most
 * obvious one. Follow-Through glows off `CritDamageBuff`, not `CritBuff`,
 * because `CritBuff` also arrives from a passive proc — and a glow that fired
 * on someone else's passive would be the same signal meaning two things.
 *
 * Pure data with no React or Three import, so the table is checkable in the
 * node test environment.
 */
export const AURA_GLOW: Partial<Record<StatusEffectType, string>> = {
  // Carnage is deliberately absent since the Berserker remaster (2026-10): it
  // draws red flames rising round the body and turns both weapons red
  // (`CARNAGE_FLAME`), which says more than the bubble did.
  /** Marksman's Follow-Through: crits are coming, and they buy turns. */
  [AuraType.CritDamageBuff]: '#ff4a2a',
  /** The Troll Chieftain's Fury: half his health gone, and every turn carries a second sweep. */
  [AuraType.Fury]: '#ff2a2a',
  /** Skirmisher's Flurry: every strike lands four times. */
  [AuraType.Flurry]: '#ff4a4a',
  /**
   * Under the Brigand Captain's word: half again on every stat while he stands.
   * Gold, his link's colour, so the glow and the line to him read as one thing —
   * and the answer to a warband that glows is the man the lines run to.
   */
  [AuraType.Authority]: '#e8b84a',
  // Bladestorm is deliberately absent: it draws its own orbiting blades, which
  // say considerably more than a glow would, and stacking both would only make
  // the blades harder to see.
};

/**
 * Carnage's colours: the rising flames' hot core and outer red, the ground ring,
 * and the emissive both weapons take while it lasts. Red rather than the
 * Pyromancer's orange (Flame Guard), so the two fires are not one signal.
 */
export const CARNAGE_FLAME = {
  core: '#ff5a4a',
  outer: '#e0102a',
  ring: '#ff2a3c',
  weapon: '#ff1a2a',
} as const;
/** The gold of the Martyr's bubble, the Templar's holy light. */
export const MARTYR_BUBBLE_COLOR = '#ffd84a';

/**
 * Whether a unit wears the Martyr's bubble: held by its Invulnerability while the
 * seal that pays for it is on. Keyed on both, so the bubble is the Martyr's
 * protection and nothing else's (an Invulnerability from another source draws no
 * bubble), and it goes the moment the protection does — the tick that expires the
 * pair is the one that detonates the seal.
 */
export function wearsMartyrBubble(effects: readonly { type: StatusEffectType }[]): boolean {
  return effects.some((e) => e.type === AuraType.MartyrSeal)
    && effects.some((e) => e.type === AuraType.Invulnerability);
}

/** The glow colour for a unit's current effects, or null if it has none. */
export function auraGlowColor(
  effects: readonly { type: StatusEffectType }[],
): string | null {
  for (const effect of effects) {
    const color = AURA_GLOW[effect.type];
    if (color) return color;
  }
  return null;
}
