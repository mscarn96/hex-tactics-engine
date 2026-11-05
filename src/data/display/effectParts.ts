/**
 * **Numbers for the effects kit's reusable parts** (`components/combat/vfx/parts/`): swing trails,
 * hit stars, shockwaves, ground marks and local light flashes.
 */

/** Ground marks: what a fight leaves on the board. */
export const GROUND_MARKS = {
  /** Most marks on the board at once; a new one past this replaces the oldest. */
  max: 32,
  /** How long a mark takes to appear, ms. */
  appearMs: 180,
  /** How long it stays at full strength unless the caller says otherwise, ms: about a fight's length. */
  persistMs: 60000,
  /** How long it takes to fade out, ms: slowly, so the board forgets gradually. */
  fadeMs: 4000,
} as const;

export type GroundMarkStyle = 'scorch' | 'frost' | 'venom' | 'crater' | 'blood' | 'cracks' | 'moss';

/** How each mark looks: its colour and how strongly it covers the ground at full strength. */
export const GROUND_MARK_STYLES: Record<GroundMarkStyle, { color: string; opacity: number }> = {
  scorch: { color: '#1c1410', opacity: 0.7 },
  frost: { color: '#d8f0ff', opacity: 0.6 },
  venom: { color: '#5fae2a', opacity: 0.5 },
  crater: { color: '#3a2a1c', opacity: 0.65 },
  blood: { color: '#6a0f12', opacity: 0.55 },
  cracks: { color: '#2a2018', opacity: 0.5 },
  /** Where a nature spell landed: dark green growth. */
  moss: { color: '#2f5a1f', opacity: 0.5 },
};

/**
 * Local light flashes: a short point light that tints the ground and units near an impact. The
 * peak is held under the flash-safety limit (`FLASH_LIMITS.peakMaxMs`) whatever a caller asks.
 */
export const LIGHT_FLASH = {
  /** Lights kept ready in the scene; a flash borrows the one nearest its end. */
  pool: 2,
  /** Rise to peak, ms. */
  attackMs: 40,
  /** Fall from peak to dark, ms. */
  decayMs: 260,
  intensity: 6,
  /** Reach in world units; the light is gone past it. */
  distance: 4,
} as const;

/** The marks a melee blow leaves on the body it struck (`effects/Slash.tsx`). */
export const HIT_MARK = {
  /** Height of the mark on a struck unit, world units: about the chest of a hero-sized body. */
  chestY: 0.8,
  /** How long a cut takes to wipe across the body, ms. */
  wipeMs: 70,
  /** A blunt blow's camera shake, before `shakeCamera`'s own trim. */
  bluntShake: 0.14,
  /** A melee skill's upright crescent: how long it shows, ms, and its radius bounds, world units. */
  crescentMs: 300,
  crescentMin: 0.7,
  crescentMax: 2.6,
  /** The dust a blunt blow kicks up round the feet. */
  dustColor: '#b49a72',
  /** A lifesteal blow's blood stream back into the caster: how long it runs, ms, and its cubes. */
  drainMs: 650,
  drainCubes: 18,
} as const;

/**
 * A weapon's swing trail (`parts/WeaponTrail.tsx`): the ribbon its edge leaves through the
 * downstroke, coloured by what the weapon is made of or enchanted with.
 */
export const SWING_TRAIL = {
  /** How long a stretch of trail lasts, ms. */
  fadeMs: 200,
  /** Most samples kept: a frame each, more than a fifth of a second at 60 fps. */
  samples: 16,
  /** Where along the weapon the ribbon starts, from the hand (0) to the tip (1). */
  rootAt: 0.35,
  /** Brightness of the trail's edge at its newest, before it fades. */
  strength: 0.95,
  /** The stroke, as a share of the attack: from the top of the swing to just past the blow. */
  from: 0.32,
  to: 0.6,
  /** Plain steel, for a weapon whose motif names no colour of its own. */
  steel: '#dfe8f2',
  /** Motifs that glow: their trail takes the motif's accent, the enchantment, not the metal. */
  enchanted: ['fire', 'ice', 'storm', 'nature', 'shadow', 'holy', 'runed'] as readonly string[],
} as const;

/** The swing-trail colour for a held weapon: its enchantment's glow, else the metal. */
export function trailColor(visual: { motif: string; color: string; accent: string } | undefined): string | undefined {
  if (!visual) return undefined;
  return SWING_TRAIL.enchanted.includes(visual.motif) ? visual.accent : visual.color;
}

/** Arrows and crossbow quarrels in flight and where they land (`effects/Shot.tsx`, `parts/StuckShafts.tsx`). */
export const PROJECTILE = {
  shaftLength: 0.62,
  shaftColor: '#cdb98f',
  /** The pale air streak behind a shaft: thin, faint, never a glow. */
  streakColor: '#eef3f8',
  streakOpacity: 0.45,
  streakLength: 0.9,
  /** Peak of the arc over the straight line, as a share of the distance: a bow lofts, a crossbow barely. */
  arrowLoft: 0.06,
  boltLoft: 0.01,
  /** A crossbow quarrel's flight time as a share of an arrow's. */
  boltSpeed: 0.75,
  /** The quarrel's thud. */
  boltShake: 0.08,
  /** How far in front of a body's centre a shaft is planted, toward the archer: about a hero's half-depth. */
  bodyRadius: 0.24,
  /** How long a shaft stays standing where it struck, ms, and how many at once. */
  stuckMs: 1100,
  /** A shaft that missed stays in the dirt for most of the fight. */
  groundStuckMs: 45000,
  stuckMax: 12,
} as const;

/** What each named thrown skill throws, where the skill is not a weapon in the hand. */
export const THROWN_BY_SKILL: Record<string, 'throwing_axe' | 'throwing_blade' | 'spear' | 'bolas' | 'stone' | 'ice_block'> = {
  bolas: 'bolas',
  cleaving_throw: 'throwing_axe',
  barbed_blades: 'throwing_blade',
  throw_knife: 'throwing_blade',
  blade_recall: 'throwing_blade',
  hurl_ice_block: 'ice_block',
  // The Karasu-Tengu's flight feathers, edged and thrown like blades
  feather_dart: 'throwing_blade',
  crows_flit: 'throwing_blade',
};

/** Thrown things in flight and where they land (`effects/Throw.tsx`). */
export const THROWN = {
  /**
   * A skill the derivation drew as a glowing bolt, but thrown, flies as a throw at this share of
   * the throw's time: the bolt's clock times its numbers, and at this speed the throw lands no
   * later than the bolt would have at any distance (180/260 at the shortest throw).
   */
  fromBoltSpeed: 0.69,
  /** Tumbles per flight, end over end, for an axe, a blade and a stone. */
  tumbles: 2.5,
  /** How far an object sinks into a body it sticks in, world units. */
  bite: 0.12,
  streakColor: '#eef3f8',
  streakOpacity: 0.4,
} as const;

/** A killed unit bursting into its own cubes (`parts/deathBurst.ts`). */
export const DEATH_BURST = {
  /** Colours sampled off the model, most-used first. */
  colors: 8,
  /** World height from which a body bursts as a giant, and as a boss. */
  bigHeight: 1.8,
  bossHeight: 2.8,
  small: { count: 60, speed: 2.6, rise: 2.4, cube: 1.0, push: 0 },
  big: { count: 110, speed: 3.2, rise: 2.8, cube: 1.35, push: 0.22 },
  boss: { count: 160, speed: 3.8, rise: 3.2, cube: 1.7, push: 0.4 },
  /** How far into the death animation the body bursts: once it has buckled and begun to fall. */
  at: 0.42,
} as const;

/** A killed unit's weapon, left lying where it fell (`parts/DroppedWeapons.tsx`). */
export const DROPPED_WEAPONS = {
  max: 6,
  /** How long it lies there, ms, before sinking away over `fadeMs`. */
  lifeMs: 60000,
  fadeMs: 3000,
} as const;

/** Statuses worn on the body (`arena/statusVisuals.tsx`). */
export const STATUS_VISUALS = {
  burn: { everyMs: 110, perPuff: 3, maxPerPuff: 5, spread: 0.2, scale: 1.4, colors: ['#ffd27a', '#ff8a2a', '#ff5a1a'] },
  /** Bright and big enough to read on grass, where a dark green drop disappears. */
  poison: { everyMs: 110, spread: 0.32, scale: 1.8, colors: ['#b6ff5a', '#8af03a'] },
  buff: { color: '#ffe7a8' },
  charge: { color: '#bfe9ff', size: 0.5 },
} as const;

export type SpellElement = 'fire' | 'lightning' | 'frost' | 'holy';

/** The light a spell's impact throws on the ground and units round it (`parts/spellLight.ts`). */
export const SPELL_LIGHT: Record<SpellElement, { intensity: number; decayMs: number }> = {
  fire: { intensity: 9, decayMs: 320 },
  /** Brighter and shorter: a crack, not a glow. */
  lightning: { intensity: 12, decayMs: 160 },
  frost: { intensity: 6.5, decayMs: 300 },
  holy: { intensity: 8, decayMs: 360 },
};

/** The spell bolt (`effects/Bolt.tsx`): its core, trail and burst, scaled by the skill's `durationScale`. */
export const BOLT = {
  /** Glow core diameter at scale 1, world units. */
  coreSize: 0.55,
  /** A trail mote every this many ms of flight, this many at a time. */
  trailEveryMs: 28,
  trailPerShed: 2,
  /** Magic cubes in the impact burst at scale 1. */
  burst: 36,
} as const;

/** The nova (`effects/Nova.tsx`): its reach, burst, tint and the mark it leaves. */
export const NOVA = {
  /** Farthest the leading wave runs, world units: a ring round a whole formation, no further. */
  maxReach: 4.2,
  /** Magic cubes in the burst for a ring of about two units' reach. */
  burst: 48,
  /** Peak of the soft tint over the struck hexes, which keeps the footprint readable. */
  tint: 0.35,
  /** How long the centre's mark stays, ms: shorter than a spell's own scorch, a nova is frequent. */
  markMs: 9000,
} as const;

/** Meteor and explosion in beats (`effects/Meteor.tsx`, `effects/Explosion.tsx`). */
export const METEOR = {
  /** The falling fireball's glow core, world units. */
  coreSize: 0.9,
  /** Embers shed by the falling ball, every this many ms. */
  trailEveryMs: 30,
  /** Fire cubes in the burst, stone chips thrown out, and embers left rising after it. */
  burst: 90,
  debris: 30,
  embers: 36,
} as const;

/** Lightning's look (`effects/Lightning.tsx`): thicker strands, forks, a sky strike, sparks. */
export const LIGHTNING_LOOK = {
  /** Glow shell and white core thickness, world units. */
  shell: 0.22,
  core: 0.09,
  /** Forks off each leg of the path. */
  branches: 2,
  /** How high a sky strike starts above its target. */
  skyHeight: 7,
  /** Sparks burst where it lands, and sparks left crackling after. */
  burst: 26,
  linger: 12,
} as const;

/** Fire's colour ramp, white heart to orange edge, and its embers' colours (`glow.ts`, `VfxLayer`). */
export const FIRE_RAMP = {
  white: '#fff4d6',
  yellow: '#ffc93a',
  orange: '#ff6a1a',
  embers: ['#fff4d6', '#ffd23a', '#ff9a2a', '#ff5a1a'] as readonly string[],
  /** Ember cubes thrown up off each struck hex as a fire spell lands, at most this many in all. */
  embersPerHex: 10,
  embersMax: 90,
} as const;

/** Frost's ice crystals and frost cubes (`parts/IceCrystals.tsx`, `VfxLayer`). */
export const ICE_CRYSTALS = {
  max: 60,
  perCluster: 4,
  /** How far from the hex centre a cluster's shards stand, world units. */
  spread: 0.32,
  minHeight: 0.35,
  maxHeight: 0.8,
  width: 0.09,
  growMs: 140,
  holdMs: 700,
  sinkMs: 450,
  colors: ['#bfefff', '#8fe3ff', '#e6f9ff'] as readonly string[],
  /** Frost cubes drifting down over each struck hex, at most this many in all. */
  frostPerHex: 8,
  frostMax: 80,
  frostColors: ['#ffffff', '#d6f4ff', '#9fe6ff'] as readonly string[],
} as const;

/**
 * A Freeze ending (`effects/Shatter.tsx`): broken by a blow at full size, thawing on its own at the
 * spec's smaller `durationScale`, which scales the counts, the throw and the light with it.
 */
export const SHATTER_LOOK = {
  /** The whole picture, ms, at scale 1. */
  ms: 900,
  /** Where the ice bursts from: the body's middle, world units above the tile. */
  burstY: 0.75,
  /** Ice chunks: lit cubes that fly off, fall, bounce and lie a moment. */
  chunks: 34,
  chunkSpeed: 2.6,
  chunkRise: 2.8,
  chunkScale: 1.25,
  /** A thaw's share of the chunks and glitter, and of their throw. */
  thawShare: 0.7,
  thawThrow: 0.4,
  chunkColors: ['#e8fbff', '#bfefff', '#8fe3ff', '#7fd6f0'] as readonly string[],
  /** Glitter: frost cubes thrown wider and drifting down. */
  glitter: 22,
  glitterSpeed: 2.2,
  /** The flash at the body: a glow core and a contact star, both small. */
  coreSize: 0.8,
  starSize: 0.9,
  /** The ring across the ground, world units. */
  ringRadius: 1.0,
  /** Below this scale the ice is thawing, not breaking: no star, no shake. */
  thawBelow: 0.75,
} as const;

/** Nature's vines, leaves and motes (`parts/Vines.tsx`, `VfxLayer`). */
export const NATURE_LOOK = {
  /** Vines standing at once, at most; each is a chain of short segments creeping over the ground. */
  maxVines: 48,
  vinesPerHex: 3,
  segments: 7,
  segmentLength: 0.14,
  width: 0.085,
  /** How far each step turns, radians, so a vine curls. */
  curl: 0.45,
  growMs: 380,
  holdMs: 900,
  witherMs: 450,
  vineColors: ['#3a2a14', '#2a3a14', '#4a3a1a'] as readonly string[],
  /** Leaves thrown up off each struck hex to flutter down, at most this many in all. */
  leavesPerHex: 7,
  leavesMax: 70,
  leafColors: ['#3f7a2a', '#6aa83a', '#9ccf4a', '#c8d84a'] as readonly string[],
  /** Green motes rising off each struck hex, at most this many in all. */
  motesPerHex: 5,
  motesMax: 50,
} as const;

/** The beam's look (`effects/Beam.tsx`): strands wobbling about each other inside a soft glow. */
export const BEAM_LOOK = {
  strands: 4,
  /** Segments per strand, along the whole beam. */
  segments: 28,
  /** How far a strand swings off the axis, world units (the band is about 2.9 wide). */
  amplitude: 0.55,
  /** Swings per world unit along the beam, and how fast the swing travels, radians per second. */
  wobbleFreq: 1.6,
  wobbleSpeed: 14,
  thickness: 0.07,
  /** The soft glow round the strands: its width and strength. */
  glowWidth: 1.8,
  glowOpacity: 0.28,
  /** Sparkles thrown off the beam's length at each hit. */
  sparklesPerPulse: 30,
} as const;
