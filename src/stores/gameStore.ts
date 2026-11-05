import type { EncounterEntry } from '@/models/encounterEntry';
import { useHuntStore } from '@/stores/huntStore';
import { useAscentStore } from '@/stores/ascentStore';
import { useMythicStore } from '@/stores/mythicStore';
import { useWorldBandStore } from '@/stores/worldBandStore';
import type { RunOptions } from '@/models/run';
import { useRunSettingsStore } from '@/stores/runSettingsStore';
import { createStore as create } from 'zustand/vanilla';
import { EncounterContext, GamePhase, HeroTemplateId } from '@/models/types';
import { useSimStore } from '@/stores/simStore';
import { useLocationStore } from '@/stores/locationStore';
import { LocationId } from '@/locations/types';
import { reportLocationReached } from '@/systems/quests/questEvents';

/** Off → City → Quest → off. The world map's guide arrow. */
export type GuideMode = 'off' | 'city' | 'ascent' | 'quest';

interface GameState {
  phase: GamePhase;
  currentEncounterId: string | null;
  encounterEntry: EncounterEntry | null;
  /**
   * Where the current fight is being fought. `null` means "work it out from the
   * world map", which is what every caller used to do for itself.
   */
  currentEncounterContext: EncounterContext | null;
  mapSeed: number;
  starterHeroId: HeroTemplateId | null;
  /**
   * Which way the world map's arrow points.
   *
   * Here rather than in `WorldMapScene`'s own `useState`, which is where it
   * lived and why it kept resetting: every fight unmounts that scene, so a
   * player who had set the arrow to their tracked quest got it switched off by
   * winning a battle. A preference the player set has to outlive the component
   * that renders it.
   *
   * **Deliberately not persisted.** It costs no `SAVE_VERSION` bump, and a save
   * resumes at the world map with the arrow off, which is where a session starts
   * anyway. What it has to survive is a scene unmount, not a reinstall.
   */
  guide: GuideMode;
  /**
   * Whether the world map is drawn in its threat view — zones and bands as a
   * tinted sheet (`components/worldmap/ThreatView.tsx`). Session state for
   * `guide`'s reasons: it has to outlive the fight that unmounts the map, and
   * a session opening on the plain map is where it should open.
   */
  threatView: boolean;
  setPhase: (phase: GamePhase) => void;
  setGuide: (guide: GuideMode) => void;
  setThreatView: (on: boolean) => void;
  /** Walk into an authored place. Position and phase move together, always. */
  enterLocation: (id: LocationId) => void;
  startEncounter: (encounterId: string, context?: EncounterContext) => void;
  endEncounter: () => void;
  /**
   * A lost fight is over (PT-21): its id, checkpoint and context are cleared as
   * `endEncounter` clears a won one's, and the party is carried into `id` — one
   * write, so the fight's scene never sees its encounter go before it unmounts.
   */
  endEncounterIn: (id: LocationId) => void;
  newGame: (seed?: number, options?: RunOptions) => void;
  startHeroSelect: (seed: number, options?: RunOptions) => void;
  confirmHeroSelect: (heroId: HeroTemplateId) => void;
  returnToMenu: () => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  phase: GamePhase.Menu,
  currentEncounterId: null,
  encounterEntry: null,
  currentEncounterContext: null,
  mapSeed: 0,
  starterHeroId: null,
  guide: 'off',
  threatView: false,

  setPhase: (phase) => set({ phase }),
  setGuide: (guide) => set({ guide }),
  setThreatView: (threatView) => set({ threatView }),

  enterLocation: (id) => {
    useLocationStore.getState().enter(id);
    reportLocationReached(id);
    set({ phase: GamePhase.Location });
  },

  startEncounter: (encounterId, context) =>
    set({
      currentEncounterId: encounterId,
      encounterEntry: null,
      currentEncounterContext: context ?? null,
      phase: GamePhase.Combat,
    }),

  endEncounterIn: (id) => {
    useLocationStore.getState().enter(id);
    reportLocationReached(id);
    set({
      currentEncounterId: null,
      encounterEntry: null,
      currentEncounterContext: null,
      phase: GamePhase.Location,
    });
  },

  endEncounter: () =>
    set({
      currentEncounterId: null,
      encounterEntry: null,
      currentEncounterContext: null,
      // A harness fight goes back to its own setup screen, never to a world map
      // that the harness has no business being on. A fight picked up inside a
      // location returns to that location — walking out of a lair's first room
      // onto the overworld would lose the other three.
      phase: useSimStore.getState().active
        ? (useSimStore.getState().pvpFoes.length > 0 ? GamePhase.PvpSetup : GamePhase.SimSetup)
        : useLocationStore.getState().current !== null
          ? GamePhase.Location
          : GamePhase.WorldMap,
    }),

  newGame: (seed, options) => {
    useHuntStore.getState().reset();
    useAscentStore.getState().reset();
    useWorldBandStore.getState().reset();
    useMythicStore.getState().reset();
    useRunSettingsStore.getState().begin(options);
    set({
      phase: GamePhase.WorldMap,
      currentEncounterId: null,
      encounterEntry: null,
      currentEncounterContext: null,
      mapSeed: seed ?? Date.now(),
      // A new campaign starts with the arrow off — it points at a city and a
      // quest that belong to the map being left behind.
      guide: 'off',
    });
  },

  startHeroSelect: (seed, options) => {
    useHuntStore.getState().reset();
    useAscentStore.getState().reset();
    useWorldBandStore.getState().reset();
    useMythicStore.getState().reset();
    useRunSettingsStore.getState().begin(options);
    set({
      phase: GamePhase.HeroSelect,
      currentEncounterId: null,
      encounterEntry: null,
      currentEncounterContext: null,
      mapSeed: seed,
      starterHeroId: null,
      guide: 'off',
    });
  },

  // A campaign opens inside the city, where the first quest-givers stand. It
  // used to open on the world map *on* the city tile — the one hex the party
  // could not walk onto, so reaching the captain meant stepping off and back.
  confirmHeroSelect: (heroId) => {
    set({ starterHeroId: heroId });
    get().enterLocation('city');
  },

  returnToMenu: () => set({ phase: GamePhase.Menu }),
}));
