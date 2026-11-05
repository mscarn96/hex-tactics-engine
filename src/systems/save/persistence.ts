import { CASTLE_STAGE_COUNT, castleEncounterId } from '@/systems/world/castle';
import { useHuntStore } from '@/stores/huntStore';
import { useVillageStore } from '@/stores/villageStore';
import { useCombatStore } from '@/stores/combatStore';
import { DEV_TOOLS, SAVE_CREATOR } from '@/utils/devTools';
import type { WorldId } from '@/data/worlds';
import { bandOf, markFinished } from '@/systems/world/worldBands';
import { cancelTravelIntent } from '@/utils/travelIntent';
import { useRunSettingsStore } from '@/stores/runSettingsStore';
import AsyncStorage from '@/platform/keyValueStore';
import { useGameStore } from '@/stores/gameStore';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { useCityStore } from '@/stores/cityStore';
import { useEmpireStore } from '@/stores/empireStore';
import { useSimStore } from '@/stores/simStore';
import { useLocationStore } from '@/stores/locationStore';
import { useQuestStore } from '@/stores/questStore';
import { useAscentStore } from '@/stores/ascentStore';
import { useMythicStore } from '@/stores/mythicStore';
import { useWorldBandStore } from '@/stores/worldBandStore';
import { resetQuestNotices } from '@/systems/quests/questNotices';
import { GamePhase, Hero, MotifId } from '@/models/types';
import { loadHero, saveHero } from '@/systems/save/heroSave';
import { SaveData, SAVE_VERSION, isLoadable } from '@/systems/save/saveFormat';

export { SAVE_VERSION };

const SAVE_KEY = 'engine_save';

// Serialise writes and permanent loss. A background save already in flight may
// finish, but cannot land after the loss marker or resurrect the deleted run.
let diskWrites: Promise<void> = Promise.resolve();
function writeToDisk(write: () => Promise<void>): Promise<void> {
  const next = diskWrites.then(write);
  diskWrites = next.catch(() => {});
  return next;
}

/** Called after the run is synchronously marked ended. Never touches profile keys. */
export async function eraseRunSave(): Promise<void> {
  await writeToDisk(async () => {
    // If the app closes between these operations, the marker is un-loadable.
    await AsyncStorage.setItem(SAVE_KEY, JSON.stringify({ ended: true }));
    await AsyncStorage.removeItem(SAVE_KEY);
  });
}

/**
 * The phases inside a campaign — the only ones a save is taken from.
 *
 * Anywhere else, memory is not the game on disk: on the menu before Continue it
 * is the empty game the app opened with, in hero select a new
 * world with nobody in it, in the tuning harness and the perf launcher whatever
 * they were handed.
 * `App` saves whenever the app leaves the screen, whatever is showing, and that
 * write replaced the player's campaign with a save that loads cleanly onto the
 * menu with nobody in it. The menu a campaign was left for is no exception:
 * leaving already saved it, and a second write would stamp it `menu`, which is
 * where Continue would then resume it.
 *
 * A record over every phase rather than a list, so a new phase does not compile
 * until it is put on one side.
 */
const IN_CAMPAIGN: Record<GamePhase, boolean> = {
  [GamePhase.Menu]: false,
  [GamePhase.RunOver]: false,
  [GamePhase.HeroSelect]: false,
  [GamePhase.SimSetup]: false,
  [GamePhase.SaveCreator]: false,
  [GamePhase.PvpSetup]: false,
  [GamePhase.PerfLaunch]: false,
  [GamePhase.WorldMap]: true,
  [GamePhase.Location]: true,
  [GamePhase.Combat]: true,
};

export async function saveGame(): Promise<void> {
  // The tuning harness runs real fights, which award XP and roll loot. None of
  // that is allowed to reach disk — see `simStore` for the second guard.
  if (useSimStore.getState().active || useRunSettingsStore.getState().summary) return;
  const gameState = useGameStore.getState();
  if (!IN_CAMPAIGN[gameState.phase]) return;

  const saveData = captureSave();
  const raw = JSON.stringify(saveData);
  await writeToDisk(async () => {
    if (!useRunSettingsStore.getState().summary) await AsyncStorage.setItem(SAVE_KEY, raw);
  });
}

/** Capture a complete campaign snapshot, without writing or changing session. */
export function captureSave(): SaveData {
  const gameState = useGameStore.getState();
  const partyState = usePartyStore.getState();
  const inventoryState = useInventoryStore.getState();
  const worldMapState = useWorldMapStore.getState();
  const cityState = useCityStore.getState();
  const empireState = useEmpireStore.getState();
  const locationState = useLocationStore.getState();
  const questState = useQuestStore.getState();

  const resolved = gameState.encounterEntry?.resolved;
  const nextCastle = resolved && empireState.castleTier !== null && empireState.castleStage < CASTLE_STAGE_COUNT - 1;

  const saveData: SaveData = {
    version: SAVE_VERSION,
    game: {
      phase: nextCastle ? GamePhase.Combat : resolved ? GamePhase.WorldMap : gameState.phase,
      currentEncounterId: nextCastle ? castleEncounterId(empireState.castleTier!, empireState.castleStage + 1) : resolved ? null : gameState.currentEncounterId,
      currentEncounterContext: gameState.currentEncounterContext,
      encounterEntry: gameState.encounterEntry?.resolved ? null : gameState.encounterEntry,
      mapSeed: gameState.mapSeed,
      starterHeroId: gameState.starterHeroId,
      difficulty: useRunSettingsStore.getState().difficulty,
      hardcore: useRunSettingsStore.getState().hardcore,
      achievementVictories: [...useRunSettingsStore.getState().achievementVictories],
    },
    party: {
      heroes: partyState.heroes.map(saveHero),
    },
    inventory: {
      bag: inventoryState.bag,
      resources: inventoryState.resources,
    },
    worldMap: {
      current: worldMapState.worldId,
      // The worlds left behind as they were left, and the one underfoot as it is.
      worlds: { ...worldMapState.dormant, [worldMapState.worldId]: worldMapState.snapshotWorld() },
      // The clock is its own store; it still rides in this section of the file
      // because the hour and the ground it was spent walking belong together.
      totalHours: useCalendarStore.getState().totalHours,
      wardUntil: worldMapState.wardUntil,
      villageBuff: useVillageStore.getState().buff,
    },
    worldBands: { ...useWorldBandStore.getState().ledger },
    mythicKills: useMythicStore.getState().kills,
    ascent: {
      wrath: { ...useAscentStore.getState().wrath },
      vows: [...useAscentStore.getState().vows],
      shrines: useAscentStore.getState().shrines,
      summit: { ...useAscentStore.getState().summit, seals: [...useAscentStore.getState().summit.seals] },
      forge: { ink: useAscentStore.getState().ink, patterns: [...useAscentStore.getState().patterns] },
    },
    city: {
      buildings: cityState.buildings,
      recruitsEarned: cityState.recruitsEarned,
      recruitNoticeShownFor: cityState.recruitNoticeShownFor,
      stash: cityState.stash,
      gemStash: cityState.gemStash,
      meal: cityState.meal,
      sackedUntilDay: cityState.sackedUntilDay,
    },
    quests: {
      huntStreak: useHuntStore.getState().streak,
      active: { ...questState.active } as any,
      completed: [...questState.completed],
      tracked: questState.tracked,
      trackedVillage: questState.trackedVillage,
    },
    locations: {
      current: locationState.current,
      position: locationState.position,
      pending: locationState.pending,
      spentTriggers: Array.from(locationState.spentTriggers),
    },
    empire: {
      castleTier: empireState.castleTier,
      castleStage: nextCastle ? empireState.castleStage + 1 : empireState.castleStage,
      lastSettledWeek: empireState.lastSettledWeek,
      tributePaid: empireState.tributePaid,
      goldPaid: empireState.goldPaid,
      siegesFought: empireState.siegesFought,
      emperorDefeated: empireState.emperorDefeated,
      seals: [...empireState.seals],
      castleCleared: empireState.castleCleared,
      deepestTier: empireState.deepestTier,
      crystals: empireState.crystals,
      winterSeals: [...empireState.winterSeals],
      heartTier: empireState.heartTier,
    },
  };

  return saveData;
}

/**
 * What `App` does with every AppState change: a save as the app goes behind,
 * where the OS may close it without another word. `inactive` counts — on iOS it
 * is the app switcher, one swipe from closed. It runs whatever is showing;
 * `saveGame`'s guards are what keep it off every screen outside a campaign.
 */
export async function saveOnAppStateChange(appState: string): Promise<void> {
  if (appState === 'background' || appState === 'inactive') await saveGame();
}

export async function loadGame(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(SAVE_KEY);
  if (!raw) return false;

  try {
    const data: SaveData = JSON.parse(raw);

    // No migrations: a save from an older build is discarded rather than upgraded
    if (!isLoadable(data)) return false;
    cancelTravelIntent();
    useCombatStore.getState().reset();
    useHuntStore.setState({ streak: data.quests.huntStreak ?? { key: '', misses: 0 } });

    useRunSettingsStore.getState().begin({ difficulty: data.game.difficulty, hardcore: data.game.hardcore });
    useRunSettingsStore.setState({ achievementVictories: [...data.game.achievementVictories] });
    useGameStore.setState({
      // Ordinary location saves return to the map; unresolved fight saves
      // restore their location and entry party separately below.
      phase: (data.game.phase === GamePhase.Location
        ? GamePhase.WorldMap
        : data.game.phase) as any,
      currentEncounterId: data.game.currentEncounterId ?? null,
      currentEncounterContext: data.game.currentEncounterContext ?? null,
      encounterEntry: data.game.encounterEntry ?? null,
      mapSeed: data.game.mapSeed,
      starterHeroId: (data.game.starterHeroId as any) ?? null,
    });

    useLocationStore.setState({
      current: data.game.phase === GamePhase.Combat ? data.locations.current ?? null : null,
      position: data.locations.position ?? { q: 0, r: 0 },
      pending: data.game.phase === GamePhase.Combat ? data.locations.pending ?? null : null,
      spentTriggers: new Set(data.locations.spentTriggers),
    });

    useQuestStore.setState({
      active: data.quests.active as any,
      completed: data.quests.completed as any,
      tracked: data.quests.tracked as any,
      trackedVillage: (data.quests.trackedVillage ?? null) as any,
    });

    // The notice queue outlives the scene that filled it on purpose, so a load
    // is the one thing that has to empty it by hand — news about the quest log
    // of a game the player just walked away from is worse than silence.
    resetQuestNotices();

    // The kit, the stats and the class are derived from the saved choices now, so a
    // tuning change reaches a loaded hero at once
    usePartyStore.setState({
      heroes: data.party.heroes.map(loadHero).filter((h: Hero | null): h is Hero => h !== null),
    });

    useInventoryStore.setState({
      // Read straight: the version gate above already refused every file
      // without a well-formed bag, and a default here would be a migration path
      // written where the format says there is none.
      bag: data.inventory.bag,
      resources: data.inventory.resources,
    });

    // The map is regenerated from its seed and the player's marks laid back on
    // (`worldState.ts`); the other worlds stay compact until the party crosses.
    const { current, worlds } = data.worldMap;
    useWorldMapStore.getState().restoreWorld(current, worlds[current]!, worlds);
    useWorldMapStore.setState({ wardUntil: data.worldMap.wardUntil });
    useVillageStore.getState().restore(data.worldMap.villageBuff);
    // A save taken in the city resumes on the world map, and the city tile is
    // the one hex whose arrival opens it — so stand on the doorstep instead,
    // where one tap walks back in. See `cityExit`.
    if (data.game.phase !== GamePhase.Combat) useWorldMapStore.getState().stepOutOfCity();

    // The day and the week follow from the hour, so the clock restores from one
    // number. Written after the map rather than before it for no reason beyond
    // reading in the order the file does.
    useCalendarStore.getState().loadClock(data.worldMap.totalHours);

    useWorldBandStore.setState({ ledger: { bands: { ...data.worldBands.bands }, finished: [...data.worldBands.finished] } });
    useMythicStore.setState({ kills: data.mythicKills });

    useAscentStore.setState({
      wrath: { ...data.ascent.wrath }, vows: [...data.ascent.vows], shrines: data.ascent.shrines, news: null,
      summit: { ...data.ascent.summit, seals: [...data.ascent.summit.seals] },
      ink: data.ascent.forge.ink, patterns: [...data.ascent.forge.patterns] as MotifId[],
    });

    useCityStore.setState({
      buildings: data.city.buildings,
      recruitsEarned: data.city.recruitsEarned,
      recruitNoticeShownFor: data.city.recruitNoticeShownFor,
      stash: data.city.stash ?? [],
      gemStash: data.city.gemStash,
      meal: data.city.meal,
      sackedUntilDay: data.city.sackedUntilDay,
    });

    useEmpireStore.setState({
      lastSettledWeek: data.empire.lastSettledWeek,
      tributePaid: data.empire.tributePaid,
      goldPaid: data.empire.goldPaid,
      siegesFought: data.empire.siegesFought,
      emperorDefeated: data.empire.emperorDefeated,
      seals: [...data.empire.seals],
      castleCleared: data.empire.castleCleared,
      deepestTier: data.empire.deepestTier,
      crystals: data.empire.crystals,
      winterSeals: [...data.empire.winterSeals],
      heartTier: data.empire.heartTier,
      // An unresolved castle stage restores its original entry checkpoint.
      castleTier: data.game.phase === GamePhase.Combat ? data.empire.castleTier ?? null : null,
      castleStage: data.game.phase === GamePhase.Combat ? data.empire.castleStage ?? 0 : 0,
    });

    return true;
  } catch {
    return false;
  }
}

export async function hasSaveGame(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  try { return isLoadable(JSON.parse(raw)); } catch { return false; }
}


/**
 * The world the saved party stands in, when a development build could mark it finished: an
 * expansion world with a band and its orb boss still standing. Null in a release.
 */
export async function devWorldToFinish(): Promise<WorldId | null> {
  if (!DEV_TOOLS) return null;
  const raw = await AsyncStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    const data: SaveData = JSON.parse(raw);
    if (!isLoadable(data)) return null;
    const here = data.worldMap.current;
    return bandOf(data.worldBands, here) !== null && !data.worldBands.finished.includes(here) ? here : null;
  } catch { return null; }
}

/**
 * The main menu's "Finish this world": marks the saved party's world finished, on disk, because
 * Continue reads the campaign from there. True when it did. Does nothing in a release.
 */
export async function devFinishSavedWorld(): Promise<boolean> {
  const world = await devWorldToFinish();
  if (!world) return false;
  const data: SaveData = JSON.parse((await AsyncStorage.getItem(SAVE_KEY))!);
  data.worldBands = markFinished(data.worldBands, world);
  await writeToDisk(() => AsyncStorage.setItem(SAVE_KEY, JSON.stringify(data)));
  return true;
}

/** Save Creator's write: replaces the campaign on disk, queued behind any autosave still in flight. */
export async function writeCreatedSave(data: SaveData): Promise<void> {
  if (!SAVE_CREATOR || !isLoadable(data)) throw new Error('Save Creator is unavailable or the save is invalid.');
  await writeToDisk(() => AsyncStorage.setItem(SAVE_KEY, JSON.stringify(data)));
}
