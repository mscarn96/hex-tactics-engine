import { CombatUnit, HexCoord, VfxSpec } from '@/models/types';
import { inArena } from '@/systems/combat/arenaGeometry';
import { hexDistance } from '@/utils/hexUtils';
import {
  CORAL_LOOK, HOOK_LOOK, LURE_LOOK, POWDER_LOOK, REDSAIL_FIRE, STORM_LOOK, TIDE_LOOK, VARR_FIRE, WAVE_LOOK,
} from '@/data/display/archipelagoEffects';

/**
 * **The archipelago's effects as specs** — Varr's cannon, the Reef Titan's coral, the Sirens' song,
 * the boarding hook, black powder, the tide and the storm deck — built ahead of the abilities that
 * fire them (`data/display/archipelagoEffects.ts`, the private project notes). The rules hand
 * these to `sink.vfx` (or a skill names the shape) once those abilities exist; the effects lab plays
 * them now, so what the lab shows is what a fight will.
 *
 * Each says what its shape reads: where its picture starts (`casterPos`), what it is aimed at
 * (`targetCoord`) and what it covers (`hitCoords`). Positions are snapshotted here, as every
 * spec's are. A spec with no caster (`casterId: ''`) swings nobody and moves no camera: the sea, the
 * sky and the reef have no body to animate.
 */

/** A straight run of arena hexes from the hex after `from` along the step `dir`, to the board's edge. */
export function laneHexes(from: HexCoord, dir: HexCoord): HexCoord[] {
  const out: HexCoord[] = [];
  if (dir.q === 0 && dir.r === 0) return out;
  for (let at = { q: from.q + dir.q, r: from.r + dir.r }; ; at = { q: at.q + dir.q, r: at.r + dir.r }) {
    if (inArena(at)) out.push(at);
    // Off the board at the far side; a gun offshore starts off the board and comes in over its edge
    else if (out.length > 0 || hexDistance(from, at) > 12) break;
  }
  return out;
}

/**
 * A cannonball down a lane, from the gun (Varr himself, or the Redsail ship's hex offshore) through
 * every hex of `lane` in order. Only Varr's is his yellow (`VARR_FIRE`); every other gun fires in
 * the Redsail red-orange. The numbers wait for the ball to reach the far end: `targetCoord` is it.
 */
export function cannonVfx(opts: {
  casterId: string; gun: HexCoord; lane: HexCoord[]; struckIds: string[]; varr: boolean;
}): VfxSpec {
  const lane = [...opts.lane].sort((a, b) => hexDistance(opts.gun, a) - hexDistance(opts.gun, b));
  return {
    kind: 'cannon', delivery: 'blunt', casterId: opts.casterId, casterPos: opts.gun,
    targetCoord: lane[lane.length - 1] ?? opts.gun, hitCoords: lane, hitUnitIds: opts.struckIds,
    color: opts.varr ? VARR_FIRE : REDSAIL_FIRE,
  };
}

/** The reef pushing up where the Reef Titan's coral walls grow; `caughtIds` for anybody it strikes as they rise. */
export function coralGrowthVfx(casterId: string, from: HexCoord, walls: HexCoord[], caughtIds: string[] = []): VfxSpec {
  return {
    kind: 'coral', delivery: 'natural', casterId, casterPos: from, targetCoord: walls[0] ?? from,
    hitCoords: walls, hitUnitIds: caughtIds, color: CORAL_LOOK.color,
  };
}

/** A coral wall broken apart, on the clock of whatever broke it. */
export function coralBreakVfx(at: HexCoord): VfxSpec {
  return {
    kind: 'coralbreak', delivery: 'blunt', casterId: '', casterPos: at, targetCoord: at,
    hitCoords: [at], hitUnitIds: [], color: CORAL_LOOK.color,
  };
}

/** A Siren's song reaching a hero, opened by her drawing breath (`gather`). The pull after it is a move. */
export function lureVfx(singer: Pick<CombatUnit, 'id' | 'position'>, hero: Pick<CombatUnit, 'id' | 'position'>): VfxSpec {
  return {
    kind: 'lure', delivery: 'spell', prelude: 'gather', casterId: singer.id, casterPos: singer.position,
    targetCoord: hero.position, hitCoords: [hero.position], hitUnitIds: [hero.id], color: LURE_LOOK.color,
  };
}

/**
 * The boarding hook: thrown at `target`, biting `hookedId` when there is one, and reeled. `haul`
 * names who rides the rope and where to: the hooked body to the thrower's side, or the thrower
 * (`unitId` its own) to the hook. The rules move them as a dash held until the reel (`hookReelMs`).
 */
export function hookVfx(opts: {
  casterId: string; from: HexCoord; target: HexCoord; hookedId?: string;
  haul?: { unitId: string; from: HexCoord; to: HexCoord };
}): VfxSpec {
  return {
    kind: 'hook', delivery: 'thrown', casterId: opts.casterId, casterPos: opts.from, targetCoord: opts.target,
    hitCoords: [opts.target], hitUnitIds: opts.hookedId ? [opts.hookedId] : [], color: HOOK_LOOK.color,
    ...(opts.haul && { haul: opts.haul }),
  };
}

/** Black powder going off over `hexes` round `at`: a cask, or the Corsair's Powder Magazine erupting. */
export function powderBlastVfx(at: HexCoord, hexes: HexCoord[], caughtIds: string[] = []): VfxSpec {
  return {
    kind: 'explosion', delivery: 'thrown', casterId: '', casterPos: at, targetCoord: at,
    hitCoords: hexes, hitUnitIds: caughtIds, color: POWDER_LOOK.color, aftermath: 'smoke',
  };
}

/** The Powder Magazine's horn, hurled to where it will go off. */
export function powderHornVfx(casterId: string, from: HexCoord, at: HexCoord): VfxSpec {
  return {
    kind: 'throw', delivery: 'thrown', projectile: 'powder_horn', casterId, casterPos: from, targetCoord: at,
    hitCoords: [at], hitUnitIds: [], color: POWDER_LOOK.color,
  };
}

/** Water bursting up where the tide floods in, or where a body is thrown into it. */
export function splashVfx(hexes: HexCoord[]): VfxSpec {
  const at = hexes[0] ?? { q: 0, r: 0 };
  return {
    kind: 'splash', delivery: 'natural', casterId: '', casterPos: at, targetCoord: at,
    hitCoords: hexes, hitUnitIds: [], color: TIDE_LOOK.color,
  };
}

/**
 * The storm deck's lightning on its marked hexes: one strike from the sky per hex, each
 * `STORM_LOOK.strikeGapMs` after the last — three a second at most, the flash-peak limit — with
 * whoever stands there struck by it, scorching the planks where it lands.
 */
export function stormStrikeVfx(hexes: HexCoord[], units: Pick<CombatUnit, 'id' | 'position' | 'currentHp'>[]): VfxSpec[] {
  return hexes.map((hex, i) => ({
    kind: 'lightning', delivery: 'spell', casterId: '', casterPos: hex, targetCoord: hex, hitCoords: [hex],
    hitUnitIds: units.filter((u) => u.currentHp > 0 && u.position.q === hex.q && u.position.r === hex.r).map((u) => u.id),
    color: STORM_LOOK.color, aftermath: 'static',
    ...(i > 0 && { delayMs: i * STORM_LOOK.strikeGapMs }),
  }));
}

/**
 * A wave rolling over `footprint` from `from` toward `to`, pushing `pushedIds`. Each is thrown as
 * the crest reaches it: the rules hold its shove `waveCrestMs` (`movement.shoveDelayMs`).
 */
export function waveVfx(from: HexCoord, to: HexCoord, footprint: HexCoord[], pushedIds: string[]): VfxSpec {
  return {
    kind: 'wave', delivery: 'natural', casterId: '', casterPos: from, targetCoord: to,
    hitCoords: footprint, hitUnitIds: pushedIds, color: WAVE_LOOK.water[1],
  };
}
