import { EnemyTemplateId, TileType } from '@/models/types';
import { ThreatBand } from '@/systems/world/threat';
import type { WorldId } from '@/data/worlds';
import { entryText } from '@/i18n/dataText';

/**
 * Who you meet, and where.
 *
 * A faction is a themed roster keyed by battlefield **role**, so a warband
 * arrives looking like it travelled together — bodies in front, shooters
 * behind, a caster making everyone else's turn worse. Drawing from one global
 * pool filtered on tier instead puts a ghost beside a goblin for no reason.
 *
 * Terrain preference is what makes the map read as a place rather than a
 * difficulty gradient with scenery: swamps mean undead, forests mean things
 * with teeth. Threat range is what stops a level-1 party meeting the Coven.
 */

export type FactionId =
  | 'greenskins'
  | 'restless_dead'
  | 'beasts'
  | 'brigands'
  | 'fenfolk'
  | 'delve'
  | 'ashwood_coven'
  | 'obsidian_legion'
  | 'sandscourge'
  | 'thunder_herd'
  | 'rime_jarls'
  | 'hoarfrost'
  // Jadeveil's own, met only in that world (`Faction.worlds`)
  | 'yokai'
  | 'fallen_order'
  | 'draconic_host';

/**
 * Battlefield roles. An encounter is composed by asking for a shape — two front,
 * one ranged — rather than by picking templates directly, so a faction can be
 * retuned by moving one id between two lists.
 */
export type EnemyRole = 'chaff' | 'front' | 'ranged' | 'caster' | 'elite';

/**
 * A faction. Its name and its tagline (shown in the encounter banner) are
 * `factions.<id>.name` / `.tagline`, read through `factionName` and `factionTagline`.
 */
export interface Faction {
  id: FactionId;
  roles: Record<EnemyRole, EnemyTemplateId[]>;
  /** Inclusive band range this faction appears in. */
  threatRange: [ThreatBand, ThreatBand];
  /** Its home ground: the terrain it is weighted toward, or is bound to (`homeLocked`). Empty means anywhere. */
  terrain: TileType[];
  /**
   * A snowy faction's ground is the frozen tiles: `terrain` entries other than
   * Tundra (which only exists under frost) count only where the tile carries
   * `MapTile.frost`, so snowy highlands are winter ground and bare highlands are not.
   */
  frostOnly?: boolean;
  /**
   * Hard lock: the faction never rolls off its home ground (`atHome`) — not on a
   * wandering fight, a hunt or a chest guard. The identity rule of
   * the private project notes: winter on snow, the Sandscourge in the
   * desert. A faction without it roams: it fits every ground its band allows and
   * is only weighted toward its own.
   */
  homeLocked?: boolean;
  /**
   * Only appears within this many hexes of the Obsidian castle.
   *
   * A threat band is not a location: band 3 is reached either by standing near
   * the castle *or* by being far from the city, and on a 70×70 map the second
   * clause covers most of the far half. Without this the Legion patrolled a
   * distant corner it has no business being in, and met a party that had never
   * seen the castle.
   */
  castleRadius?: number;
  /**
   * Never rolls on the open map: the faction is met only where a curated fight
   * names it, which today means a lair's guard chambers (`LairSpec.faction`).
   *
   * The Hoarfrost are the Heart of Winter's own ice, and a wandering band of
   * them on the tundra would give the lair away before the party found its
   * door. A leash like `castleRadius` cannot say "nowhere": a band window
   * reaches the far half of the map whatever radius is chosen. So the wandering
   * rules — `factionsForBand`, `factionCandidates`' fallback and the hunt hints'
   * `bandsFielding` — skip the faction outright, while `composeForFaction` still
   * fields it, because a curated fight may put a roster anywhere.
   */
  lairOnly?: boolean;
  /**
   * From this band up, a **roaming** faction is met only on its own `terrain`
   * (a `homeLocked` one always is, so none of those sets it).
   *
   * A native faction for band-4 ground that had none, without a lighter roster
   * diluting band 4 everywhere else. The frozen north's release check measured
   * band-4 forest, desert and mountain fielding nothing of their own — every
   * fight there an outsider's — and the factions native one band down are the
   * Restless Dead, the Sandscourge and the Delve. Let into band 4 as outsiders
   * too, their skeletons and scorpions thinned every band-4 fight on the
   * plains, and `homeRing.test.ts`'s 3→4 step fell from ×1.27 to ×1.21 under its
   * ×1.25 floor. At home only, they cover their own ground and touch nothing
   * else.
   */
  homeOnlyFrom?: ThreatBand;
  /**
   * The worlds whose open map this faction walks. Absent means the Empire.
   *
   * Each world fields its own: the Yokai, the Fallen Order and the Draconic
   * Host are met in Jadeveil and nowhere else, and no Empire faction crosses
   * the gate. Curated fights (`composeForFaction`) ignore it, like `lairOnly`.
   */
  worlds?: readonly WorldId[];
  /**
   * The shapes (by id) in which this faction's `chaff` fields its own chaff.
   * Absent means every shape. In any other shape a chaff slot resolves as if
   * the faction had none (`membersForRole`'s fallback), and a shape that
   * `requires` chaff is not offered.
   *
   * The Fallen Order's Novices are met only in the band-2 Ambush: the faction
   * brief keeps the acolytes out of every other fight, so a Patrol is two monks.
   */
  chaffShapes?: readonly string[];
}

export const FACTIONS: Faction[] = [
  {
    id: 'greenskins',
    roles: {
      chaff: ['goblin_whelp'],
      front: ['goblin', 'orc_grunt'],
      ranged: ['goblin_spearthrower'],
      caster: ['goblin_shaman'],
      elite: ['orc_berserker', 'orc_warchief'],
    },
    threatRange: [0, 2],
    terrain: [TileType.Plains, TileType.Desert],
  },
  {
    id: 'restless_dead',
    roles: {
      // No chaff. The dead start at band 1, and the home ring is somebody
      // else's problem — `membersForRole` falls back to the front line.
      chaff: [],
      front: ['skeleton_warrior'],
      ranged: ['skeleton_archer'],
      caster: ['skeleton_mage'],
      elite: ['ghost', 'revenant', 'dark_mage'],
    },
    // To band 4 since the frozen north's release check, and there at home
    // only: deep forest far from the city had no native faction at band 4, and
    // every fight there was an outsider's — frost giants among the trees.
    threatRange: [1, 4],
    homeOnlyFrom: 4,
    terrain: [TileType.Swamp, TileType.Forest],
  },
  {
    id: 'beasts',
    roles: {
      chaff: ['wolf_pup'],
      // No ranged and no casters, deliberately. Beasts close, and a party that
      // cannot handle something in its face has to solve them a different way.
      front: ['wolf', 'dire_wolf', 'giant_spider'],
      ranged: [],
      caster: [],
      elite: ['cave_bear'],
    },
    threatRange: [0, 2],
    terrain: [TileType.Forest],
    homeLocked: true,
  },
  {
    id: 'brigands',
    roles: {
      chaff: ['footpad'],
      front: ['bandit'],
      ranged: ['brigand_archer'],
      caster: [],
      elite: ['brigand_captain'],
    },
    threatRange: [0, 2],
    terrain: [TileType.Plains, TileType.Desert],
  },
  {
    id: 'fenfolk',
    roles: {
      chaff: ['fen_spawn'],
      front: ['mire_wader'],
      ranged: ['reed_stalker'],
      caster: ['silt_speaker'],
      elite: ['bog_hulk'],
    },
    // The one faction that fills all five roles natively, so it is the only one
    // that can be arranged into every shape the table offers. Deliberate: the
    // swamp had nobody at all below band 2, and a new faction that can only be
    // a warband is a fourth way to fight the same fight.
    threatRange: [0, 2],
    terrain: [TileType.Swamp],
    homeLocked: true,
  },
  {
    id: 'delve',
    roles: {
      // No chaff, the same statement the Restless Dead make: the Delve does not
      // appear in the home ring, so its chaff slot falls to the front line.
      chaff: [],
      front: ['delve_pickhand', 'delve_breaker'],
      ranged: ['delve_slinger'],
      caster: ['delve_alchemist'],
      elite: ['delve_overseer'],
    },
    // To band 4 for the same release check, at home only: the band-4 peaks
    // had nobody of their own, and the Delve are what lives in the rock.
    threatRange: [1, 4],
    // Both halves of the range they dug into. The highlands are where a party
    // meets them on the way up; the peaks are where the ore is, and the one
    // place a resource node is allowed to sit on a mountain.
    terrain: [TileType.Mountain, TileType.Highlands],
    homeLocked: true,
  },
  {
    id: 'ashwood_coven',
    roles: {
      // No chaff — the Coven does not appear below band 2, and by then the
      // party has stopped needing training wheels
      chaff: [],
      // Almost all casters — the Coven is a status fight, and the one body it
      // fields is somebody it took rather than something it raised. No template
      // is shared with another faction: a warband has to be identifiable from
      // its members alone, or the whole idea collapses back into a pool.
      front: ['coven_thrall'],
      // A real shooter at last. This was empty, and because the fallback runs
      // `ranged → caster`, every shape asking for a skirmisher was handed the
      // Hexer — so the Coven had one silhouette for two different jobs.
      ranged: ['briar_shrike'],
      caster: ['hexer'],
      elite: ['coven_matriarch', 'ashwood_crone'],
    },
    threatRange: [2, 4],
    terrain: [TileType.Swamp],
  },
  {
    id: 'obsidian_legion',
    roles: {
      chaff: [],
      // A wall and a knife in the same slot. `front` means "a body that closes",
      // and the two things the Legion sends forward could not be less alike —
      // which is what stops a Legion warband reading as one soldier copied.
      front: ['obsidian_infantry', 'blood_thirster_stalker'],
      // No archers. The Legion closes and holds; its ranged threat is arcane,
      // and the Stalker gets behind you rather than shooting over the line.
      ranged: [],
      caster: ['blood_iron_arcanist'],
      elite: ['runeguard_sentinel', 'dread_knight'],
    },
    // Bands 3 and 4 *and* within `castleRadius`. The band alone was not enough:
    // it is reached by distance from the city as well as by proximity to the
    // castle, so it let the Legion patrol the wrong corner entirely.
    threatRange: [3, 4],
    // No terrain preference — an occupying army goes where it likes, and the
    // leash below is what keeps "where it likes" meaning "near its own walls"
    terrain: [],
    /**
     * The Legion patrols its own doorstep and nowhere else.
     *
     * Slightly wider than the band-3 castle ring (12), so a warband can be met
     * on the approach rather than only at the gate — but far short of the
     * distant-from-city ground that also reads as band 3. Outside this you meet
     * the Legion in exactly three places: the siege, the castle, and never.
     */
    castleRadius: 16,
  },
  {
    id: 'sandscourge',
    roles: {
      chaff: ['sand_mite'],
      front: ['scorpid_brute'],
      ranged: ['glass_spitter'],
      caster: ['dune_caller'],
      elite: ['burrowmother'],
    },
    // The desert's own, at last. It had no native faction at any band and
    // borrowed the Greenskins and the Brigands, which belong to the plains; from
    // band 3 it had nobody at all but outsiders on borrowed ground. Bands 1–3
    // in the plan; band 4 too, at home only, since the release check measured
    // the deep desert still fielding only outsiders there.
    threatRange: [1, 4],
    terrain: [TileType.Desert],
    homeLocked: true,
  },
  {
    id: 'thunder_herd',
    roles: {
      chaff: ['colt_runner'],
      front: ['herd_lancer'],
      ranged: ['steppe_archer'],
      caster: ['storm_drummer'],
      elite: ['herd_khan'],
    },
    // Late plains and the highlands above them. The Greenskins and the Brigands
    // hand the plains over at band 2, and band-3 plains — the commonest ground
    // there is — had no native faction until the Herd.
    threatRange: [2, 4],
    terrain: [TileType.Plains, TileType.Highlands],
    homeLocked: true,
  },
  {
    id: 'rime_jarls',
    roles: {
      chaff: ['hold_thrall'],
      front: ['rime_giantling'],
      ranged: ['glacier_hurler'],
      caster: ['rime_skald'],
      elite: ['rime_jarl'],
    },
    // The frozen north's own. Tundra is far from the city by construction, so
    // the ground they stand on is band 3–4 almost everywhere; band 2 is the
    // edge of the snow.
    threatRange: [2, 4],
    terrain: [TileType.Tundra, TileType.Highlands],
    homeLocked: true,
    frostOnly: true,
  },
  {
    id: 'hoarfrost',
    roles: {
      chaff: ['frost_mote'],
      front: ['frost_sentinel'],
      ranged: ['shardcaster'],
      caster: ['hoarfrost_wraith'],
      elite: ['glacier_colossus'],
    },
    // The Heart of Winter's own ice. It was met inside the ice lair and nowhere
    // else (`lairOnly`), so the playtest of 2026-10-14 found its Motes, Sentinels,
    // Shardcasters and Wraiths "barely used": it now also walks the deep snow at
    // bands 3–4 beside the Rime Jarls, and the late shapes call its chaff and
    // ranged line. Only on its own snow (`homeLocked`): winter given a will
    // does not wander into a desert.
    threatRange: [3, 4],
    terrain: [TileType.Tundra, TileType.Highlands],
    homeLocked: true,
    frostOnly: true,
  },
  {
    id: 'draconic_host',
    roles: {
      // No chaff, as the Legion has none: the Host never walks low enough to need it,
      // and its chaff slot falls through to the front line
      chaff: [],
      front: ['oni_brute', 'wyrmling'],
      ranged: ['karasu_tengu'],
      caster: ['raiju'],
      elite: ['oni_warlord', 'daitengu'],
    },
    // Jadeveil's summit approach: the top two bands, on the high ground — the mist
    // ridges and the crown on mountain, the terraces' shoulders on the highlands
    threatRange: [3, 4],
    terrain: [TileType.Mountain, TileType.Highlands],
    worlds: ['jadeveil'],
  },
  {
    id: 'fallen_order',
    roles: {
      chaff: ['order_novice'],
      front: ['beetle_warden', 'mantis_adept'],
      ranged: ['chain_sickle_monk'],
      caster: ['firefly_chanter'],
      elite: ['fallen_abbot', 'bell_keeper'],
    },
    // Jadeveil's shrine ground and mist ridges: the highlands and the mountain
    // between the bamboo below and the summit above
    threatRange: [1, 3],
    terrain: [TileType.Highlands, TileType.Mountain],
    homeLocked: true,
    worlds: ['jadeveil'],
    // The Novice is the band-2 Ambush's alone (the faction brief)
    chaffShapes: ['ambush'],
  },
  {
    id: 'yokai',
    roles: {
      chaff: ['kodama'],
      front: ['kappa', 'tanuki'],
      ranged: ['onibi'],
      caster: ['kitsune'],
      // Jadeveil: Silk Hollow / Yokai — the Nue roams; the Jorōgumo waits in her lair
      elite: ['nue'],
    },
    // The low forest of Jadeveil: the bamboo and the terraced slope below the shrines,
    // the first ground past the gate
    threatRange: [0, 2],
    terrain: [TileType.Forest, TileType.Plains],
    worlds: ['jadeveil'],
  },
];

/** A faction's name ("The Restless Dead"). `other` names the bestiary's group for the rest. */
export const factionName = (id: FactionId | 'other') => entryText('factions', id, 'name');
/** A faction's one-line tagline, shown in the encounter banner. */
export const factionTagline = (id: FactionId | 'other') => entryText('factions', id, 'tagline');

/** Every template a faction can field, in role order. */
export function factionMembers(id: FactionId): EnemyTemplateId[] {
  const faction = findFaction(id);
  if (!faction) return [];
  const seen = new Set<EnemyTemplateId>();
  for (const role of ['chaff', 'front', 'ranged', 'caster', 'elite'] as EnemyRole[]) {
    for (const member of faction.roles[role]) seen.add(member);
  }
  return [...seen];
}

export function findFaction(id: FactionId): Faction | undefined {
  return FACTIONS.find((f) => f.id === id);
}

/** Whether a faction rolls on the open map at all — see `Faction.lairOnly`. */
export function roams(faction: Faction): boolean {
  return !faction.lairOnly;
}

/** Whether a faction walks this world's open map — see `Faction.worlds`. */
export function walksIn(faction: Faction, world: WorldId = 'empire'): boolean {
  return (faction.worlds ?? ['empire']).includes(world);
}

/** Factions that can appear at this band, on this world's open map. */
export function factionsForBand(band: ThreatBand, world: WorldId = 'empire'): Faction[] {
  return FACTIONS.filter(
    (f) => roams(f) && walksIn(f, world) && band >= f.threatRange[0] && band <= f.threatRange[1],
  );
}

/**
 * Whether this ground is the faction's own: its `terrain` (an empty list is
 * anywhere), and for a `frostOnly` faction the tile must also be frozen.
 *
 * `frost` is `MapTile.frost`. Tundra only exists under frost, so it is winter
 * ground whatever the flag says; highlands and the rest count only when marked.
 */
export function atHome(faction: Faction, terrain: TileType, frost: boolean = false): boolean {
  if (faction.terrain.length === 0) return true;
  if (!faction.terrain.includes(terrain)) return false;
  return !faction.frostOnly || frost || terrain === TileType.Tundra;
}

/**
 * Factions that can be met on this ground, weighted toward the ones that belong there.
 *
 * A `homeLocked` faction is a candidate only at home; a roamer fits any ground
 * its band allows and keeps a heavier weight on its own. Returning candidates
 * with duplicates is how the weighting is expressed — the caller picks
 * uniformly and the repeats do the work.
 */
export function factionCandidates(
  band: ThreatBand,
  terrain: TileType,
  /**
   * Hexes from the Obsidian castle. Defaults to "nowhere near it", so every
   * caller that has no coordinate to offer — tests, curated fights — simply
   * never meets a leashed faction rather than meeting one by accident.
   */
  fromCastle: number = Infinity,
  world: WorldId = 'empire',
  /** The tile is under frost (`MapTile.frost`), which makes highlands winter ground for a `frostOnly` faction. */
  frost: boolean = false,
): Faction[] {
  const eligible = factionsForBand(band, world).filter(
    (f) => (f.castleRadius === undefined || fromCastle <= f.castleRadius)
      && (f.homeOnlyFrom === undefined || band < f.homeOnlyFrom || atHome(f, terrain, frost))
      && (!f.homeLocked || atHome(f, terrain, frost)),
  );
  // Every ground has a roamer at every band (the coverage check of the plan, and
  // `factionLock.test.ts` pins it), so an empty pool is a data error, not a case
  if (eligible.length === 0) {
    throw new Error(`factionCandidates: no faction fits band ${band} ${terrain} in ${world}`);
  }

  const weighted: Faction[] = [];
  for (const faction of eligible) {
    // Three entries against one: local factions dominate without ever making an
    // outsider impossible, which is what keeps a region feeling inhabited rather
    // than scripted
    for (let i = 0; i < (atHome(faction, terrain, frost) ? 3 : 1); i++) weighted.push(faction);
  }
  return weighted;
}

/**
 * Members available for a role, falling back when a faction does not field one.
 *
 * The fallback is what lets a faction leave a role empty as a design statement —
 * Beasts have no archers — without the composer having to special-case them. A
 * missing shooter becomes another body, which is exactly what a wolf pack is.
 */
/**
 * Whether a role gives this faction something its front line does not.
 *
 * The gate behind `EncounterShape.requires`, and it asks about the **resolved**
 * roster rather than the authored one. A faction that leaves `ranged` empty may
 * still field shooters through the fallback — the Coven's lands on the Hexer,
 * and a skirmish line of Hexers is a real fight. What the gate exists to catch
 * is Beasts, whose `ranged` falls all the way through to `front` and would put
 * three identical wolves under a name promising something else.
 *
 * Asking "does the faction *author* this role" instead is the tempting version
 * and it is wrong: it admits three factions and locks the Coven and the Legion
 * out of every shape — which is to say bands 3 and 4, most of the late game.
 */
export function fieldsDistinctly(faction: Faction, role: EnemyRole, shapeId?: string): boolean {
  const members = membersForRole(faction, role, shapeId);
  if (members.length === 0) return false;
  const front = faction.roles.front;
  if (members.length !== front.length) return true;
  return members.some((m) => !front.includes(m));
}

export function membersForRole(
  faction: Faction,
  role: EnemyRole,
  /** The shape the slot belongs to, for `Faction.chaffShapes`. Absent: any shape. */
  shapeId?: string,
): EnemyTemplateId[] {
  const withheld = role === 'chaff' && shapeId !== undefined && faction.chaffShapes !== undefined
    && !faction.chaffShapes.includes(shapeId);
  const direct = withheld ? [] : faction.roles[role];
  if (direct.length > 0) return direct;

  const fallback: Record<EnemyRole, EnemyRole[]> = {
    // A faction with no chaff sends its rank and file instead — which is right,
    // because a faction with no chaff is one that never appears at band 0
    chaff: ['front', 'elite'],
    front: ['elite'],
    ranged: ['caster', 'front'],
    caster: ['ranged', 'front'],
    elite: ['front'],
  };
  for (const alternative of fallback[role]) {
    if (faction.roles[alternative].length > 0) return faction.roles[alternative];
  }
  return faction.roles.front;
}
