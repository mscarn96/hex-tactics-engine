import type { HexCoord } from '@/models/hex';
import { hexToPixel } from '@/utils/hexUtils';
import { VARR_ORB } from './varrColors';

/**
 * **The archipelago's combat effects: their colours, sizes and clocks** — Varr's cannon and the
 * lanes it is warned down, the Reef Titan's coral walls, the Sirens' song, black powder, the
 * boarding hook, the Drowned Queen's tide and the storm deck's lightning and waves
 * (the private project notes). Built ahead of the abilities that will fire them; the specs are
 * made by `systems/combat/archipelagoVfx.ts`, the effects lab plays each one.
 *
 * **Yellow light is Varr's alone** (`varrColors.ts`): his cannon and his lanes are drawn in it and
 * nothing else here is. The fire ramp (`FIRE_RAMP`) turns any saturated red-orange yellow at its
 * edge, and the spell light lights it yellow, so the Redsail guns and the powder are a duller
 * red-orange that neither reads as fire. `archipelagoEffects.test.ts` holds every palette here to
 * that, Varr's apart.
 *
 * The clocks live here rather than beside the others in `vfx/impact.ts` because the rules need
 * two of them — when a hooked body starts to be hauled, when a wave reaches a body — and systems
 * may not import components; `impact.ts` re-exports them all.
 */

const planar = (from: HexCoord, to: HexCoord): number => {
  const f = hexToPixel(from);
  const t = hexToPixel(to);
  return Math.hypot(t.x - f.x, t.y - f.y);
};
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// ── Hazard kinds ─────────────────────────────────────────────────────────────

/** The Reef Titan's coral walls: solid ground (`ArenaHazard.kind`), drawn as coral, not rubble. */
export const CORAL_KIND = 'coral';
/** The Drowned Queen's risen water: ground that is not solid (`ArenaHazard.kind`), drawn as the sea. */
export const TIDE_KIND = 'tide';

// ── Varr's cannon and its lanes ─────────────────────────────────────────────

/** Varr's cannon fire and his lane warnings: his orb's yellow. */
export const VARR_FIRE = VARR_ORB;
/**
 * The Redsail guns' fire (the Master Gunner's ship offshore): a dull red-orange, under the fire
 * ramp's saturation, so its glow keeps its own red edge instead of ramping to yellow.
 */
export const REDSAIL_FIRE = '#e0603e';
/** The Redsail lane warning: signal-flag red, apart from the attack highlight and the Burn ground. */
export const REDSAIL_LANE = '#e8384f';

export const CANNON_LOOK = {
  /** The ball: iron, about a head across, flying flat at chest height. */
  ballSize: 0.34,
  ballColor: '#2a2b30',
  flightY: 0.62,
  /** The muzzle stands this far off the gun's hex toward the lane, this high. */
  muzzleReach: 0.6,
  muzzleY: 0.9,
  muzzleCore: 0.95,
  /** The report: the camera's kick at the muzzle, and a small one at each hex the ball tears through. */
  muzzleShake: 0.22,
  hexShake: 0.07,
  /** Smoke out of the muzzle and shed along the path; stone and splinters off each hex. */
  muzzleSmoke: 18,
  trailEveryMs: 45,
  stonePerHex: 8,
  splintersPerHex: 6,
  smokeColors: ['#4a4642', '#5e5953', '#3a3734'] as readonly string[],
  /** The streak behind the ball, world units, and its strength: Varr's lit, any other gun's smoke. */
  streakLength: 1.3,
  streakOpacity: 0.55,
  smokeTrail: '#bdb4aa',
  /** The gun's own light as it fires: yellow for Varr, red-orange for every other gun. */
  lightIntensity: 7,
  lightDecayMs: 220,
} as const;

/** The breech glows and the gun fires: the ball leaves the muzzle this long after the shot starts. */
export const CANNON_FIRE_MS = 160;
/** The debris falling and the smoke thinning once the ball has crossed the lane. */
export const CANNON_SETTLE_MS = 460;
/**
 * The ball's flight from the gun to the lane's last hex: flat and the fastest thing on the board,
 * capped so a lane across the whole deck is crossed in about a third of a second.
 */
export const cannonTravelMs = (from: HexCoord, to: HexCoord): number => clamp(planar(from, to) * 24, 120, 360);

/** A lane on the board (`LaneMarks`): a wash and an outline per hex, and chevrons flowing off the gun. */
export const LANE_LOOK = {
  fill: 0.3,
  line: 0.9,
  /**
   * Chevrons per hex, their span as a share of the hex, the thickness of their arms as a share of
   * the span, and how fast they flow, hexes a second. Bold, because a lane far up the board is seen
   * almost edge on.
   */
  chevronsPerHex: 1,
  chevronSize: 0.9,
  chevronArm: 0.26,
  flow: 1.1,
  /** The dark rim laid under each chevron, which keeps it readable on pale sand and pale stone. */
  shadow: '#1c130b',
  chevronOpacity: 0.92,
} as const;

// ── The Reef Titan's coral ──────────────────────────────────────────────────

export const CORAL_LOOK = {
  /** The coral shapes' own colour (their shockwaves, the struck body's tint): a pink the fire ramp leaves pink. */
  color: '#ff8fa3',
  /** Branch colours, coral orange and pink, with pale tips, on reef rock. */
  branches: ['#ff7f5a', '#f2645a', '#ff8fa3', '#e8577a', '#ff9e7a'] as readonly string[],
  tips: ['#ffd6cc', '#ffe4ec'] as readonly string[],
  rock: '#a67c72',
  /** How tall a wall stands, world units: cover beside a hero, who is about 1.6. */
  minHeight: 0.55,
  maxHeight: 1.05,
  /** Trunks per wall, each with a branch and a pale tip, and the brain-coral mounds at their feet. */
  trunks: 7,
  mounds: 2,
  /** A new wall rising out of the ground (`CoralField`), with an overshoot as it sets. */
  growMs: 650,
  /** The ground thrown up as walls grow and break: sand, coral chips and shell-white dust. */
  sand: ['#d8c08a', '#c4a874', '#e6d6a8'] as readonly string[],
  dust: ['#efe2d4', '#d9c8b8'] as readonly string[],
  sandPerHex: 10,
  chipsPerHex: 8,
  breakChunks: 40,
  breakDust: 14,
} as const;

/** The reef pushing up through the ground where walls grow (`coral`). */
export const CORAL_GROW_MS = 900;
/**
 * When the reef breaks the surface, into the `coral` shape: the ground has trembled and cracked,
 * the sand is thrown up and the walls start to rise (`CoralField` holds a new wall back this long).
 */
export const CORAL_RISE_MS = 260;
/** A wall broken apart (`coralbreak`): it breaks on its first frame, on the clock of the blow. */
export const CORAL_BREAK_MS = 800;

// ── The Sirens' song ─────────────────────────────────────────────────────────

/**
 * The song and its tether: sea-glass and pearl, the Choir's own colours. Never violet, which is
 * the Violet City's, and never the pale gold of their trim, which would read as Varr's light. The
 * sea-glass leans to aqua on purpose: a spell any greener is read as nature (`isNature`), which
 * would grow vines on the hero it charms.
 */
export const LURE_LOOK = {
  color: '#7fe3d0',
  pearl: '#eef6f2',
  /** Rings sung out toward the hero, and notes drifting with them. */
  rings: 4,
  notes: 7,
  mouthY: 1.3,
  chestY: 0.95,
  /** The charm closing on the body: its rings and its glow. */
  holdRing: 0.75,
  glowSize: 1.0,
} as const;

/** The song from the singer to the hero: it arrives, and the charm takes, at `LURE_ARRIVE_MS`. */
export const LURE_MS = 1150;
export const LURE_ARRIVE_MS = 620;

/** While she sings: a strand of sea-glass beads between the singer and the hero it holds (`SongTether`). */
export const TETHER_LOOK = {
  beads: 22,
  lift: 0.95,
  sag: 0.22,
  bead: 0.1,
  /** The song running along the strand, from her to the hero: strands a second. */
  pulse: 0.8,
} as const;

// ── Black powder ─────────────────────────────────────────────────────────────

/**
 * Black powder going off: a powder cask's death burst, the Corsair's Powder Magazine. The spec's
 * colour is what makes `explosion` draw powder rather than the Fire Elemental's flame (the way
 * `MARKSMAN_YELLOW` marks the Marksman's strikes): red-orange and smoke, and no yellow in it.
 */
export const POWDER_LOOK = {
  color: '#d0603c',
  /** The charge swelling before the blast, and the flash, cinders and smoke round it. */
  core: '#ff9478',
  flash: ['#ff6a3a', '#ff8c6a', '#ffd8c8'] as readonly string[],
  cinders: ['#ff5a2a', '#e8452c', '#b8321e'] as readonly string[],
  smoke: ['#2e2a28', '#3c3632', '#4f4842'] as readonly string[],
  /** Added-light sparks in the flash (few), lit cinders thrown, the cask's staves, and the smoke. */
  sparks: 28,
  cinderCubes: 24,
  smokeCubes: 44,
  splinters: 18,
  /** The fuse burning down while the charge gathers: a few sparks a frame. */
  fuseSparks: 3,
  lightIntensity: 8,
  lightDecayMs: 280,
} as const;

// ── The boarding hook ────────────────────────────────────────────────────────

export const HOOK_LOOK = {
  /** The hook's spec colour, which tints the body it bites: plain steel, the colour of an ordinary blow. */
  color: '#d8dde4',
  /** Tarred hemp. */
  rope: '#6e5636',
  ropeWidth: 0.05,
  ropeSegments: 18,
  /** How far a paying-out rope droops at its middle, world units; a taut one does not. */
  slack: 0.35,
  handY: 1.05,
  bodyY: 0.8,
  groundY: 0.16,
} as const;

/** The hook's flight from the hand: flat and quick, a little slower than an arrow. */
export const hookFlightMs = (from: HexCoord, to: HexCoord): number => clamp(planar(from, to) * 30, 140, 380);
/** The rope snapping taut once the hook has bitten, before anybody is hauled. */
export const HOOK_TAUT_MS = 160;
/** The rope going slack and dropping once the haul is over. */
export const HOOK_RELEASE_MS = 260;
/**
 * When the haul starts, from the throw: the hook's flight and the rope snapping taut. The rules
 * hold the hauled body's dash this long (`movement.shoveDelayMs` with mode `dash`), so the body
 * is pulled by the rope it is seen on.
 */
export const hookReelMs = (from: HexCoord, to: HexCoord): number => hookFlightMs(from, to) + HOOK_TAUT_MS;

// ── The Drowned Queen's tide ─────────────────────────────────────────────────

export const TIDE_LOOK = {
  /** The grotto's own water (`lair_grotto`'s kit), when the arena names none. */
  color: '#4fc0c8',
  foam: '#e6f6f2',
  /** How far the water stands over the rock it covers, world units: over a hero's feet. */
  depth: 0.12,
  opacity: 0.88,
  /** Water rising over a hex, and draining off one the tide gives back. */
  riseMs: 900,
  sinkMs: 700,
} as const;

/** Water bursting up where the tide floods in or a body is thrown into it (`splash`). */
export const SPLASH_LOOK = {
  spray: ['#f2fbf8', '#bfeaf0', '#6cc9d2'] as readonly string[],
  perHex: 12,
  /** Spray at most, across a whole flood, so a wide tide stays inside the cube budget. */
  max: 120,
  /**
   * The ring of foam running out from each hex: pale, but at half strength, so a flood of rings
   * over pale rock stays under the near-white the flash check counts.
   */
  foam: '#dff3f0',
  foamOpacity: 0.5,
} as const;
export const SPLASH_MS = 800;

// ── The storm deck ───────────────────────────────────────────────────────────

/** The storm's lightning and its marks: pale blue-white, never yellow. */
export const STORM_LOOK = {
  color: '#cfe8ff',
  /** The charge crawling over a marked hex: sparks a hex, and how often they jump. */
  sparks: 5,
  flickerMs: 90,
  /** The faint column of static standing over a marked hex, world units. */
  column: 2.2,
  /**
   * Strikes fall one marked hex at a time, this far apart: three a second at most, the comfort
   * limit on flash peaks (`FLASH_LIMITS.maxPerSecond`), with room to spare.
   */
  strikeGapMs: 380,
} as const;

/** A wave rolling across the deck (`wave`): a crest of water and foam, and spray thrown off it. */
export const WAVE_LOOK = {
  water: ['#2a6f7c', '#3a8f9c', '#57b0b8'] as readonly string[],
  foam: '#eef8f6',
  height: 0.95,
  /** Voxel columns across the crest, world units apart, and its thickness along its travel. */
  columnGap: 0.34,
  depth: 0.7,
  sprayEveryMs: 60,
  /** The footprint's sheen as the water runs over it. */
  sheen: 0.3,
} as const;
export const WAVE_MS = 1300;
/** The crest crosses the footprint between these shares of its clock. */
export const WAVE_CROSS: readonly [number, number] = [0.18, 0.72];

/**
 * When the crest reaches `hex`, in ms of a wave rolling from `from` toward `to` over `footprint`:
 * the share of the way across the footprint the hex lies, along the wave's direction. The `wave`
 * shape draws its crest by it, and the rules throw each body it pushes on it
 * (`movement.shoveDelayMs`), so a body goes with the water that hits it.
 */
export function waveCrestMs(from: HexCoord, to: HexCoord, footprint: readonly HexCoord[], hex: HexCoord): number {
  const { along, min, max } = waveSpan(from, to, footprint);
  const span = Math.max(max - min, WAVE_MIN_SPAN);
  const share = clamp((along(hex) - min) / span, 0, 1);
  return WAVE_MS * (WAVE_CROSS[0] + (WAVE_CROSS[1] - WAVE_CROSS[0]) * share);
}

/** The shortest run a crest is given to cross, world units: a one-row footprint still rolls. */
export const WAVE_MIN_SPAN = 1.5;

/**
 * The wave's direction and how far along it each hex lies, world units from `from`; `min` and
 * `max` are the footprint's near and far edges along it.
 */
export function waveSpan(from: HexCoord, to: HexCoord, footprint: readonly HexCoord[]) {
  const a = hexToPixel(from);
  const b = hexToPixel(to);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const dir = { x: (b.x - a.x) / len, z: (b.y - a.y) / len };
  const along = (c: HexCoord) => {
    const p = hexToPixel(c);
    return (p.x - a.x) * dir.x + (p.y - a.y) * dir.z;
  };
  const spans = footprint.length ? footprint.map(along) : [0];
  return { dir, along, min: Math.min(...spans), max: Math.max(...spans) };
}
