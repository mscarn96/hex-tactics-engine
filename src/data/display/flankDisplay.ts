import { BOARD_HIGHLIGHTS } from '@/data/display/voxelTheme';
import type { HexCoord, VfxSpec } from '@/models/types';
import { Flank, flankMultiplier } from '@/systems/combat/facing';
import { formatDecimal, t } from '@/i18n';

/**
 * How facing and flanks are drawn (`systems/combat/facing` is the rule).
 *
 * - every unit with a front wears a chevron at its feet, on the rim of its hex in
 *   the direction it faces (`FacingChevron` in `UnitMesh`);
 * - a selected or targeted unit's two side hexes are tinted lightly and its back
 *   hex strongly (`FlankHexes`);
 * - a blow from the side or the back floats SIDE or BACK with its multiplier,
 *   draws the `flank` effect and is heard with the `hit.flank` layer.
 */

/** The rear's colour: the board's flank highlight, used by the tint, the word and the effect alike. */
export const FLANK_COLOR = BOARD_HIGHLIGHTS.flank;

/** The tint over a selected or targeted unit's rear hexes: a side lightly, the back strongly. */
export const FLANK_TINT = {
  side: { line: 0.4, fill: 0.07 },
  back: { line: 1, fill: 0.5 },
} as const;

/**
 * The facing chevron, in hex sizes: how far out from the hex centre its tip sits,
 * how wide it spreads and how thick its arms are. On the rim, not under the body —
 * a chevron under a giant's feet is a chevron nobody sees.
 */
export const CHEVRON = {
  tip: 0.9,
  depth: 0.34,
  halfWidth: 0.44,
  thickness: 0.13,
  opacity: 0.9,
} as const;

/** The multiplier as the float writes it: `×1.5`. */
export const multiplierText = (m: number): string => `×${formatDecimal(m, 2)}`;

/** The word a blow from the side or the back floats with; nothing for the front. */
export function flankFloat(flank: Flank): string | undefined {
  if (flank === 'front') return undefined;
  return t(flank === 'back' ? 'combatLog.float.back' : 'combatLog.float.side', { mult: multiplierText(flankMultiplier(flank)) });
}


/**
 * The `flank` effect (`vfx/effects/Flank.tsx`), drawn on the struck unit as the blow
 * lands: a flat flank-coloured arc on the struck side of its hex, opening outward and
 * fading, a contact star at the chest, sparks and a short light in the flank colour. The back's
 * is wider, brighter and shakes the camera a little; a side's is a smaller arc.
 */
export const FLANK_FX = {
  ms: 520,
  /** The arc's half-span, radians: a third of the hex for a side, half for the back. */
  halfSpan: { side: Math.PI / 3, back: Math.PI / 2 },
  /** The arc's band, in hex sizes, before it opens out by `grow`. */
  inner: 0.62,
  outer: 0.98,
  grow: 0.22,
  opacity: { side: 0.75, back: 0.95 },
  star: { side: 0.6, back: 0.9 },
  sparks: { side: 10, back: 18 },
  backShake: 0.08,
} as const;

/**
 * The effect for a blow from the side or the back, drawn by the rules on the
 * struck unit's hex. No unit is "struck" by it: the blow already plays the recoil.
 */
export function flankVfx(attacker: { position: HexCoord }, target: { position: HexCoord }, flank: Flank): VfxSpec | undefined {
  if (flank === 'front') return undefined;
  return {
    // No caster id: the scene swings whoever casts a spec, and the attacker has already swung.
    // Its hex is still the `casterPos` the arc turns toward.
    kind: 'flank', delivery: 'blade', casterId: '', casterPos: attacker.position,
    targetCoord: target.position, hitUnitIds: [], hitCoords: [target.position], color: FLANK_COLOR,
    durationScale: flank === 'back' ? 1 : FLANK_SIDE_SCALE,
  };
}

/** A side blow's effect is the back's played a little smaller; the component reads the kind of flank off it. */
export const FLANK_SIDE_SCALE = 0.8;
