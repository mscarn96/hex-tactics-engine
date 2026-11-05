import type { LocationId, LocationSurface } from '@/locations/types';
import { TileType } from './enums';
import type { IsleGround, JadeGround, WrathWeather } from './world';

/**
 * Where a fight is being fought.
 *
 * The arena used to work this out for itself by reaching into `worldMapStore`
 * for `partyPosition` — twice, in two different places. That is correct only for
 * a fight picked up on the overworld. A lair encounter starts from inside a
 * location, and the party's *world map* position is the lair's door tile, so
 * every dungeon and castle fight was coloured by whatever terrain noise happened
 * to sit under that hex. `LocationSurface` was never consulted at all.
 *
 * Carried on `gameStore` beside `currentEncounterId`, and cleared with it.
 * Combat state is never persisted, so this costs no `SAVE_VERSION` bump.
 */
/**
 * World hexes composed as an arena of their own rather than by their terrain: Kairen's summit,
 * and a Jadeveil shrine's courtyard, where its keepers are fought; and the archipelago's places
 * (the private project notes) — a boarding fight's deck, clear or at a storm's edge, a
 * raid's port, Varr's gun battery, a pirate fort, and the two lairs, sites until their walkable
 * lairs exist.
 */
export type ArenaSite =
  | 'summit' | 'shrine'
  | 'deck' | 'deck_storm' | 'port' | 'battery' | 'pirate_fort' | 'lair_hull' | 'lair_grotto';

export type EncounterContext =
  | {
      kind: 'world';
      terrain: TileType;
      danger: boolean;
      /**
       * The tile's threat band.
       *
       * **Deliberately unconsumed.** Which band a fight rolls at is decided by
       * `enemiesForEncounter` reading the world tile directly, and moving that
       * here would change what a lair fields — a balance change wearing a
       * presentation change's clothes. It is carried so a later pass *can* do it
       * on purpose rather than having to re-plumb; it is not an oversight.
       *
       * Typed as `MapTile.threat` is rather than as `ThreatBand`, because that
       * union lives in `systems/` and `models/` does not depend upward.
       */
      threat: number;
      /**
       * Jadeveil's weather when the fight began (`systems/world/wrath.ts`), so the
       * arena wears the sky the map had and a resumed fight keeps it. Absent elsewhere.
       */
      weather?: WrathWeather;
      /**
       * Which of Jadeveil's grounds the fight is on (`MapTile.jade`), so it is fought in that
       * ground's own arena (`jade_moss`, `danger_jade_ridge`, …) rather than the Empire one its
       * terrain would give. Absent off Jadeveil.
       */
      jade?: JadeGround;
      /**
       * Which of the archipelago's grounds the fight is on, so it is fought in that ground's own
       * arena (`isle_beach`, `isle_jungle`, `isle_rock`). Absent off the archipelago.
       */
      isle?: IsleGround;
      /**
       * A world hex with an arena of its own, whatever its terrain (Jadeveil: Kairen's
       * summit). The fight is still out on the world's ground — its weather, its light —
       * but its composition is the site's (`encounterContext.compositionKeyFor`).
       */
      site?: ArenaSite;
      /**
       * A held village whose garrison is fought here (`MapTile.village`), so the fight stands in
       * that village's own arena (`village_<theme>`, playtest 2026-10-28) rather than in its terrain's.
       */
      village?: 'lookout' | 'trading_post' | 'smithy' | 'shrine';
      /** The party tried to flee this warband and failed (Escape): the enemies act first. */
      enemiesFirst?: boolean;
    }
  | {
      kind: 'location';
      location: LocationId;
      surface: LocationSurface;
      /** The place's own ground and fog, so a lair fight looks like the lair. */
      ground: string;
      fog: string;
    };
