// ============ ENUMS ============

export enum GamePhase {
  Menu = "menu",
  RunOver = "runOver",
  HeroSelect = "heroSelect",
  WorldMap = "worldmap",
  Combat = "combat",
  /**
   * An authored place, walked around outside combat — the city, a boss lair, the
   * castle. Which one is on `locationStore`, so this stays a single phase rather
   * than one per place.
   */
  Location = "location",
  /**
   * Dev-only tuning harness: builds a party (level, the real mastery tree, gear)
   * and fights it. Never reached from normal play.
   */
  SimSetup = "simSetup",
  SaveCreator = "saveCreator",
  /** Developer-only PvP proof of concept: a picked hero team against a rolled AI hero team. */
  PvpSetup = "pvpSetup",
  /**
   * Dev-only perf launcher: starts the heaviest fights straight from the menu
   * and measures their frames. Reachable only from a build made with
   * `ENGINE_PERF_LAUNCHER=1` — see `components/perf/perfFlag.ts`.
   */
  PerfLaunch = "perfLaunch",
}

export enum HeroClass {
  Warrior = "warrior",
  Mage = "mage",
  Healer = "healer",
  Ranger = "ranger",
  Monk = "monk",
}

export enum Rarity {
  Common = "common",
  Rare = "rare",
  Epic = "epic",
  Legendary = "legendary",
  Mythic = "mythic",
}

export enum TileType {
  Plains = "plains",
  Forest = "forest",
  Desert = "desert",
  Swamp = "swamp",
  /**
   * The shoulder of a range — walkable, and the only ground a mountain can be
   * entered from. See `MAX_CLIMB` in `mapGenerator`.
   */
  Highlands = "highlands",
  Mountain = "mountain",
  Water = "water",
  /**
   * Snowfield. Only the frozen north grows it: `mapGenerator` turns the warm
   * level ground there into this, and marks the region's tiles `frost`.
   */
  Tundra = "tundra",
}

// Points of interest placed on top of terrain tiles as 3D overlays
export enum POIType {
  City = "city",
  QuestSite = "quest",
  BossTile = "boss",
  MagicWell = "magic_well",
  /** The Obsidian castle. Visible from the start — it is a threat, not a secret. */
  EmpireCastle = "empire_castle",
  /**
   * Somebody living out here: a trapper's camp, a claim on the shoulder of a
   * range, a hut in the reeds. Walking onto it opens the same conversation the
   * city's quest-givers use — see `MapTile.npcId`.
   *
   * The reason it exists is that every other destination on the map is a fight,
   * a resource or a door, so the only reason to leave the road was to be
   * attacked. A person is a reason to walk somewhere that is not a danger tile.
   */
  Wayside = "wayside",
  /**
   * The door between worlds: the Empire's road out to the next world, and the
   * arrival camp at the far end that leads back. Never the castle — the
   * gauntlet keeps its own door.
   */
  WorldGate = "world_gate",
  /**
   * One of Jadeveil's shrines, climbing from the foothills to the summit
   * (`MapTile.shrine` is its place in the chain). Placed on the pilgrim road.
   */
  Shrine = "shrine",
  /** Jadeveil's summit, the far anchor: where the range ends and Kairen waits. */
  Summit = "summit",
  /**
   * One of the Empire's four villages (`MapTile.village` is its theme): held by
   * an occupier until the party frees it, a friendly stop after. See
   * `data/villages.ts`.
   */
  Village = "village",
  /**
   * The archipelago's home anchor: the party's camp on a beach of the island at
   * the map's west edge, its ship at a berth beside it (`MapTile.berth`).
   */
  IsleCamp = "isle_camp",
  /** The archipelago's far anchor: Captain Varr's fortress on the island at the east edge. */
  Stronghold = "stronghold",
  /** A pirate fort holding one of the archipelago's islands; freeing it is the island's to come. */
  PirateFort = "pirate_fort",
  /** A port on one of the archipelago's islands, where the ship will put in. */
  IslePort = "isle_port",
}

export enum BuildingType {
  Barracks = "barracks",
  Shop = "shop",
  Forge = "forge",
  Tavern = "tavern",
  Library = "library",
  Market = "market",
}

export enum ResourceType {
  Gold = "gold",
  Wood = "wood",
  Stone = "stone",
  Iron = "iron",
  Crystal = "crystal",
}

export enum SkillTargetType {
  Single = "single",
  /**
   * A wedge out of the caster, along one of the six hex axes: every hex within
   * `aoeRadius` steps that also lies within 60° of the aim. Depth 1 is 3 hexes,
   * 2 is 8, 3 is 15, 4 is 24.
   *
   * Replaced `Cone`, which walked the shape out on the lattice — `a` steps
   * forward, `b` steps sideways — and produced a four-hex rhombus smeared along
   * a diagonal rather than anything that widens. On a hex grid that reads as
   * arbitrary: a playtest report called it "a very weird AoE to use", and the
   * skills using it were the ones nobody pressed. Defining the wedge by distance
   * and angle instead is what a cone geometrically *is*, so the shape on screen
   * and the shape in the player's head are the same one.
   *
   * It still snaps to an axis — a wedge has a direction and whole hexes have to
   * be picked — but it degrades far better than its predecessor did. A 30° snap
   * error slid the old four-hex sliver clean off its target; on an eight-hex
   * wedge symmetric about its own axis it barely changes what is covered.
   */
  Arc = "arc",
  Line = "line",
  Ring = "ring",
  Self = "self",
  /**
   * The aimed hex plus two full lines crossing on it, `aoeRadius` hexes out
   * along each — an X on the board.
   *
   * It is the one area shape with a *hole* in it: the four diagonals between
   * the arms are untouched, so unlike a Ring it rewards aiming at the middle of
   * a formation rather than at whatever stands nearest. That is the whole
   * reason it is not simply a smaller Ring.
   *
   * Which two axes the arms run along is fixed rather than aimed, because the
   * shape is symmetric under a 60° turn about its own centre — letting the
   * player rotate it would be a control that changes nothing.
   */
  Cross = "cross",
  /**
   * Starts at the aimed unit and leaps to the nearest enemy it has not touched
   * yet, `chainJumps` times, each hop no further than `chainRange`.
   *
   * Not a Line, which is what Chain Lightning used to be: a line is a direction
   * and hits whatever happens to be standing in it, including nothing at all if
   * the enemy is spread out. A chain is a *route through bodies*, so it is worth
   * more the more crowded the fight is — which is the shape the skill's name has
   * always promised.
   */
  Chain = "chain",
}

export enum CombatPhase {
  PlayerSelect = "playerSelect",
  PlayerMove = "playerMove",
  PlayerTarget = "playerTarget",
  Animating = "animating",
  EnemyTurn = "enemyTurn",
  Victory = "victory",
  Defeat = "defeat",
}
