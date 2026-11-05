import type { HexCoord, VfxSpec } from '@/models/types';

/**
 * The pictures of a Freeze ending: broken by a blow, or simply running out.
 *
 * Handed back as data, never played from here — `combatEvents` sends the shatter
 * down `impactVfx` beside its `SHATTER` text, so the player's and the AI's
 * resolvers draw it alike, and `tickEffectsOnUnit` hands the thaw back on its
 * `TickEvent`. Both are drawn on the frozen unit's own hex.
 */

/** Glacial Tomb's ice: the colour the shatter bursts in. */
export const SHATTER_COLOR = '#7fe8ff';

/**
 * A thaw's colour: pale and grey enough that `spellElement` does not read it as
 * frost, so the ice melting away grows no new crystals and leaves a crack at the
 * centre rather than a frost patch.
 */
export const THAW_COLOR = '#c8dce6';

/**
 * The ice breaking (`effects/Shatter.tsx`): chunks of ice and frost flung off the
 * body with a cold flash, and — being a frost colour with the rime aftermath —
 * crystals cracking up out of the tile, a cold light and a frost patch left
 * behind. No unit is "struck" by it: the blow that broke the ice already plays
 * the recoil.
 */
export function shatterVfx(unitId: string, at: HexCoord): VfxSpec {
  return {
    kind: 'shatter', delivery: 'spell', casterId: unitId, casterPos: at, targetCoord: at,
    hitUnitIds: [], hitCoords: [at], color: SHATTER_COLOR, aftermath: 'rime',
  };
}

/** The ice running out on its own: the same picture smaller and gentler, sliding off, and a crack where it stood. */
export function thawVfx(unitId: string, at: HexCoord): VfxSpec {
  return {
    kind: 'shatter', delivery: 'spell', casterId: unitId, casterPos: at, targetCoord: at,
    hitUnitIds: [], hitCoords: [at], color: THAW_COLOR, durationScale: 0.55,
  };
}
