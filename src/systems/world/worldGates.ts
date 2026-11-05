import { crossingFree, type RoadState } from '@/data/levelCap';
import { EXPANSION_WORLD_IDS, worldDef, type WorldId } from '@/data/worlds';
import { DEV_TOOLS } from '@/utils/devTools';

/**
 * Which roads a gate offers and whether each is open: the rule, pure, with the
 * campaign's state passed in. `worldTravel.ts` walks the party through.
 *
 * A gate names its world (`WorldDef.gateTo`). The Empire's also offers every other
 * world this build can enter, so the player picks the order. In a `DEV_TOOLS` build
 * that includes a world marked `devCrossing`; a release never offers one.
 *
 * A road beyond the Empire is open when the world is owned, Aethelred has fallen,
 * and the world has a band already or a crossing is free. Ownership is checked first,
 * so an unowned campaign is never told that beating Aethelred will open a road it
 * cannot take. The way home is never locked, whatever the device says about
 * ownership today.
 */
export type GateState =
  /** `band`: the band the world holds or will take; null on the way home. `first`: this crossing assigns it. */
  | { open: true; to: WorldId; band: number | null; first: boolean }
  | { open: false; to: WorldId; reason: 'unowned' | 'emperor' }
  /** No crossing is free until `world`'s orb boss falls. */
  | { open: false; to: WorldId; reason: 'orb'; world: WorldId };

/** The worlds a gate in `from` leads to, its own named first. */
export function gateRoads(from: WorldId, devTools: boolean = DEV_TOOLS): WorldId[] {
  const named = worldDef(from).gateTo;
  if (from !== 'empire') return [named];
  const others = EXPANSION_WORLD_IDS.filter((id) => id !== named
    && (worldDef(id).enterable || (devTools && worldDef(id).devCrossing === true)));
  return [named, ...others];
}

/** The world a gate in `from` names: the way home, from anywhere but the Empire. */
export function gateDestination(from: WorldId): WorldId {
  return worldDef(from).gateTo;
}

/** The newest banded world whose orb boss still stands: the one holding the next road shut. */
export function worldInPlay(state: RoadState): WorldId | null {
  for (let i = state.banded.length - 1; i >= 0; i--) {
    if (!state.finished.includes(state.banded[i])) return state.banded[i];
  }
  return null;
}

/** Whether the road from `from` to `to` will let the party through. */
export function gateState(from: WorldId, to: WorldId, state: RoadState): GateState {
  if (to === 'empire' || from !== 'empire') return { open: true, to, band: null, first: false };
  if (!state.owned.includes(to)) return { open: false, to, reason: 'unowned' };
  if (!state.emperorDefeated) return { open: false, to, reason: 'emperor' };
  const held = state.banded.indexOf(to);
  if (held >= 0) return { open: true, to, band: held + 1, first: false };
  if (crossingFree(state)) return { open: true, to, band: state.banded.length + 1, first: true };
  const world = worldInPlay(state);
  // No world in play and no crossing free: a world banded earlier is no longer owned here
  return world ? { open: false, to, reason: 'orb', world } : { open: false, to, reason: 'unowned' };
}

/** Every road a gate in `from` offers, each with its state. */
export function gateOffer(from: WorldId, state: RoadState, devTools: boolean = DEV_TOOLS): GateState[] {
  return gateRoads(from, devTools).map((to) => gateState(from, to, state));
}

/** What the story reads about the roads: worlds still to enter, worlds entered, worlds finished. */
export interface CampaignRoads {
  /** Open worlds the party has not entered. */
  unentered: readonly WorldId[];
  banded: readonly WorldId[];
  finished: readonly WorldId[];
}

export const NO_ROADS: CampaignRoads = { unentered: [], banded: [], finished: [] };

export function campaignRoads(state: RoadState, devTools: boolean = DEV_TOOLS): CampaignRoads {
  return {
    unentered: gateOffer('empire', state, devTools).flatMap((road) => (road.open && road.first ? [road.to] : [])),
    banded: state.banded,
    finished: state.finished,
  };
}
